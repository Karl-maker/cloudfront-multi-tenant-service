import test from "node:test";
import assert from "node:assert/strict";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createMeHandler } from "../../lambdas/auth/me/index.mjs";
import { createMockClient, decodeJsonBody } from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.USERS_TABLE_NAME = "users-table";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("/auth/me returns 401 without authorizer context", async () => {
  const dynamodbClient = createMockClient(() => assert.fail("dynamodb should not be called"));
  const handler = createMeHandler({ dynamodbClient });

  const response = await handler({ requestContext: {} });

  assert.equal(response.statusCode, 401);
});

test("/auth/me returns 404 when the user record is absent", async () => {
  const dynamodbClient = createMockClient((command) => {
    assert.ok(command instanceof GetItemCommand);
    assert.deepEqual(command.input.Key, { user_id: { S: "google:subject" } });
    return {};
  });
  const handler = createMeHandler({ dynamodbClient });

  const response = await handler({
    requestContext: {
      authorizer: {
        lambda: {
          userId: "google:subject"
        }
      }
    }
  });

  assert.equal(response.statusCode, 404);
});

test("/auth/me returns the current user profile", async () => {
  const dynamodbClient = createMockClient(() => ({
    Item: {
      user_id: { S: "google:subject" },
      provider: { S: "google" },
      provider_subject: { S: "subject" },
      email: { S: "user@example.test" },
      email_verified: { BOOL: true },
      name: { S: "Test User" },
      picture: { S: "https://example.test/avatar.png" },
      stripe_customer_id: { S: "cus_123" },
      last_login_at: { S: "2030-01-01T00:00:00.000Z" },
      updated_at: { S: "2030-01-01T00:00:00.000Z" }
    }
  }));
  const handler = createMeHandler({ dynamodbClient });

  const response = await handler({
    requestContext: {
      authorizer: {
        lambda: {
          userId: "google:subject"
        }
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(decodeJsonBody(response).user, {
    userId: "google:subject",
    provider: "google",
    providerSubject: "subject",
    email: "user@example.test",
    emailVerified: true,
    name: "Test User",
    picture: "https://example.test/avatar.png",
    stripeCustomerId: "cus_123",
    lastLoginAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z"
  });
});
