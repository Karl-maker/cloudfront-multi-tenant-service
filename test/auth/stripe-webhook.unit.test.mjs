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
  process.env.USERS_TABLE_NAME = "users-table";
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
  assert.match(dynamodbClient.calls[1].input.UpdateExpression, /#ttl = :ttl/);
  assert.equal(dynamodbClient.calls[1].input.ExpressionAttributeNames["#ttl"], "ttl");
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

test("Stripe webhook grants an additional website credit after one-time payment succeeds", async () => {
  const payload = JSON.stringify({
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_123",
        customer: "cus_123",
        status: "complete",
        payment_status: "paid",
        metadata: {
          syncpoly_user_id: "google:subject",
          syncpoly_catalog_item_id: "additional_website_one_time",
          syncpoly_payment_source: "checkout_session"
        }
      }
    }
  });
  const updates = [];
  const handler = createStripeWebhookHandler({
    dynamodbClient: createMockClient((command) => {
      assert.ok(command instanceof PutItemCommand || command instanceof UpdateItemCommand);
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
      }
      return {};
    }),
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
  assert.equal(updates.length, 1);
  assert.equal(updates[0].TableName, "users-table");
  assert.equal(updates[0].Key.user_id.S, "google:subject");
  assert.equal(updates[0].ExpressionAttributeValues[":amount"].N, "1");
});

test("Stripe webhook grants 10MB media storage after the media add-on succeeds", async () => {
  const payload = JSON.stringify({
    id: "evt_media_storage_completed",
    type: "checkout.session.completed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_media",
        customer: "cus_123",
        status: "complete",
        payment_status: "paid",
        metadata: {
          syncpoly_user_id: "google:subject",
          syncpoly_catalog_item_id: "media_storage_10mb_one_time",
          syncpoly_payment_source: "checkout_session"
        }
      }
    }
  });
  const updates = [];
  const handler = createStripeWebhookHandler({
    dynamodbClient: createMockClient((command) => {
      assert.ok(command instanceof PutItemCommand || command instanceof UpdateItemCommand);
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
      }
      return {};
    }),
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
  assert.equal(updates.length, 1);
  assert.equal(updates[0].UpdateExpression, "SET updated_at = :updatedAt ADD additional_media_storage_mb :amount");
  assert.equal(updates[0].ExpressionAttributeValues[":amount"].N, "10");
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
