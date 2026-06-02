import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorizerHandler, verifyJwt } from "../../lambdas/auth/authorizer/index.mjs";
import { TEST_NOW_SECONDS, TEST_SIGNING_KEY, createMockClient, signJwt } from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.JWT_SECRET_ARN = "arn:test:jwt";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("authorizer denies missing and malformed bearer tokens without reading secrets", async (t) => {
  for (const identitySource of [[], ["Basic abc"], ["Bearer"]]) {
    await t.test(JSON.stringify(identitySource), async () => {
      const secretsClient = createMockClient(() => assert.fail("secrets should not be called"));
      const handler = createAuthorizerHandler({ secretsClient });

      const response = await handler({ identitySource, routeArn: "arn:route" });

      assert.deepEqual(response, { isAuthorized: false });
      assert.equal(secretsClient.calls.length, 0);
    });
  }
});

test("authorizer allows a valid Syncpoly JWT and returns safe context", async () => {
  const token = signJwt({
    iss: "syncpoly-builder",
    aud: "syncpoly-builder-api",
    sub: "google:subject",
    email: "user@example.test",
    name: "Test User",
    provider: "google",
    exp: TEST_NOW_SECONDS + 60
  });

  const handler = createAuthorizerHandler({
    secretsClient: createJwtSecretClient(),
    nowSeconds: () => TEST_NOW_SECONDS,
    secretCache: {}
  });

  const response = await handler({
    identitySource: [`Bearer ${token}`],
    routeArn: "arn:route"
  });

  assert.equal(response.isAuthorized, true);
  assert.deepEqual(response.context, {
    userId: "google:subject",
    email: "user@example.test",
    name: "Test User",
    provider: "google"
  });
});

test("authorizer denies expired, tampered, wrong issuer, wrong audience, and alg none tokens", async (t) => {
  const cases = [
    {
      name: "expired",
      token: signJwt({
        iss: "syncpoly-builder",
        aud: "syncpoly-builder-api",
        sub: "google:subject",
        exp: TEST_NOW_SECONDS - 1
      })
    },
    {
      name: "tampered signature",
      token: `${signJwt({
        iss: "syncpoly-builder",
        aud: "syncpoly-builder-api",
        sub: "google:subject",
        exp: TEST_NOW_SECONDS + 60
      }).slice(0, -1)}x`
    },
    {
      name: "wrong issuer",
      token: signJwt({
        iss: "not-syncpoly",
        aud: "syncpoly-builder-api",
        sub: "google:subject",
        exp: TEST_NOW_SECONDS + 60
      })
    },
    {
      name: "wrong audience",
      token: signJwt({
        iss: "syncpoly-builder",
        aud: "another-api",
        sub: "google:subject",
        exp: TEST_NOW_SECONDS + 60
      })
    },
    {
      name: "alg none",
      token: signJwt(
        {
          iss: "syncpoly-builder",
          aud: "syncpoly-builder-api",
          sub: "google:subject",
          exp: TEST_NOW_SECONDS + 60
        },
        TEST_SIGNING_KEY,
        { alg: "none", typ: "JWT" }
      )
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const handler = createAuthorizerHandler({
        secretsClient: createJwtSecretClient(),
        nowSeconds: () => TEST_NOW_SECONDS,
        secretCache: {}
      });

      const response = await handler({
        identitySource: [`Bearer ${testCase.token}`],
        routeArn: "arn:route"
      });

      assert.deepEqual(response, { isAuthorized: false });
    });
  }
});

test("verifyJwt rejects malformed tokens", () => {
  assert.throws(() => verifyJwt("not-a-jwt", TEST_SIGNING_KEY, TEST_NOW_SECONDS), /Malformed JWT/);
});

function createJwtSecretClient() {
  return createMockClient(() => ({
    SecretString: JSON.stringify({
      signing_key: TEST_SIGNING_KEY
    })
  }));
}
