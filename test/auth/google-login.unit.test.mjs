import test from "node:test";
import assert from "node:assert/strict";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createGoogleLoginHandler } from "../../lambdas/auth/google-login/index.mjs";
import {
  TEST_NOW_MS,
  TEST_NOW_SECONDS,
  TEST_SIGNING_KEY,
  createJsonResponse,
  createMockClient,
  decodeJsonBody
} from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.GOOGLE_OAUTH_SECRET_ARN = "arn:test:google-oauth";
  process.env.JWT_SECRET_ARN = "arn:test:jwt";
  process.env.USERS_TABLE_NAME = "users-table";
  process.env.LOGINS_TABLE_NAME = "logins-table";
  process.env.LOGINS_TTL_SECONDS = "7776000";
  process.env.ACCESS_TOKEN_TTL_SECONDS = "3600";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("google login returns 400 without an authorization code and does not call AWS", async () => {
  const secretsClient = createMockClient(() => assert.fail("secrets should not be called"));
  const dynamodbClient = createMockClient(() => assert.fail("dynamodb should not be called"));
  const handler = createGoogleLoginHandler({ secretsClient, dynamodbClient });

  const response = await handler({
    body: JSON.stringify({}),
    requestContext: { http: { method: "POST" } }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(secretsClient.calls.length, 0);
  assert.equal(dynamodbClient.calls.length, 0);
});

test("google login returns CORS headers for www.syncpoly.com JSON requests", async () => {
  const handler = createGoogleLoginHandler({
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    dynamodbClient: createMockClient(() => assert.fail("dynamodb should not be called"))
  });

  const response = await handler({
    body: JSON.stringify({}),
    headers: {
      Origin: "https://www.syncpoly.com",
      "content-type": "application/json"
    },
    requestContext: { http: { method: "POST" } }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["access-control-allow-origin"], "https://www.syncpoly.com");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.match(response.headers["access-control-allow-headers"], /content-type/);
});

test("google login handles CORS preflight for www.syncpoly.com", async () => {
  const handler = createGoogleLoginHandler();
  const response = await handler({
    headers: {
      Origin: "https://www.syncpoly.com",
      "access-control-request-headers": "content-type"
    },
    requestContext: { http: { method: "OPTIONS" } }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "https://www.syncpoly.com");
  assert.match(response.headers["access-control-allow-methods"], /POST/);
  assert.equal(response.body, "");
});

test("google login rejects malformed JSON without leaking internals", async () => {
  const handler = createGoogleLoginHandler();
  const response = await handler({
    body: "{",
    requestContext: { http: { method: "POST" } }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(decodeJsonBody(response), { message: "Request body must be valid JSON." });
});

test("google login exchanges the code, validates Google identity, stores records, and returns a Syncpoly JWT", async () => {
  const secretsClient = createMockClient((command) => {
    assert.ok(command instanceof GetSecretValueCommand);

    if (command.input.SecretId === process.env.GOOGLE_OAUTH_SECRET_ARN) {
      return {
        SecretString: JSON.stringify({
          client_id: "google-client-id",
          client_secret: "google-client-secret",
          redirect_uri: "https://app.example.test/callback"
        })
      };
    }

    return {
      SecretString: JSON.stringify({
        signing_key: TEST_SIGNING_KEY
      })
    };
  });

  const dynamodbClient = createMockClient((command) => {
    assert.ok(command instanceof UpdateItemCommand || command instanceof PutItemCommand);
    return {};
  });

  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url: String(url), options });

    if (String(url) === "https://oauth2.googleapis.com/token") {
      assert.equal(options.method, "POST");
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("code"), "google-code");
      assert.equal(body.get("client_secret"), "google-client-secret");
      assert.equal(body.get("redirect_uri"), "https://app.example.test/callback");

      return createJsonResponse({
        id_token: "google-id-token",
        access_token: "google-access-token",
        expires_in: 3599,
        scope: "openid email profile"
      });
    }

    assert.match(String(url), /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=google-id-token$/);
    return createJsonResponse({
      aud: "google-client-id",
      iss: "https://accounts.google.com",
      exp: String(TEST_NOW_SECONDS + 120),
      sub: "google-subject",
      email: "user@example.test",
      email_verified: "true",
      name: "Test User",
      picture: "https://example.test/avatar.png"
    });
  };

  const handler = createGoogleLoginHandler({
    secretsClient,
    dynamodbClient,
    fetchImpl,
    nowMs: () => TEST_NOW_MS,
    uuidFn: () => "login-id",
    secretCache: {}
  });

  const response = await handler({
    body: JSON.stringify({ code: "google-code" }),
    headers: { "user-agent": "node-test" },
    requestContext: {
      http: {
        method: "POST",
        sourceIp: "203.0.113.10"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(fetchCalls.length, 2);
  assert.equal(dynamodbClient.calls.length, 2);
  assert.ok(dynamodbClient.calls[0] instanceof UpdateItemCommand);
  assert.equal(dynamodbClient.calls[0].input.UpdateExpression.includes("stripe_customer_id"), false);

  const responseBody = decodeJsonBody(response);
  assert.equal(responseBody.tokenType, "Bearer");
  assert.equal(responseBody.expiresAt, TEST_NOW_SECONDS + 3600);
  assert.equal(responseBody.user.userId, "google:google-subject");
  assert.equal(responseBody.provider.accessToken, "google-access-token");
  assert.equal(JSON.stringify(responseBody).includes("google-client-secret"), false);

  const [header, payload] = responseBody.accessToken.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "HS256");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), {
    iss: "syncpoly-builder",
    aud: "syncpoly-builder-api",
    sub: "google:google-subject",
    email: "user@example.test",
    name: "Test User",
    picture: "https://example.test/avatar.png",
    provider: "google",
    iat: TEST_NOW_SECONDS,
    exp: TEST_NOW_SECONDS + 3600
  });

  const loginRecord = dynamodbClient.calls[1].input.Item;
  assert.equal(loginRecord.ttl.N, String(TEST_NOW_SECONDS + 7776000));
  assert.equal(loginRecord.ip_address.S, "203.0.113.10");
  assert.equal(loginRecord.user_agent.S, "node-test");
});

test("google login rejects invalid Google audience and writes no records", async () => {
  const handler = createGoogleLoginHandler({
    secretsClient: createSecretsClient(),
    dynamodbClient: createMockClient(() => assert.fail("dynamodb should not be called")),
    fetchImpl: createGoogleFetch({
      aud: "other-client-id",
      iss: "https://accounts.google.com",
      exp: String(TEST_NOW_SECONDS + 60),
      email: "user@example.test",
      email_verified: "true"
    }),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler({ body: JSON.stringify({ code: "code" }) });

  assert.equal(response.statusCode, 401);
  assert.equal(decodeJsonBody(response).message, "Google ID token audience mismatch.");
});

test("google login rejects invalid issuer, expired token, and unverified email", async (t) => {
  const cases = [
    {
      name: "issuer",
      tokenInfo: {
        aud: "google-client-id",
        iss: "https://evil.example",
        exp: String(TEST_NOW_SECONDS + 60),
        email: "user@example.test",
        email_verified: "true"
      },
      message: "Google ID token issuer mismatch."
    },
    {
      name: "expiration",
      tokenInfo: {
        aud: "google-client-id",
        iss: "https://accounts.google.com",
        exp: String(TEST_NOW_SECONDS - 1),
        email: "user@example.test",
        email_verified: "true"
      },
      message: "Google ID token is expired."
    },
    {
      name: "verified email",
      tokenInfo: {
        aud: "google-client-id",
        iss: "https://accounts.google.com",
        exp: String(TEST_NOW_SECONDS + 60),
        email: "user@example.test",
        email_verified: "false",
        sub: "google-subject"
      },
      message: "Google account email is not verified."
    },
    {
      name: "subject",
      tokenInfo: {
        aud: "google-client-id",
        iss: "https://accounts.google.com",
        exp: String(TEST_NOW_SECONDS + 60),
        email: "user@example.test",
        email_verified: "true",
        sub: ""
      },
      message: "Google ID token subject is missing."
    }
  ];

  for (const testCase of cases) {
    await t.test(`rejects invalid ${testCase.name}`, async () => {
      const handler = createGoogleLoginHandler({
        secretsClient: createSecretsClient(),
        dynamodbClient: createMockClient(() => assert.fail("dynamodb should not be called")),
        fetchImpl: createGoogleFetch(testCase.tokenInfo),
        nowMs: () => TEST_NOW_MS,
        secretCache: {}
      });

      const response = await handler({ body: JSON.stringify({ code: "code" }) });

      assert.equal(response.statusCode, 401);
      assert.equal(decodeJsonBody(response).message, testCase.message);
    });
  }
});

test("google login returns Google's OAuth error without exposing secret values", async () => {
  const handler = createGoogleLoginHandler({
    secretsClient: createSecretsClient(),
    dynamodbClient: createMockClient(() => assert.fail("dynamodb should not be called")),
    fetchImpl: async () =>
      createJsonResponse(
        {
          error: "invalid_grant",
          error_description: "Bad authorization code"
        },
        { ok: false, status: 400 }
      ),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler({ body: JSON.stringify({ code: "bad-code" }) });

  assert.equal(response.statusCode, 401);
  assert.equal(decodeJsonBody(response).message, "Bad authorization code");
  assert.equal(response.body.includes("google-client-secret"), false);
});

function createSecretsClient() {
  return createMockClient((command) => {
    if (command.input.SecretId === process.env.GOOGLE_OAUTH_SECRET_ARN) {
      return {
        SecretString: JSON.stringify({
          client_id: "google-client-id",
          client_secret: "google-client-secret",
          redirect_uri: "https://app.example.test/callback"
        })
      };
    }

    return {
      SecretString: JSON.stringify({
        signing_key: TEST_SIGNING_KEY
      })
    };
  });
}

function createGoogleFetch(tokenInfo) {
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
      sub: "google-subject",
      name: "Test User",
      picture: "https://example.test/avatar.png",
      ...tokenInfo
    });
  };
}
