import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const dynamodb = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || "2025-06-30.basil";

let stripeSecretCache;

export const handler = createBillingSummaryHandler();

export function createBillingSummaryHandler({
  dynamodbClient = dynamodb,
  secretsClient = secrets,
  fetchImpl = fetch,
  nowMs = () => Date.now(),
  secretCache = {}
} = {}) {
  return async function billingSummaryHandler(event) {
    return handleBillingSummary(event, {
      dynamodbClient,
      secretsClient,
      fetchImpl,
      nowMs,
      secretCache
    });
  };
}

export async function handleBillingSummary(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;
  const secretsClient = deps.secretsClient || secrets;
  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || (() => Date.now());
  const secretCache = deps.secretCache || {};

  try {
    const userId = event.requestContext?.authorizer?.lambda?.userId;
    if (!userId) {
      return jsonResponse(401, { message: "Unauthorized." });
    }

    const user = await getUser(dynamodbClient, userId);
    if (!user) {
      return jsonResponse(404, { message: "User not found." });
    }

    const stripeSecret = await getStripeSecret(secretsClient, secretCache);
    if (!stripeSecret.secret_key) {
      return jsonResponse(500, { message: "Stripe secret is not configured." });
    }

    const stripe = createStripeClient(stripeSecret.secret_key, fetchImpl);
    const stripeCustomerId = await ensureStripeCustomer({
      dynamodbClient,
      stripe,
      user,
      nowMs
    });

    const [customer, invoices, subscriptions, paymentMethods, events] = await Promise.all([
      stripe.get(`/customers/${encodeURIComponent(stripeCustomerId)}`),
      stripe.get("/invoices", {
        customer: stripeCustomerId,
        limit: "12"
      }),
      stripe.get("/subscriptions", {
        customer: stripeCustomerId,
        status: "all",
        limit: "10",
        "expand[]": ["data.default_payment_method", "data.latest_invoice.payment_intent"]
      }),
      stripe.get(`/customers/${encodeURIComponent(stripeCustomerId)}/payment_methods`, {
        limit: "20"
      }),
      getBillingEvents(dynamodbClient, stripeCustomerId)
    ]);

    const sanitizedInvoices = (invoices.data || []).map(sanitizeInvoice);
    const sanitizedSubscriptions = (subscriptions.data || []).map(sanitizeSubscription);

    return jsonResponse(200, {
      customer: sanitizeCustomer(customer),
      invoices: sanitizedInvoices,
      subscriptions: sanitizedSubscriptions,
      paymentMethods: (paymentMethods.data || []).map(sanitizePaymentMethod),
      paymentInfo: buildPaymentInfo(customer, sanitizedSubscriptions, sanitizedInvoices),
      dunning: buildDunningSummary(sanitizedInvoices, sanitizedSubscriptions, events),
      retrievedAt: new Date(nowMs()).toISOString()
    });
  } catch (error) {
    console.error("Failed to load billing summary", {
      message: error.message,
      name: error.name,
      stripeStatus: error.stripeStatus
    });

    return jsonResponse(error.statusCode || 500, {
      message: error.publicMessage || "Failed to load billing details."
    });
  }
}

async function getUser(dynamodbClient, userId) {
  const response = await dynamodbClient.send(
    new GetItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: {
        user_id: { S: userId }
      }
    })
  );

  if (!response.Item) {
    return undefined;
  }

  return {
    userId: response.Item.user_id.S,
    email: response.Item.email?.S,
    name: response.Item.name?.S,
    stripeCustomerId: response.Item.stripe_customer_id?.S
  };
}

async function ensureStripeCustomer({ dynamodbClient, stripe, user, nowMs }) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.post("/customers", {
    email: user.email || undefined,
    name: user.name || undefined,
    "metadata[syncpoly_user_id]": user.userId
  });

  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: {
        user_id: { S: user.userId }
      },
      ConditionExpression: "attribute_not_exists(stripe_customer_id)",
      UpdateExpression: "SET stripe_customer_id = :customerId, stripe_customer_created_at = :createdAt, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":customerId": { S: customer.id },
        ":createdAt": { S: new Date(nowMs()).toISOString() },
        ":updatedAt": { S: new Date(nowMs()).toISOString() }
      }
    })
  );

  return customer.id;
}

async function getBillingEvents(dynamodbClient, stripeCustomerId) {
  if (!process.env.BILLING_EVENTS_TABLE_NAME) {
    return [];
  }

  const response = await dynamodbClient.send(
    new QueryCommand({
      TableName: process.env.BILLING_EVENTS_TABLE_NAME,
      KeyConditionExpression: "stripe_customer_id = :customerId",
      ExpressionAttributeValues: {
        ":customerId": { S: stripeCustomerId }
      },
      ScanIndexForward: false,
      Limit: 25
    })
  );

  return (response.Items || []).map((item) => ({
    eventId: item.stripe_event_id?.S,
    type: item.event_type?.S,
    invoiceId: item.invoice_id?.S,
    subscriptionId: item.subscription_id?.S,
    status: item.status?.S,
    hostedInvoiceUrl: item.hosted_invoice_url?.S,
    nextPaymentAttempt: item.next_payment_attempt?.N ? Number(item.next_payment_attempt.N) : null,
    createdAt: item.created_at?.S
  }));
}

function createStripeClient(secretKey, fetchImpl) {
  return {
    get(path, params = {}) {
      const url = new URL(`${STRIPE_API_BASE}${path}`);
      appendStripeParams(url.searchParams, params);
      return stripeRequest(fetchImpl, secretKey, url, { method: "GET" });
    },
    post(path, params = {}) {
      const body = new URLSearchParams();
      appendStripeParams(body, params);
      return stripeRequest(fetchImpl, secretKey, `${STRIPE_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
    }
  };
}

async function stripeRequest(fetchImpl, secretKey, url, options) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "stripe-version": STRIPE_API_VERSION,
      ...(options.headers || {})
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Stripe API request failed.");
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
    error.stripeStatus = response.status;
    error.publicMessage = "Failed to load billing details.";
    throw error;
  }

  return payload;
}

function appendStripeParams(target, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        target.append(key, item);
      }
    } else {
      target.append(key, value);
    }
  }
}

async function getStripeSecret(secretsClient, secretCache = {}) {
  if (secretCache.stripe || stripeSecretCache) {
    return secretCache.stripe || stripeSecretCache;
  }

  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.STRIPE_SECRET_ARN }));
  const raw = response.SecretString || Buffer.from(response.SecretBinary || "", "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  secretCache.stripe = parsed;
  stripeSecretCache = parsed;
  return parsed;
}

function sanitizeCustomer(customer) {
  return {
    id: customer.id,
    email: customer.email || null,
    name: customer.name || null,
    balance: customer.balance || 0,
    currency: customer.currency || null,
    delinquent: Boolean(customer.delinquent),
    defaultPaymentMethodId: customer.invoice_settings?.default_payment_method || null
  };
}

function sanitizeInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number || null,
    status: invoice.status || null,
    billingReason: invoice.billing_reason || null,
    currency: invoice.currency || null,
    amountDue: invoice.amount_due || 0,
    amountPaid: invoice.amount_paid || 0,
    amountRemaining: invoice.amount_remaining || 0,
    attemptCount: invoice.attempt_count || 0,
    nextPaymentAttempt: invoice.next_payment_attempt || null,
    dueDate: invoice.due_date || null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
    invoicePdf: invoice.invoice_pdf || null,
    created: invoice.created || null,
    periodStart: invoice.period_start || null,
    periodEnd: invoice.period_end || null
  };
}

function sanitizeSubscription(subscription) {
  const latestInvoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;

  return {
    id: subscription.id,
    status: subscription.status,
    currency: subscription.currency || null,
    currentPeriodStart: subscription.current_period_start || null,
    currentPeriodEnd: subscription.current_period_end || null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: subscription.canceled_at || null,
    collectionMethod: subscription.collection_method || null,
    defaultPaymentMethodId: getExpandableId(subscription.default_payment_method),
    latestInvoiceId: getExpandableId(subscription.latest_invoice),
    latestPaymentIntentStatus: latestInvoice?.payment_intent?.status || null,
    items: (subscription.items?.data || []).map((item) => ({
      id: item.id,
      priceId: item.price?.id || null,
      productId: item.price?.product || null,
      nickname: item.price?.nickname || null,
      interval: item.price?.recurring?.interval || null,
      quantity: item.quantity || 1,
      unitAmount: item.price?.unit_amount || null
    }))
  };
}

function sanitizePaymentMethod(paymentMethod) {
  return {
    id: paymentMethod.id,
    type: paymentMethod.type,
    billingName: paymentMethod.billing_details?.name || null,
    billingEmail: paymentMethod.billing_details?.email || null,
    card: paymentMethod.card
      ? {
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
          funding: paymentMethod.card.funding,
          country: paymentMethod.card.country
        }
      : null
  };
}

function buildPaymentInfo(customer, subscriptions, invoices) {
  return {
    delinquent: Boolean(customer.delinquent),
    balance: customer.balance || 0,
    currency: customer.currency || invoices[0]?.currency || subscriptions[0]?.currency || null,
    defaultPaymentMethodId: customer.invoice_settings?.default_payment_method || subscriptions.find((subscription) => subscription.defaultPaymentMethodId)?.defaultPaymentMethodId || null,
    activeSubscriptionCount: subscriptions.filter((subscription) => subscription.status === "active" || subscription.status === "trialing").length,
    openInvoiceCount: invoices.filter((invoice) => invoice.status === "open").length
  };
}

function buildDunningSummary(invoices, subscriptions, events) {
  const failedInvoices = invoices.filter((invoice) =>
    ["open", "uncollectible"].includes(invoice.status) && (invoice.amountRemaining > 0 || invoice.attemptCount > 0)
  );
  const atRiskSubscriptions = subscriptions.filter((subscription) =>
    ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(subscription.status)
  );

  return {
    status: failedInvoices.length > 0 || atRiskSubscriptions.length > 0 ? "action_required" : "ok",
    failedInvoiceCount: failedInvoices.length,
    atRiskSubscriptionCount: atRiskSubscriptions.length,
    nextPaymentAttempt: failedInvoices.find((invoice) => invoice.nextPaymentAttempt)?.nextPaymentAttempt || null,
    invoices: failedInvoices.map((invoice) => ({
      id: invoice.id,
      status: invoice.status,
      amountRemaining: invoice.amountRemaining,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      nextPaymentAttempt: invoice.nextPaymentAttempt,
      attemptCount: invoice.attemptCount
    })),
    subscriptions: atRiskSubscriptions.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      latestInvoiceId: subscription.latestInvoiceId
    })),
    recentEvents: events
  };
}

function getExpandableId(value) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id || null;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
