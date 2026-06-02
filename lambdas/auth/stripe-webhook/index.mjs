import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHmac, timingSafeEqual } from "node:crypto";

const dynamodb = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});

const DEFAULT_TOLERANCE_SECONDS = 300;

let stripeSecretCache;

export const handler = createStripeWebhookHandler();

export function createStripeWebhookHandler({
  dynamodbClient = dynamodb,
  secretsClient = secrets,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  secretCache = {}
} = {}) {
  return async function stripeWebhookHandler(event) {
    return handleStripeWebhook(event, {
      dynamodbClient,
      secretsClient,
      nowSeconds,
      secretCache
    });
  };
}

export async function handleStripeWebhook(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;
  const secretsClient = deps.secretsClient || secrets;
  const nowSeconds = deps.nowSeconds || (() => Math.floor(Date.now() / 1000));
  const secretCache = deps.secretCache || {};

  try {
    const signature = getHeader(event.headers, "stripe-signature");
    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    const stripeSecret = await getStripeSecret(secretsClient, secretCache);

    if (!stripeSecret.webhook_secret) {
      return jsonResponse(500, { message: "Stripe webhook secret is not configured." });
    }

    verifyStripeSignature(body, signature, stripeSecret.webhook_secret, nowSeconds());
    const stripeEvent = JSON.parse(body);
    await recordStripeEvent(dynamodbClient, stripeEvent, nowSeconds());

    return jsonResponse(200, { received: true });
  } catch (error) {
    console.warn("Stripe webhook rejected", {
      message: error.message,
      name: error.name
    });

    return jsonResponse(error.statusCode || 400, {
      message: error.publicMessage || "Invalid Stripe webhook."
    });
  }
}

export function verifyStripeSignature(payload, signatureHeader, webhookSecret, now, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS) {
  if (!signatureHeader) {
    const error = new Error("Missing Stripe signature.");
    error.statusCode = 400;
    error.publicMessage = "Missing Stripe signature.";
    throw error;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    })
  );

  const timestamp = Number.parseInt(parts.t, 10);
  if (!timestamp || Math.abs(now - timestamp) > toleranceSeconds) {
    const error = new Error("Stripe signature timestamp is outside tolerance.");
    error.statusCode = 400;
    error.publicMessage = "Invalid Stripe signature.";
    throw error;
  }

  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const received = parts.v1 || "";
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    const error = new Error("Stripe signature mismatch.");
    error.statusCode = 400;
    error.publicMessage = "Invalid Stripe signature.";
    throw error;
  }
}

async function recordStripeEvent(dynamodbClient, stripeEvent, nowSeconds) {
  const object = stripeEvent.data?.object || {};
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  const invoiceId = object.object === "invoice" ? object.id : object.invoice;
  const subscriptionId = object.subscription || (object.object === "subscription" ? object.id : undefined);

  if (!customerId || !process.env.BILLING_EVENTS_TABLE_NAME) {
    return;
  }

  try {
    await dynamodbClient.send(
      new PutItemCommand({
        TableName: process.env.BILLING_EVENTS_TABLE_NAME,
        Item: {
          stripe_customer_id: { S: customerId },
          stripe_event_id: { S: stripeEvent.id },
          event_type: { S: stripeEvent.type },
          invoice_id: { S: invoiceId || "" },
          subscription_id: { S: subscriptionId || "" },
          status: { S: object.status || "" },
          hosted_invoice_url: { S: object.hosted_invoice_url || "" },
          next_payment_attempt: { N: String(object.next_payment_attempt || 0) },
          amount_remaining: { N: String(object.amount_remaining || 0) },
          created_at: { S: new Date((stripeEvent.created || nowSeconds) * 1000).toISOString() },
          ttl: { N: String(nowSeconds + Number.parseInt(process.env.BILLING_EVENTS_TTL_SECONDS || "15552000", 10)) }
        },
        ConditionExpression: "attribute_not_exists(stripe_event_id)"
      })
    );
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      throw error;
    }
  }

  if (invoiceId && ["invoice.payment_failed", "invoice.updated", "invoice.payment_succeeded"].includes(stripeEvent.type)) {
    await dynamodbClient.send(
      new UpdateItemCommand({
        TableName: process.env.BILLING_EVENTS_TABLE_NAME,
        Key: {
          stripe_customer_id: { S: customerId },
          stripe_event_id: { S: `latest-invoice:${invoiceId}` }
        },
        UpdateExpression: [
          "SET event_type = :eventType",
          "invoice_id = :invoiceId",
          "subscription_id = :subscriptionId",
          "#status = :status",
          "hosted_invoice_url = :hostedInvoiceUrl",
          "next_payment_attempt = :nextPaymentAttempt",
          "amount_remaining = :amountRemaining",
          "created_at = :createdAt",
          "#ttl = :ttl"
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
          "#ttl": "ttl"
        },
        ExpressionAttributeValues: {
          ":eventType": { S: stripeEvent.type },
          ":invoiceId": { S: invoiceId },
          ":subscriptionId": { S: subscriptionId || "" },
          ":status": { S: object.status || "" },
          ":hostedInvoiceUrl": { S: object.hosted_invoice_url || "" },
          ":nextPaymentAttempt": { N: String(object.next_payment_attempt || 0) },
          ":amountRemaining": { N: String(object.amount_remaining || 0) },
          ":createdAt": { S: new Date((stripeEvent.created || nowSeconds) * 1000).toISOString() },
          ":ttl": { N: String(nowSeconds + Number.parseInt(process.env.BILLING_EVENTS_TTL_SECONDS || "15552000", 10)) }
        }
      })
    );
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

function getHeader(headers = {}, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
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
