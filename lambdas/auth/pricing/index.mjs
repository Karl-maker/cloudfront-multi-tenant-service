import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHash } from "node:crypto";

const dynamodb = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || "2025-06-30.basil";
const YEARLY_DISCOUNT_PERCENT = 20;

let stripeSecretCache;

export const handler = createPricingHandler();

export function createPricingHandler({
  dynamodbClient = dynamodb,
  secretsClient = secrets,
  fetchImpl = fetch,
  nowMs = () => Date.now(),
  secretCache = {}
} = {}) {
  return async function pricingHandler(event) {
    return handlePricing(event, {
      dynamodbClient,
      secretsClient,
      fetchImpl,
      nowMs,
      secretCache
    });
  };
}

export async function handlePricing(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;
  const secretsClient = deps.secretsClient || secrets;
  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || (() => Date.now());
  const secretCache = deps.secretCache || {};

  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return jsonResponse(204, {}, event);
    }

    const method = event.requestContext?.http?.method || "GET";
    const routeKey = event.routeKey || "";

    if (method === "GET" || routeKey === "GET /billing/catalog") {
      const catalog = await listCatalog(dynamodbClient);
      return jsonResponse(200, { catalog, resetStrategy: "monthly" }, event);
    }

    if (method !== "POST") {
      return jsonResponse(405, { message: "Method not allowed." }, event);
    }

    const userId = event.requestContext?.authorizer?.lambda?.userId;
    if (!userId) {
      return jsonResponse(401, { message: "Unauthorized." }, event);
    }

    const body = parseJsonBody(event.body, event.isBase64Encoded);
    const itemId = cleanString(body.itemId);
    const interval = cleanString(body.interval || "month");
    if (!itemId) {
      return jsonResponse(400, { message: "Missing catalog item id." }, event);
    }
    if (!["month", "year"].includes(interval)) {
      return jsonResponse(400, { message: "Billing interval must be month or year." }, event);
    }

    const [item, user] = await Promise.all([
      getCatalogItem(dynamodbClient, itemId),
      getUser(dynamodbClient, userId)
    ]);
    if (!item || item.status !== "active") {
      return jsonResponse(404, { message: "Catalog item not found." }, event);
    }
    if (!user) {
      return jsonResponse(404, { message: "User not found." }, event);
    }

    if (item.checkoutMode === "free") {
      await selectFreePlan({ dynamodbClient, userId, item, nowMs });
      return jsonResponse(200, {
        checkoutRequired: false,
        item: publicCatalogItem(item),
        entitlements: item.entitlements
      }, event);
    }

    if (item.checkoutMode === "conversation") {
      return jsonResponse(200, {
        checkoutRequired: false,
        conversationRequired: true,
        contactEmail: process.env.BILLING_CUSTOM_SOLUTION_EMAIL || "support@syncpoly.com",
        item: publicCatalogItem(item),
        entitlements: item.entitlements
      }, event);
    }

    const successUrl = cleanString(body.successUrl || process.env.BILLING_CHECKOUT_SUCCESS_URL);
    const cancelUrl = cleanString(body.cancelUrl || process.env.BILLING_CHECKOUT_CANCEL_URL);
    if (!successUrl || !cancelUrl) {
      return jsonResponse(400, { message: "Missing checkout success or cancel URL." }, event);
    }

    const checkoutRequest = await beginCheckoutRequest(dynamodbClient, {
      userId,
      itemId,
      interval,
      clientKey: cleanString(body.idempotencyKey),
      nowMs
    });
    if (checkoutRequest.replayResponse) {
      return jsonResponse(checkoutRequest.replayStatusCode || 200, checkoutRequest.replayResponse, event);
    }

    const stripeSecret = await getStripeSecret(secretsClient, secretCache);
    if (!stripeSecret.secret_key) {
      return jsonResponse(500, { message: "Stripe secret is not configured." }, event);
    }

    const stripe = createStripeClient(stripeSecret.secret_key, fetchImpl);
    const customerId = await ensureStripeCustomer({ dynamodbClient, stripe, user, nowMs, idempotencyKey: stripeIdempotencyKey(checkoutRequest.key, "customer") });
    const pricedItem = await ensureStripeProductAndPrices({
      dynamodbClient,
      stripe,
      item,
      nowMs
    });
    const priceId = interval === "year" ? pricedItem.stripePriceYearId : pricedItem.stripePriceMonthId;
    const paymentMethodId = await getAvailablePaymentMethodId(stripe, customerId);
    if (paymentMethodId) {
      const subscription = await stripe.post("/subscriptions", {
        customer: customerId,
        default_payment_method: paymentMethodId,
        collection_method: "charge_automatically",
        payment_behavior: "default_incomplete",
        "items[0][price]": priceId,
        "items[0][quantity]": "1",
        "expand[]": ["latest_invoice.payment_intent"],
        "metadata[syncpoly_user_id]": userId,
        "metadata[syncpoly_catalog_item_id]": item.itemId,
        "metadata[syncpoly_item_type]": item.itemType,
        "metadata[syncpoly_billing_interval]": interval,
        "metadata[syncpoly_reset_strategy]": "monthly"
      }, {
        idempotencyKey: stripeIdempotencyKey(checkoutRequest.key, "subscription")
      });
      const paymentChallenge = paymentChallengeFromSubscription(subscription);

      const responseBody = {
        checkoutRequired: false,
        chargedSavedPaymentMethod: !paymentChallenge,
        paymentActionRequired: Boolean(paymentChallenge),
        paymentChallenge,
        subscription: sanitizeSubscription(subscription),
        item: publicCatalogItem(pricedItem),
        stripeCustomerId: customerId,
        stripeProductId: pricedItem.stripeProductId,
        stripePriceId: priceId,
        paymentMethodId,
        interval
      };
      await finishCheckoutRequest(dynamodbClient, checkoutRequest, responseBody, 200, nowMs);
      return jsonResponse(200, responseBody, event);
    }

    const session = await stripe.post("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "metadata[syncpoly_user_id]": userId,
      "metadata[syncpoly_catalog_item_id]": item.itemId,
      "metadata[syncpoly_item_type]": item.itemType,
      "metadata[syncpoly_billing_interval]": interval,
      "subscription_data[metadata][syncpoly_user_id]": userId,
      "subscription_data[metadata][syncpoly_catalog_item_id]": item.itemId,
      "subscription_data[metadata][syncpoly_item_type]": item.itemType,
      "subscription_data[metadata][syncpoly_reset_strategy]": "monthly"
    }, {
      idempotencyKey: stripeIdempotencyKey(checkoutRequest.key, "checkout-session")
    });

    const responseBody = {
      checkoutRequired: true,
      checkout: {
        id: session.id,
        url: session.url
      },
      item: publicCatalogItem(pricedItem),
      stripeCustomerId: customerId,
      stripeProductId: pricedItem.stripeProductId,
      stripePriceId: priceId,
      interval
    };
    await finishCheckoutRequest(dynamodbClient, checkoutRequest, responseBody, 200, nowMs);
    return jsonResponse(200, responseBody, event);
  } catch (error) {
    console.error("Failed to load pricing", {
      message: error.message,
      name: error.name,
      stripeStatus: error.stripeStatus
    });

    return jsonResponse(error.statusCode || 500, { message: error.publicMessage || "Failed to load pricing." }, event);
  }
}

async function listCatalog(dynamodbClient) {
  const response = await dynamodbClient.send(
    new ScanCommand({
      TableName: process.env.BILLING_CATALOG_TABLE_NAME
    })
  );

  return (response.Items || [])
    .map(catalogItemFromDynamo)
    .filter((item) => item.status === "active")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(publicCatalogItem);
}

async function getCatalogItem(dynamodbClient, itemId) {
  const response = await dynamodbClient.send(
    new GetItemCommand({
      TableName: process.env.BILLING_CATALOG_TABLE_NAME,
      Key: {
        item_id: { S: itemId }
      }
    })
  );

  return response.Item ? catalogItemFromDynamo(response.Item) : undefined;
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

async function beginCheckoutRequest(dynamodbClient, { userId, itemId, interval, clientKey, nowMs }) {
  if (!process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME) {
    return { key: checkoutRequestKey({ userId, itemId, interval, clientKey }) };
  }

  const key = checkoutRequestKey({ userId, itemId, interval, clientKey });
  const existing = await getCheckoutRequest(dynamodbClient, key);
  if (existing) {
    return checkoutRequestResultFromItem(existing);
  }

  const now = Math.floor(nowMs() / 1000);
  const timestamp = new Date(nowMs()).toISOString();
  try {
    await dynamodbClient.send(
      new PutItemCommand({
        TableName: process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME,
        Item: {
          idempotency_key: { S: key },
          user_id: { S: userId },
          item_id: { S: itemId },
          interval: { S: interval },
          status: { S: "in_progress" },
          created_at: { S: timestamp },
          updated_at: { S: timestamp },
          ttl: { N: String(now + Number.parseInt(process.env.BILLING_CHECKOUT_REQUEST_TTL_SECONDS || "604800", 10)) }
        },
        ConditionExpression: "attribute_not_exists(idempotency_key)"
      })
    );
    return { key };
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      throw error;
    }
    const raced = await getCheckoutRequest(dynamodbClient, key);
    if (raced) {
      return checkoutRequestResultFromItem(raced);
    }
    throw error;
  }
}

async function getCheckoutRequest(dynamodbClient, key) {
  const response = await dynamodbClient.send(
    new GetItemCommand({
      TableName: process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME,
      Key: {
        idempotency_key: { S: key }
      }
    })
  );
  return response.Item;
}

function checkoutRequestResultFromItem(item) {
  if (item.response_json?.S) {
    return {
      key: item.idempotency_key.S,
      replayResponse: parseStoredJson(item.response_json.S),
      replayStatusCode: item.response_status?.N ? Number(item.response_status.N) : 200
    };
  }

  const error = new Error("Checkout request is already processing.");
  error.statusCode = 409;
  error.publicMessage = "Checkout request is already processing.";
  throw error;
}

async function finishCheckoutRequest(dynamodbClient, checkoutRequest, responseBody, statusCode, nowMs) {
  if (!process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME) {
    return;
  }

  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME,
      Key: {
        idempotency_key: { S: checkoutRequest.key }
      },
      UpdateExpression: "SET #status = :status, response_status = :responseStatus, response_json = :responseJson, updated_at = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": { S: "completed" },
        ":responseStatus": { N: String(statusCode) },
        ":responseJson": { S: JSON.stringify(responseBody) },
        ":updatedAt": { S: new Date(nowMs()).toISOString() }
      }
    })
  );
}

async function selectFreePlan({ dynamodbClient, userId, item, nowMs }) {
  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: {
        user_id: { S: userId }
      },
      UpdateExpression: "SET plan_id = :planId, entitlements_json = :entitlements, entitlements_reset_strategy = :resetStrategy, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":planId": { S: item.itemId },
        ":entitlements": { S: JSON.stringify(item.entitlements) },
        ":resetStrategy": { S: "monthly" },
        ":updatedAt": { S: new Date(nowMs()).toISOString() }
      }
    })
  );
}

async function ensureStripeCustomer({ dynamodbClient, stripe, user, nowMs, idempotencyKey }) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.post("/customers", {
    email: user.email || undefined,
    name: user.name || undefined,
    "metadata[syncpoly_user_id]": user.userId
  }, {
    idempotencyKey
  });
  const timestamp = new Date(nowMs()).toISOString();

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
        ":createdAt": { S: timestamp },
        ":updatedAt": { S: timestamp }
      }
    })
  );

  return customer.id;
}

async function ensureStripeProductAndPrices({ dynamodbClient, stripe, item, nowMs }) {
  let productId = item.stripeProductId;
  let monthPriceId = item.stripePriceMonthId;
  let yearPriceId = item.stripePriceYearId;
  let changed = false;

  if (!productId) {
    const product = await stripe.post("/products", {
      name: item.name,
      description: item.description || undefined,
      "metadata[syncpoly_catalog_item_id]": item.itemId,
      "metadata[syncpoly_item_type]": item.itemType
    }, {
      idempotencyKey: stripeCatalogIdempotencyKey(item.itemId, "product")
    });
    productId = product.id;
    changed = true;
  }

  if (!monthPriceId) {
    const price = await stripe.post("/prices", {
      product: productId,
      currency: item.currency,
      unit_amount: String(item.amountMonthlyCents),
      "recurring[interval]": "month",
      nickname: `${item.name} Monthly`,
      "metadata[syncpoly_catalog_item_id]": item.itemId,
      "metadata[syncpoly_billing_interval]": "month",
      "metadata[syncpoly_reset_strategy]": "monthly"
    }, {
      idempotencyKey: stripeCatalogIdempotencyKey(item.itemId, "price-month")
    });
    monthPriceId = price.id;
    changed = true;
  }

  if (!yearPriceId) {
    const price = await stripe.post("/prices", {
      product: productId,
      currency: item.currency,
      unit_amount: String(yearlyAmountCents(item)),
      "recurring[interval]": "year",
      nickname: `${item.name} Yearly`,
      "metadata[syncpoly_catalog_item_id]": item.itemId,
      "metadata[syncpoly_billing_interval]": "year",
      "metadata[syncpoly_reset_strategy]": "monthly",
      "metadata[syncpoly_yearly_discount_percent]": String(item.yearlyDiscountPercent)
    }, {
      idempotencyKey: stripeCatalogIdempotencyKey(item.itemId, "price-year")
    });
    yearPriceId = price.id;
    changed = true;
  }

  const updated = {
    ...item,
    stripeProductId: productId,
    stripePriceMonthId: monthPriceId,
    stripePriceYearId: yearPriceId
  };
  if (changed) {
    await persistStripeCatalogIds({ dynamodbClient, item: updated, nowMs });
  }
  return updated;
}

async function persistStripeCatalogIds({ dynamodbClient, item, nowMs }) {
  const values = {
    ":productId": { S: item.stripeProductId },
    ":updatedAt": { S: new Date(nowMs()).toISOString() }
  };
  const updates = ["stripe_product_id = :productId", "updated_at = :updatedAt"];

  if (item.stripePriceMonthId) {
    values[":monthPriceId"] = { S: item.stripePriceMonthId };
    updates.push("stripe_price_month_id = :monthPriceId");
  }
  if (item.stripePriceYearId) {
    values[":yearPriceId"] = { S: item.stripePriceYearId };
    updates.push("stripe_price_year_id = :yearPriceId");
  }

  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.BILLING_CATALOG_TABLE_NAME,
      Key: {
        item_id: { S: item.itemId }
      },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeValues: values
    })
  );
}

function yearlyAmountCents(item) {
  return Math.round(item.amountMonthlyCents * 12 * (1 - item.yearlyDiscountPercent / 100));
}

function catalogItemFromDynamo(item) {
  const amountMonthlyCents = item.amount_monthly_cents?.N ? Number(item.amount_monthly_cents.N) : 0;
  const yearlyDiscountPercent = item.yearly_discount_percent?.N ? Number(item.yearly_discount_percent.N) : YEARLY_DISCOUNT_PERCENT;
  return {
    itemId: item.item_id.S,
    itemType: item.item_type.S,
    checkoutMode: item.checkout_mode?.S || "subscription",
    name: item.name.S,
    description: item.description?.S || "",
    status: item.status?.S || "active",
    currency: item.currency?.S || "usd",
    amountMonthlyCents,
    amountYearlyCents: item.amount_yearly_cents?.N ? Number(item.amount_yearly_cents.N) : Math.round(amountMonthlyCents * 12 * (1 - yearlyDiscountPercent / 100)),
    yearlyDiscountPercent,
    sortOrder: item.sort_order?.N ? Number(item.sort_order.N) : 0,
    entitlements: parseEntitlements(item.entitlements_json?.S),
    stripeProductId: item.stripe_product_id?.S,
    stripePriceMonthId: item.stripe_price_month_id?.S,
    stripePriceYearId: item.stripe_price_year_id?.S
  };
}

function publicCatalogItem(item) {
  return {
    itemId: item.itemId,
    itemType: item.itemType,
    checkoutMode: item.checkoutMode,
    name: item.name,
    description: item.description,
    currency: item.currency,
    amountMonthlyCents: item.amountMonthlyCents,
    amountYearlyCents: item.amountYearlyCents,
    yearlyDiscountPercent: item.yearlyDiscountPercent,
    resetStrategy: "monthly",
    sortOrder: item.sortOrder,
    entitlements: item.entitlements,
    stripeProductId: item.stripeProductId || null,
    stripePriceMonthId: item.stripePriceMonthId || null,
    stripePriceYearId: item.stripePriceYearId || null
  };
}

function parseEntitlements(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseStoredJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonBody(body, isBase64Encoded = false) {
  if (!body) {
    return {};
  }

  const text = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.publicMessage = "Request body must be valid JSON.";
    throw error;
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

function createStripeClient(secretKey, fetchImpl) {
  return {
    get(path, params = {}) {
      const url = new URL(`${STRIPE_API_BASE}${path}`);
      appendStripeParams(url.searchParams, params);
      return stripeRequest(fetchImpl, secretKey, url, { method: "GET" });
    },
    post(path, params = {}, requestOptions = {}) {
      const body = new URLSearchParams();
      appendStripeParams(body, params);
      return stripeRequest(fetchImpl, secretKey, `${STRIPE_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      }, requestOptions);
    }
  };
}

async function stripeRequest(fetchImpl, secretKey, url, options, requestOptions = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "stripe-version": STRIPE_API_VERSION,
      ...(requestOptions.idempotencyKey ? { "idempotency-key": requestOptions.idempotencyKey } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Stripe API request failed.");
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
    error.stripeStatus = response.status;
    error.publicMessage = "Failed to create checkout session.";
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

async function getAvailablePaymentMethodId(stripe, customerId) {
  const customer = await stripe.get(`/customers/${encodeURIComponent(customerId)}`);
  const defaultPaymentMethodId = getDefaultPaymentMethodId(customer);
  if (defaultPaymentMethodId) {
    return defaultPaymentMethodId;
  }

  const paymentMethods = await stripe.get(`/customers/${encodeURIComponent(customerId)}/payment_methods`, {
    limit: "1"
  });
  return paymentMethods.data?.[0]?.id || "";
}

function getDefaultPaymentMethodId(customer) {
  const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;
  if (!defaultPaymentMethod) {
    return "";
  }
  return typeof defaultPaymentMethod === "string" ? defaultPaymentMethod : defaultPaymentMethod.id || "";
}

function sanitizeSubscription(subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start || null,
    currentPeriodEnd: subscription.current_period_end || null,
    latestInvoiceId: typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id || null
  };
}

function paymentChallengeFromSubscription(subscription) {
  const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  const paymentIntent = typeof invoice?.payment_intent === "object" ? invoice.payment_intent : null;
  if (!paymentIntent || paymentIntent.status !== "requires_action") {
    return null;
  }

  const confirmationSecret = typeof invoice?.confirmation_secret === "object" ? invoice.confirmation_secret : null;
  return {
    type: "payment_intent",
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret || confirmationSecret?.client_secret || null,
    status: paymentIntent.status,
    nextActionType: paymentIntent.next_action?.type || null
  };
}

function checkoutRequestKey({ userId, itemId, interval, clientKey }) {
  return `checkout_${hashParts([userId, itemId, interval, clientKey || "default"])}`;
}

function stripeIdempotencyKey(requestKey, action) {
  return `syncpoly_${action}_${hashParts([requestKey])}`;
}

function stripeCatalogIdempotencyKey(itemId, action) {
  return `syncpoly_catalog_${action}_${hashParts([itemId])}`;
}

function hashParts(parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonResponse(statusCode, body, event) {
  return {
    statusCode,
    headers: responseHeaders(event),
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}

function responseHeaders(event) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "300"
  };
  const origin = getHeader(event?.headers, "origin");
  if (allowedOrigins().has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}

function allowedOrigins() {
  return new Set(
    (process.env.AUTH_ALLOWED_ORIGINS || "https://syncpoly.com,https://www.syncpoly.com")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return undefined;
}
