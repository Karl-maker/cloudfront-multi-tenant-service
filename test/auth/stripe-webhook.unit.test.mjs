import test from "node:test";
import assert from "node:assert/strict";
import { PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createStripeWebhookHandler, verifyStripeSignature } from "../../lambdas/auth/stripe-webhook/index.mjs";
import { TEST_NOW_SECONDS, createMockClient, decodeJsonBody, signStripeWebhookPayload } from "./helpers.mjs";

const oldEnv = { ...process.env };
const webhookSecret = "whsec_test_secret";

test.beforeEach(() => {
  process.env.STRIPE_SECRET_ARN = "arn:test:stripe";
  process.env.BILLING_EVENTS_TABLE_NAME = "billing-events-table";
  process.env.BILLING_EVENTS_TTL_SECONDS = "86400";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("verifyStripeSignature accepts valid signatures and rejects missing, stale, and mismatched signatures", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const signature = signStripeWebhookPayload(payload, webhookSecret, TEST_NOW_SECONDS);

  assert.doesNotThrow(() => verifyStripeSignature(payload, signature, webhookSecret, TEST_NOW_SECONDS));
  assert.throws(() => verifyStripeSignature(payload, undefined, webhookSecret, TEST_NOW_SECONDS), /Missing Stripe signature/);
  assert.throws(() => verifyStripeSignature(payload, signature, webhookSecret, TEST_NOW_SECONDS + 301), /outside tolerance/);
  assert.throws(() => verifyStripeSignature(payload, signature.replace(/.$/, "0"), webhookSecret, TEST_NOW_SECONDS), /signature mismatch/i);
});

test("Stripe webhook verifies the raw body, records dunning events, and deduplicates by event id", async () => {
  const payload = JSON.stringify({
    id: "evt_failed",
    type: "invoice.payment_failed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "invoice",
        id: "in_failed",
        customer: "cus_123",
        subscription: "sub_123",
        status: "open",
        hosted_invoice_url: "https://invoice.example.test",
        next_payment_attempt: TEST_NOW_SECONDS + 600,
        amount_remaining: 5000
      }
    }
  });
  const dynamodbClient = createMockClient((command) => {
    assert.ok(command instanceof PutItemCommand || command instanceof UpdateItemCommand);
    return {};
  });
  const handler = createStripeWebhookHandler({
    dynamodbClient,
    secretsClient: createStripeSecretClient(),
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  const response = await handler({
    body: payload,
    headers: {
      "stripe-signature": signStripeWebhookPayload(payload, webhookSecret, TEST_NOW_SECONDS)
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(decodeJsonBody(response), { received: true });
  assert.equal(dynamodbClient.calls.length, 2);
  assert.equal(dynamodbClient.calls[0].input.ConditionExpression, "attribute_not_exists(stripe_event_id)");
  assert.equal(dynamodbClient.calls[0].input.Item.stripe_customer_id.S, "cus_123");
  assert.equal(dynamodbClient.calls[0].input.Item.ttl.N, String(TEST_NOW_SECONDS + 86400));
  assert.equal(dynamodbClient.calls[1].input.Key.stripe_event_id.S, "latest-invoice:in_failed");
});

test("Stripe webhook rejects invalid signatures before writing records", async () => {
  const dynamodbClient = createMockClient(() => assert.fail("dynamodb should not be called"));
  const handler = createStripeWebhookHandler({
    dynamodbClient,
    secretsClient: createStripeSecretClient(),
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  const response = await handler({
    body: JSON.stringify({ id: "evt_bad" }),
    headers: {
      "stripe-signature": "t=1900000000,v1=bad"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(decodeJsonBody(response).message, "Invalid Stripe signature.");
  assert.equal(dynamodbClient.calls.length, 0);
});

test("Stripe webhook treats duplicate event ids as idempotent success", async () => {
  const payload = JSON.stringify({
    id: "evt_duplicate",
    type: "invoice.payment_failed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "invoice",
        id: "in_duplicate",
        customer: "cus_123",
        status: "open"
      }
    }
  });
  let callCount = 0;
  const dynamodbClient = createMockClient((command) => {
    callCount += 1;
    if (command instanceof PutItemCommand) {
      const error = new Error("duplicate");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }

    assert.ok(command instanceof UpdateItemCommand);
    return {};
  });
  const handler = createStripeWebhookHandler({
    dynamodbClient,
    secretsClient: createStripeSecretClient(),
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  const response = await handler({
    body: payload,
    headers: {
      "stripe-signature": signStripeWebhookPayload(payload, webhookSecret, TEST_NOW_SECONDS)
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(callCount, 2);
});

function createStripeSecretClient() {
  return createMockClient((command) => {
    assert.ok(command instanceof GetSecretValueCommand);
    return {
      SecretString: JSON.stringify({
        secret_key: "sk_test_secret",
        webhook_secret: webhookSecret
      })
    };
  });
}
