import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  CreateApiCommand,
  CreateAuthorizerCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  DeleteApiCommand,
  ApiGatewayV2Client
} from "@aws-sdk/client-apigatewayv2";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { CreateRoleCommand, DeleteRoleCommand, IAMClient } from "@aws-sdk/client-iam";
import {
  AddPermissionCommand,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  LambdaClient,
  waitUntilFunctionActive
} from "@aws-sdk/client-lambda";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { TEST_NOW_SECONDS, TEST_SIGNING_KEY, localstackConfig, requireLocalStack, signStripeWebhookPayload } from "./helpers.mjs";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);

test("LocalStack e2e serves Google login and protected /auth/me through API Gateway", async (t) => {
  if (!requireLocalStack(t)) {
    return;
  }

  if (process.env.LOCALSTACK_E2E !== "1") {
    t.skip("Set LOCALSTACK_E2E=1 to run the LocalStack API Gateway/Lambda e2e test.");
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usersTable = `syncpoly-builder-users-e2e-${suffix}`;
  const loginsTable = `syncpoly-builder-logins-e2e-${suffix}`;
  const googleSecretName = `syncpoly-builder-google-oauth-e2e-${suffix}`;
  const jwtSecretName = `syncpoly-builder-jwt-e2e-${suffix}`;
  const stripeSecretName = `syncpoly-builder-stripe-e2e-${suffix}`;
  const billingEventsTable = `syncpoly-builder-billing-events-e2e-${suffix}`;
  const roleName = `syncpoly-builder-e2e-role-${suffix}`;

  const dynamodbClient = new DynamoDBClient(localstackConfig());
  const secretsClient = new SecretsManagerClient(localstackConfig());
  const iamClient = new IAMClient(localstackConfig());
  const lambdaClient = new LambdaClient(localstackConfig());
  const apiGatewayClient = new ApiGatewayV2Client(localstackConfig());

  let apiId;
  const functionNames = [];

  t.after(async () => {
    if (apiId) {
      await ignoreNotFound(() => apiGatewayClient.send(new DeleteApiCommand({ ApiId: apiId })));
    }

    for (const functionName of functionNames) {
      await ignoreNotFound(() => lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName })));
    }

    await ignoreNotFound(() => iamClient.send(new DeleteRoleCommand({ RoleName: roleName })));
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

  const role = await iamClient.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole"
          }
        ]
      })
    })
  );

  const loginFunctionName = `syncpoly-builder-google-login-e2e-${suffix}`;
  const authorizerFunctionName = `syncpoly-builder-auth-authorizer-e2e-${suffix}`;
  const meFunctionName = `syncpoly-builder-auth-me-e2e-${suffix}`;
  const billingSummaryFunctionName = `syncpoly-builder-billing-summary-e2e-${suffix}`;
  const stripeWebhookFunctionName = `syncpoly-builder-stripe-webhook-e2e-${suffix}`;

  await createLambda(lambdaClient, {
    functionName: loginFunctionName,
    sourceDir: path.join(projectRoot, "lambdas/auth/google-login"),
    roleArn: role.Role.Arn,
    extraFiles: {
      "mock-google-fetch.mjs": mockGoogleModuleSource()
    },
    env: {
      ACCESS_TOKEN_TTL_SECONDS: "3600",
      GOOGLE_OAUTH_SECRET_ARN: googleSecret.ARN,
      JWT_AUDIENCE: "syncpoly-builder-api",
      JWT_ISSUER: "syncpoly-builder",
      JWT_SECRET_ARN: jwtSecret.ARN,
      LOGINS_TABLE_NAME: loginsTable,
      LOGINS_TTL_SECONDS: "86400",
      USERS_TABLE_NAME: usersTable,
      NODE_OPTIONS: "--import ./mock-google-fetch.mjs"
    }
  });
  functionNames.push(loginFunctionName);

  await createLambda(lambdaClient, {
    functionName: authorizerFunctionName,
    sourceDir: path.join(projectRoot, "lambdas/auth/authorizer"),
    roleArn: role.Role.Arn,
    env: {
      JWT_AUDIENCE: "syncpoly-builder-api",
      JWT_ISSUER: "syncpoly-builder",
      JWT_SECRET_ARN: jwtSecret.ARN
    }
  });
  functionNames.push(authorizerFunctionName);

  await createLambda(lambdaClient, {
    functionName: meFunctionName,
    sourceDir: path.join(projectRoot, "lambdas/auth/me"),
    roleArn: role.Role.Arn,
    env: {
      USERS_TABLE_NAME: usersTable
    }
  });
  functionNames.push(meFunctionName);

  await createLambda(lambdaClient, {
    functionName: billingSummaryFunctionName,
    sourceDir: path.join(projectRoot, "lambdas/auth/billing-summary"),
    roleArn: role.Role.Arn,
    extraFiles: {
      "mock-stripe-fetch.mjs": mockStripeModuleSource()
    },
    env: {
      BILLING_EVENTS_TABLE_NAME: billingEventsTable,
      STRIPE_SECRET_ARN: stripeSecret.ARN,
      USERS_TABLE_NAME: usersTable,
      NODE_OPTIONS: "--import ./mock-stripe-fetch.mjs"
    }
  });
  functionNames.push(billingSummaryFunctionName);

  await createLambda(lambdaClient, {
    functionName: stripeWebhookFunctionName,
    sourceDir: path.join(projectRoot, "lambdas/auth/stripe-webhook"),
    roleArn: role.Role.Arn,
    env: {
      BILLING_EVENTS_TABLE_NAME: billingEventsTable,
      BILLING_EVENTS_TTL_SECONDS: "86400",
      STRIPE_SECRET_ARN: stripeSecret.ARN
    }
  });
  functionNames.push(stripeWebhookFunctionName);

  const api = await apiGatewayClient.send(
    new CreateApiCommand({
      Name: `syncpoly-builder-auth-e2e-${suffix}`,
      ProtocolType: "HTTP",
      CorsConfiguration: {
        AllowCredentials: true,
        AllowHeaders: ["authorization", "content-type"],
        AllowMethods: ["GET", "POST", "OPTIONS"],
        AllowOrigins: ["https://app.example.test"]
      }
    })
  );
  apiId = api.ApiId;

  const loginIntegration = await createLambdaIntegration(apiGatewayClient, apiId, loginFunctionName);
  const authorizerIntegration = await createLambdaIntegration(apiGatewayClient, apiId, meFunctionName);
  const billingSummaryIntegration = await createLambdaIntegration(apiGatewayClient, apiId, billingSummaryFunctionName);
  const stripeWebhookIntegration = await createLambdaIntegration(apiGatewayClient, apiId, stripeWebhookFunctionName);
  const authorizer = await apiGatewayClient.send(
    new CreateAuthorizerCommand({
      ApiId: apiId,
      AuthorizerType: "REQUEST",
      AuthorizerUri: lambdaInvokeArn(authorizerFunctionName),
      EnableSimpleResponses: true,
      IdentitySource: ["$request.header.Authorization"],
      Name: "syncpoly-builder-jwt-authorizer",
      AuthorizerPayloadFormatVersion: "2.0",
      AuthorizerResultTtlInSeconds: 0
    })
  );

  await apiGatewayClient.send(
    new CreateRouteCommand({
      ApiId: apiId,
      RouteKey: "POST /auth/google",
      Target: `integrations/${loginIntegration.IntegrationId}`
    })
  );

  await apiGatewayClient.send(
    new CreateRouteCommand({
      ApiId: apiId,
      RouteKey: "GET /billing/summary",
      AuthorizationType: "CUSTOM",
      AuthorizerId: authorizer.AuthorizerId,
      Target: `integrations/${billingSummaryIntegration.IntegrationId}`
    })
  );

  await apiGatewayClient.send(
    new CreateRouteCommand({
      ApiId: apiId,
      RouteKey: "POST /billing/stripe-webhook",
      Target: `integrations/${stripeWebhookIntegration.IntegrationId}`
    })
  );

  await apiGatewayClient.send(
    new CreateRouteCommand({
      ApiId: apiId,
      RouteKey: "GET /auth/me",
      AuthorizationType: "CUSTOM",
      AuthorizerId: authorizer.AuthorizerId,
      Target: `integrations/${authorizerIntegration.IntegrationId}`
    })
  );

  await apiGatewayClient.send(
    new CreateStageCommand({
      ApiId: apiId,
      StageName: "$default",
      AutoDeploy: true
    })
  );

  for (const functionName of functionNames) {
    await lambdaClient.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: `AllowApiGateway-${functionName}`,
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: `arn:aws:execute-api:us-east-1:000000000000:${apiId}/*/*`
      })
    );
  }

  await waitForApiGateway();

  const baseUrl = `http://${apiId}.execute-api.localhost.localstack.cloud:4566`;
  const unauthorizedMe = await fetch(`${baseUrl}/auth/me`);
  assert.ok([401, 403].includes(unauthorizedMe.status), `expected protected /auth/me to reject, got ${unauthorizedMe.status}`);

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

  await waitUntilTableExists({ client: dynamodbClient, maxWaitTime: 20 }, { TableName: usersTable });
  await waitUntilTableExists({ client: dynamodbClient, maxWaitTime: 20 }, { TableName: loginsTable });
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

  await waitUntilTableExists({ client: dynamodbClient, maxWaitTime: 20 }, { TableName: billingEventsTable });
}

async function createLambda(lambdaClient, { functionName, sourceDir, roleArn, env, extraFiles = {} }) {
  const zipFile = await zipLambdaSource(sourceDir, extraFiles);

  await lambdaClient.send(
    new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      Role: roleArn,
      Code: {
        ZipFile: zipFile
      },
      Timeout: 15,
      MemorySize: 256,
      Environment: {
        Variables: {
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          ...env
        }
      }
    })
  );

  await waitUntilFunctionActive({ client: lambdaClient, maxWaitTime: 30 }, { FunctionName: functionName });
}

async function zipLambdaSource(sourceDir, extraFiles = {}) {
  const stagingDir = await mkdtemp(path.join(tmpdir(), "syncpoly-lambda-"));
  const zipPath = path.join(tmpdir(), `syncpoly-lambda-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);

  await cp(sourceDir, stagingDir, { recursive: true });
  await cp(path.join(projectRoot, "node_modules"), path.join(stagingDir, "node_modules"), { recursive: true });
  for (const [fileName, contents] of Object.entries(extraFiles)) {
    await writeFile(path.join(stagingDir, fileName), contents, "utf8");
  }

  execFileSync("zip", ["-qr", zipPath, "."], { cwd: stagingDir });
  const zipFile = await readFile(zipPath);
  await rm(stagingDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });

  return zipFile;
}

function mockGoogleModuleSource() {
  return `
globalThis.fetch = async (url) => {
  const value = String(url);
  if (value === "https://oauth2.googleapis.com/token") {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id_token: "google-id-token",
          access_token: "google-access-token",
          expires_in: 3599,
          scope: "openid email profile"
        };
      }
    };
  }

  if (value.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          aud: "google-client-id",
          iss: "https://accounts.google.com",
          exp: "4102444800",
          sub: "google-subject",
          email: "user@example.test",
          email_verified: "true",
          name: "Test User",
          picture: "https://example.test/avatar.png"
        };
      }
    };
  }

  throw new Error("Unexpected fetch URL in e2e test: " + value);
};
`;
}

function mockStripeModuleSource() {
  return `
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  const parsed = new URL(value);
  if (!value.startsWith("https://api.stripe.com/v1")) {
    return originalFetch(url, options);
  }

  if (parsed.pathname === "/v1/customers") {
    return response({ id: "cus_e2e" });
  }

  if (parsed.pathname === "/v1/customers/cus_e2e") {
    return response({
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
    return response({
      data: [{
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
      }]
    });
  }

  if (parsed.pathname === "/v1/subscriptions") {
    return response({
      data: [{
        id: "sub_e2e",
        status: "past_due",
        currency: "usd",
        latest_invoice: "in_e2e_failed",
        items: { data: [] }
      }]
    });
  }

  if (parsed.pathname.endsWith("/payment_methods")) {
    return response({
      data: [{
        id: "pm_e2e",
        type: "card",
        card: {
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: 2034
        }
      }]
    });
  }

  throw new Error("Unexpected Stripe URL in e2e test: " + value);
};

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}
`;
}

async function createLambdaIntegration(apiGatewayClient, apiId, functionName) {
  return apiGatewayClient.send(
    new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: "AWS_PROXY",
      IntegrationMethod: "POST",
      IntegrationUri: lambdaInvokeArn(functionName),
      PayloadFormatVersion: "2.0"
    })
  );
}

function lambdaInvokeArn(functionName) {
  return `arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:${functionName}/invocations`;
}

async function waitForApiGateway() {
  await new Promise((resolve) => {
    setTimeout(resolve, 1500);
  });
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
    if (!["NotFoundException", "ResourceNotFoundException", "NoSuchEntity"].includes(error.name)) {
      throw error;
    }
  }
}
