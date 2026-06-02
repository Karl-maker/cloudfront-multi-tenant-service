import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { createAuthorizerHandler } from "../../lambdas/auth/authorizer/index.mjs";
import { createBillingSummaryHandler } from "../../lambdas/auth/billing-summary/index.mjs";
import { createGoogleLoginHandler } from "../../lambdas/auth/google-login/index.mjs";
import { createMeHandler } from "../../lambdas/auth/me/index.mjs";
import { createStripeWebhookHandler } from "../../lambdas/auth/stripe-webhook/index.mjs";
import { TEST_NOW_SECONDS, TEST_SIGNING_KEY, localstackConfig, requireLocalStack, signStripeWebhookPayload } from "./helpers.mjs";

test("LocalStack e2e serves auth and billing routes over HTTP", async (t) => {
  if (!requireLocalStack(t)) {
    return;
  }

  if (process.env.LOCALSTACK_E2E !== "1") {
    t.skip("Set LOCALSTACK_E2E=1 to run the LocalStack HTTP e2e test.");
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usersTable = `syncpoly-builder-users-e2e-${suffix}`;
  const loginsTable = `syncpoly-builder-logins-e2e-${suffix}`;
  const billingEventsTable = `syncpoly-builder-billing-events-e2e-${suffix}`;
  const googleSecretName = `syncpoly-builder-google-oauth-e2e-${suffix}`;
  const jwtSecretName = `syncpoly-builder-jwt-e2e-${suffix}`;
  const stripeSecretName = `syncpoly-builder-stripe-e2e-${suffix}`;

  const dynamodbClient = new DynamoDBClient(localstackConfig());
  const secretsClient = new SecretsManagerClient(localstackConfig());
  const oldEnv = { ...process.env };
  let server;

  t.after(async () => {
    process.env = oldEnv;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await ignoreNotFound(() => cleanupSecret(secretsClient, googleSecretName));
    await ignoreNotFound(() => cleanupSecret(secretsClient, jwtSecretName));
    await ignoreNotFound(() => cleanupSecret(secretsClient, stripeSecretName));
    await ignoreNotFound(() => cleanupTable(dynamodbClient, usersTable));
    await ignoreNotFound(() => cleanupTable(dynamodbClient, loginsTable));
    await ignoreNotFound(() => cleanupTable(dynamodbClient, billingEventsTable));
  });

  await createAuthTables(dynamodbClient, usersTable, loginsTable);
  await createBillingEventsTable(dynamodbClient, billingEventsTable);

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

  const stripeSecret = await secretsClient.send(
    new CreateSecretCommand({
      Name: stripeSecretName,
      SecretString: JSON.stringify({
        secret_key: "sk_test_e2e",
        webhook_secret: "whsec_e2e"
      })
    })
  );

  process.env.ACCESS_TOKEN_TTL_SECONDS = "3600";
  process.env.BILLING_EVENTS_TABLE_NAME = billingEventsTable;
  process.env.BILLING_EVENTS_TTL_SECONDS = "86400";
  process.env.GOOGLE_OAUTH_SECRET_ARN = googleSecret.ARN;
  process.env.JWT_AUDIENCE = "syncpoly-builder-api";
  process.env.JWT_ISSUER = "syncpoly-builder";
  process.env.JWT_SECRET_ARN = jwtSecret.ARN;
  process.env.LOGINS_TABLE_NAME = loginsTable;
  process.env.LOGINS_TTL_SECONDS = "86400";
  process.env.STRIPE_SECRET_ARN = stripeSecret.ARN;
  process.env.USERS_TABLE_NAME = usersTable;

  const authorizerHandler = createAuthorizerHandler({
    secretsClient,
    secretCache: {}
  });
  const googleLoginHandler = createGoogleLoginHandler({
    dynamodbClient,
    secretsClient,
    fetchImpl: mockGoogleFetch,
    nowMs: () => TEST_NOW_SECONDS * 1000,
    uuidFn: () => "login-e2e",
    secretCache: {}
  });
  const meHandler = createMeHandler({ dynamodbClient });
  const billingSummaryHandler = createBillingSummaryHandler({
    dynamodbClient,
    secretsClient,
    fetchImpl: mockStripeFetch,
    nowMs: () => TEST_NOW_SECONDS * 1000,
    secretCache: {}
  });
  const stripeWebhookHandler = createStripeWebhookHandler({
    dynamodbClient,
    secretsClient,
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  server = await startHttpHarness({
    authorizerHandler,
    billingSummaryHandler,
    googleLoginHandler,
    meHandler,
    stripeWebhookHandler
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const unauthorizedMe = await fetch(`${baseUrl}/auth/me`);
  assert.equal(unauthorizedMe.status, 401);

  const loginResponse = await fetch(`${baseUrl}/auth/google`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test"
    },
    body: JSON.stringify({ code: "google-code" })
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200, JSON.stringify(loginBody));
  assert.equal(loginBody.user.userId, "google:google-subject");
  assert.equal(loginBody.tokenType, "Bearer");

  const meResponse = await fetch(`${baseUrl}/auth/me`, {
    headers: {
      authorization: `Bearer ${loginBody.accessToken}`
    }
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200, JSON.stringify(meBody));
  assert.equal(meBody.user.email, "user@example.test");

  const stripePayload = JSON.stringify({
    id: "evt_e2e_failed",
    type: "invoice.payment_failed",
    created: TEST_NOW_SECONDS,
    data: {
      object: {
        object: "invoice",
        id: "in_e2e_failed",
        customer: "cus_e2e",
        subscription: "sub_e2e",
        status: "open",
        hosted_invoice_url: "https://invoice.example.test",
        next_payment_attempt: TEST_NOW_SECONDS + 600,
        amount_remaining: 2900
      }
    }
  });
  const webhookResponse = await fetch(`${baseUrl}/billing/stripe-webhook`, {
    method: "POST",
    headers: {
      "stripe-signature": signStripeWebhookPayload(stripePayload, "whsec_e2e", TEST_NOW_SECONDS)
    },
    body: stripePayload
  });
  assert.equal(webhookResponse.status, 200, await webhookResponse.text());

  const billingResponse = await fetch(`${baseUrl}/billing/summary`, {
    headers: {
      authorization: `Bearer ${loginBody.accessToken}`
    }
  });
  const billingBody = await billingResponse.json();
  assert.equal(billingResponse.status, 200, JSON.stringify(billingBody));
  assert.equal(billingBody.customer.id, "cus_e2e");
  assert.equal(billingBody.paymentMethods[0].card.last4, "4242");
  assert.equal(billingBody.dunning.status, "action_required");
});

async function startHttpHarness(handlers) {
  const server = createServer(async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const url = new URL(request.url, "http://127.0.0.1");
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));

      let lambdaResponse;
      if (request.method === "POST" && url.pathname === "/auth/google") {
        lambdaResponse = await handlers.googleLoginHandler(apiGatewayEvent({ body, headers, method: request.method }));
      } else if (request.method === "POST" && url.pathname === "/billing/stripe-webhook") {
        lambdaResponse = await handlers.stripeWebhookHandler(apiGatewayEvent({ body, headers, method: request.method }));
      } else if (request.method === "GET" && url.pathname === "/auth/me") {
        lambdaResponse = await invokeProtected(handlers.authorizerHandler, handlers.meHandler, { body, headers, method: request.method });
      } else if (request.method === "GET" && url.pathname === "/billing/summary") {
        lambdaResponse = await invokeProtected(handlers.authorizerHandler, handlers.billingSummaryHandler, { body, headers, method: request.method });
      } else {
        lambdaResponse = {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Not found." })
        };
      }

      response.writeHead(lambdaResponse.statusCode, lambdaResponse.headers || {});
      response.end(lambdaResponse.body || "");
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function invokeProtected(authorizerHandler, handler, { body, headers, method }) {
  const auth = await authorizerHandler({
    identitySource: [headers.authorization || ""],
    routeArn: "arn:local:route"
  });

  if (!auth.isAuthorized) {
    return {
      statusCode: 401,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Unauthorized." })
    };
  }

  return handler(
    apiGatewayEvent({
      body,
      headers,
      method,
      authorizerContext: auth.context
    })
  );
}

function apiGatewayEvent({ body, headers, method, authorizerContext = undefined }) {
  return {
    body,
    headers,
    isBase64Encoded: false,
    requestContext: {
      authorizer: authorizerContext ? { lambda: authorizerContext } : undefined,
      http: {
        method,
        sourceIp: "127.0.0.1"
      }
    }
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function createAuthTables(dynamodbClient, usersTable, loginsTable) {
  await dynamodbClient.send(
    new CreateTableCommand({
      TableName: usersTable,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "user_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "user_id", KeyType: "HASH" }]
    })
  );

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

  await waitForTable(dynamodbClient, usersTable);
  await waitForTable(dynamodbClient, loginsTable);
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

async function mockGoogleFetch(url) {
  const value = String(url);
  if (value === "https://oauth2.googleapis.com/token") {
    return jsonFetchResponse({
      id_token: "google-id-token",
      access_token: "google-access-token",
      expires_in: 3599,
      scope: "openid email profile"
    });
  }

  if (value.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    return jsonFetchResponse({
      aud: "google-client-id",
      iss: "https://accounts.google.com",
      exp: "4102444800",
      sub: "google-subject",
      email: "user@example.test",
      email_verified: "true",
      name: "Test User",
      picture: "https://example.test/avatar.png"
    });
  }

  throw new Error(`Unexpected Google URL in e2e test: ${value}`);
}

async function mockStripeFetch(url) {
  const parsed = new URL(String(url));

  if (parsed.pathname === "/v1/customers") {
    return jsonFetchResponse({ id: "cus_e2e" });
  }

  if (parsed.pathname === "/v1/customers/cus_e2e") {
    return jsonFetchResponse({
      id: "cus_e2e",
      email: "user@example.test",
      name: "Test User",
      balance: 0,
      currency: "usd",
      delinquent: true,
      invoice_settings: { default_payment_method: "pm_e2e" }
    });
  }

  if (parsed.pathname === "/v1/invoices") {
    return jsonFetchResponse({
      data: [
        {
          id: "in_e2e_failed",
          number: "SYNC-E2E-001",
          status: "open",
          currency: "usd",
          amount_due: 2900,
          amount_paid: 0,
          amount_remaining: 2900,
          attempt_count: 1,
          next_payment_attempt: 4102444800,
          hosted_invoice_url: "https://invoice.example.test"
        }
      ]
    });
  }

  if (parsed.pathname === "/v1/subscriptions") {
    return jsonFetchResponse({
      data: [
        {
          id: "sub_e2e",
          status: "past_due",
          currency: "usd",
          latest_invoice: "in_e2e_failed",
          items: { data: [] }
        }
      ]
    });
  }

  if (parsed.pathname.endsWith("/payment_methods")) {
    return jsonFetchResponse({
      data: [
        {
          id: "pm_e2e",
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

  throw new Error(`Unexpected Stripe URL in e2e test: ${String(url)}`);
}

function jsonFetchResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

async function cleanupTable(dynamodbClient, tableName) {
  await dynamodbClient.send(new DeleteTableCommand({ TableName: tableName }));
}

async function cleanupSecret(secretsClient, secretName) {
  await secretsClient.send(
    new DeleteSecretCommand({
      SecretId: secretName,
      ForceDeleteWithoutRecovery: true
    })
  );
}

async function ignoreNotFound(fn) {
  try {
    await fn();
  } catch (error) {
    if (!["NotFoundException", "ResourceNotFoundException", "NoSuchEntity", "ResourceNotFoundException"].includes(error.name)) {
      throw error;
    }
  }
}
