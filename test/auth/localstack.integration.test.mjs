import test from "node:test";
import assert from "node:assert/strict";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand
} from "@aws-sdk/client-dynamodb";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { createGoogleLoginHandler } from "../../lambdas/auth/google-login/index.mjs";
import { createBillingSummaryHandler } from "../../lambdas/auth/billing-summary/index.mjs";
import { createStripeWebhookHandler } from "../../lambdas/auth/stripe-webhook/index.mjs";
import {
  TEST_NOW_MS,
  TEST_NOW_SECONDS,
  TEST_SIGNING_KEY,
  createJsonResponse,
  decodeJsonBody,
  localstackConfig,
  requireLocalStack,
  signStripeWebhookPayload
} from "./helpers.mjs";

test("LocalStack integration stores user and login audit records using Secrets Manager and DynamoDB", async (t) => {
  if (!requireLocalStack(t)) {
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usersTable = `syncpoly-builder-users-test-${suffix}`;
  const loginsTable = `syncpoly-builder-logins-test-${suffix}`;
  const googleSecretName = `syncpoly-builder-google-oauth-test-${suffix}`;
  const jwtSecretName = `syncpoly-builder-jwt-test-${suffix}`;

  const dynamodbClient = new DynamoDBClient(localstackConfig());
  const secretsClient = new SecretsManagerClient(localstackConfig());

  await createAuthTables(dynamodbClient, usersTable, loginsTable);

  const googleSecret = await secretsClient.send(
    new CreateSecretCommand({
      Name: googleSecretName,
      SecretString: JSON.stringify({
        client_id: "google-client-id",
        client_secret: "google-client-secret",
        redirect_uri: "https://app.example.test/callback"
      })
    })
  );

  const jwtSecret = await secretsClient.send(
    new CreateSecretCommand({
      Name: jwtSecretName,
      SecretString: JSON.stringify({
        signing_key: TEST_SIGNING_KEY
      })
    })
  );

  const oldEnv = { ...process.env };
  process.env.GOOGLE_OAUTH_SECRET_ARN = googleSecret.ARN;
  process.env.JWT_SECRET_ARN = jwtSecret.ARN;
  process.env.USERS_TABLE_NAME = usersTable;
  process.env.LOGINS_TABLE_NAME = loginsTable;
  process.env.LOGINS_TTL_SECONDS = "86400";

  t.after(async () => {
    process.env = oldEnv;
    await cleanupSecret(secretsClient, googleSecretName);
    await cleanupSecret(secretsClient, jwtSecretName);
    await cleanupTable(dynamodbClient, usersTable);
    await cleanupTable(dynamodbClient, loginsTable);
  });

  const handler = createGoogleLoginHandler({
    dynamodbClient,
    secretsClient,
    fetchImpl: createGoogleFetch(),
    nowMs: () => TEST_NOW_MS,
    uuidFn: () => "login-id",
    secretCache: {}
  });

  const response = await handler({
    body: JSON.stringify({ code: "google-code" }),
    headers: { "user-agent": "integration-test" },
    requestContext: {
      http: {
        method: "POST",
        sourceIp: "198.51.100.22"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = decodeJsonBody(response);
  assert.equal(body.user.userId, "google:google-subject");
  assert.equal(body.provider.accessToken, "google-access-token");

  const user = await dynamodbClient.send(
    new GetItemCommand({
      TableName: usersTable,
      Key: {
        user_id: { S: "google:google-subject" }
      }
    })
  );
  assert.equal(user.Item.email.S, "user@example.test");
  assert.equal(user.Item.email_verified.BOOL, true);

  const logins = await dynamodbClient.send(
    new QueryCommand({
      TableName: loginsTable,
      KeyConditionExpression: "user_id = :userId",
      ExpressionAttributeValues: {
        ":userId": { S: "google:google-subject" }
      }
    })
  );
  assert.equal(logins.Items.length, 1);
  assert.equal(logins.Items[0].ip_address.S, "198.51.100.22");
  assert.equal(logins.Items[0].ttl.N, String(TEST_NOW_SECONDS + 86400));
});

test("LocalStack integration persists Stripe customer ids and records signed dunning webhooks", async (t) => {
  if (!requireLocalStack(t)) {
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usersTable = `syncpoly-builder-users-billing-test-${suffix}`;
  const billingEventsTable = `syncpoly-builder-billing-events-test-${suffix}`;
  const stripeSecretName = `syncpoly-builder-stripe-test-${suffix}`;
  const webhookSecret = "whsec_integration";

  const dynamodbClient = new DynamoDBClient(localstackConfig());
  const secretsClient = new SecretsManagerClient(localstackConfig());

  await createUsersTable(dynamodbClient, usersTable);
  await createBillingEventsTable(dynamodbClient, billingEventsTable);

  const stripeSecret = await secretsClient.send(
    new CreateSecretCommand({
      Name: stripeSecretName,
      SecretString: JSON.stringify({
        secret_key: "sk_test_integration",
        webhook_secret: webhookSecret
      })
    })
  );

  await dynamodbClient.send(
    new PutItemCommand({
      TableName: usersTable,
      Item: {
        user_id: { S: "google:billing-subject" },
        email: { S: "billing@example.test" },
        name: { S: "Billing User" }
      }
    })
  );

  const oldEnv = { ...process.env };
  process.env.USERS_TABLE_NAME = usersTable;
  process.env.BILLING_EVENTS_TABLE_NAME = billingEventsTable;
  process.env.BILLING_EVENTS_TTL_SECONDS = "86400";
  process.env.STRIPE_SECRET_ARN = stripeSecret.ARN;

  t.after(async () => {
    process.env = oldEnv;
    await cleanupSecret(secretsClient, stripeSecretName);
    await cleanupTable(dynamodbClient, usersTable);
    await cleanupTable(dynamodbClient, billingEventsTable);
  });

  const webhookPayload = JSON.stringify({
    id: "evt_integration_failed",
    type: "invoice.payment_failed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "invoice",
        id: "in_integration_failed",
        customer: "cus_integration",
        subscription: "sub_integration",
        status: "open",
        hosted_invoice_url: "https://invoice.example.test",
        next_payment_attempt: TEST_NOW_SECONDS + 600,
        amount_remaining: 1200
      }
    }
  });
  const webhookHandler = createStripeWebhookHandler({
    dynamodbClient,
    secretsClient,
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  const webhookResponse = await webhookHandler({
    body: webhookPayload,
    headers: {
      "stripe-signature": signStripeWebhookPayload(webhookPayload, webhookSecret, TEST_NOW_SECONDS)
    }
  });

  assert.equal(webhookResponse.statusCode, 200);

  const billingHandler = createBillingSummaryHandler({
    dynamodbClient,
    secretsClient,
    fetchImpl: createStripeFetch(),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await billingHandler({
    requestContext: {
      authorizer: {
        lambda: {
          userId: "google:billing-subject"
        }
      }
    }
  });
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.customer.id, "cus_integration");
  assert.equal(body.dunning.status, "action_required");
  assert.equal(body.dunning.recentEvents[0].eventId, "latest-invoice:in_integration_failed");

  const user = await dynamodbClient.send(
    new GetItemCommand({
      TableName: usersTable,
      Key: {
        user_id: { S: "google:billing-subject" }
      }
    })
  );
  assert.equal(user.Item.stripe_customer_id.S, "cus_integration");
});

async function createAuthTables(dynamodbClient, usersTable, loginsTable) {
  await createUsersTable(dynamodbClient, usersTable);

  await dynamodbClient.send(
    new CreateTableCommand({
      TableName: loginsTable,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "user_id", AttributeType: "S" },
        { AttributeName: "login_id", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "user_id", KeyType: "HASH" },
        { AttributeName: "login_id", KeyType: "RANGE" }
      ]
    })
  );

  await waitForTable(dynamodbClient, loginsTable);
}

async function createUsersTable(dynamodbClient, usersTable) {
  await dynamodbClient.send(
    new CreateTableCommand({
      TableName: usersTable,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "user_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "user_id", KeyType: "HASH" }]
    })
  );

  await waitForTable(dynamodbClient, usersTable);
}

async function createBillingEventsTable(dynamodbClient, billingEventsTable) {
  await dynamodbClient.send(
    new CreateTableCommand({
      TableName: billingEventsTable,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "stripe_customer_id", AttributeType: "S" },
        { AttributeName: "stripe_event_id", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "stripe_customer_id", KeyType: "HASH" },
        { AttributeName: "stripe_event_id", KeyType: "RANGE" }
      ]
    })
  );

  await waitForTable(dynamodbClient, billingEventsTable);
}

async function waitForTable(dynamodbClient, tableName) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const response = await dynamodbClient.send(new DescribeTableCommand({ TableName: tableName }));
    if (response.Table?.TableStatus === "ACTIVE") {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw new Error(`Timed out waiting for DynamoDB table ${tableName} to become ACTIVE.`);
}

async function cleanupTable(dynamodbClient, tableName) {
  try {
    await dynamodbClient.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    // Best-effort cleanup for local tests.
  }
}

async function cleanupSecret(secretsClient, secretName) {
  try {
    await secretsClient.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: true
      })
    );
  } catch {
    // Best-effort cleanup for local tests.
  }
}

function createGoogleFetch() {
  let callCount = 0;

  return async () => {
    callCount += 1;

    if (callCount === 1) {
      return createJsonResponse({
        id_token: "google-id-token",
        access_token: "google-access-token",
        expires_in: 3599,
        scope: "openid email profile"
      });
    }

    return createJsonResponse({
      aud: "google-client-id",
      iss: "https://accounts.google.com",
      exp: String(TEST_NOW_SECONDS + 60),
      sub: "google-subject",
      email: "user@example.test",
      email_verified: "true",
      name: "Test User",
      picture: "https://example.test/avatar.png"
    });
  };
}

function createStripeFetch() {
  return async (url, options = {}) => {
    const parsed = new URL(String(url));
    assert.equal(options.headers.authorization, "Bearer sk_test_integration");

    if (parsed.pathname === "/v1/customers") {
      return createJsonResponse({ id: "cus_integration" });
    }

    if (parsed.pathname === "/v1/customers/cus_integration") {
      return createJsonResponse({
        id: "cus_integration",
        email: "billing@example.test",
        name: "Billing User",
        balance: 0,
        currency: "usd",
        delinquent: true,
        invoice_settings: {
          default_payment_method: "pm_integration"
        }
      });
    }

    if (parsed.pathname === "/v1/invoices") {
      return createJsonResponse({
        data: [
          {
            id: "in_integration_failed",
            number: "SYNC-INT-001",
            status: "open",
            currency: "usd",
            amount_due: 1200,
            amount_paid: 0,
            amount_remaining: 1200,
            attempt_count: 1,
            next_payment_attempt: TEST_NOW_SECONDS + 600,
            hosted_invoice_url: "https://invoice.example.test"
          }
        ]
      });
    }

    if (parsed.pathname === "/v1/subscriptions") {
      return createJsonResponse({
        data: [
          {
            id: "sub_integration",
            status: "past_due",
            currency: "usd",
            items: { data: [] },
            latest_invoice: "in_integration_failed"
          }
        ]
      });
    }

    if (parsed.pathname.endsWith("/payment_methods")) {
      return createJsonResponse({
        data: [
          {
            id: "pm_integration",
            type: "card",
            card: {
              brand: "visa",
              last4: "4242",
              exp_month: 12,
              exp_year: 2034
            }
          }
        ]
      });
    }

    assert.fail(`unexpected Stripe path ${parsed.pathname}`);
  };
}
