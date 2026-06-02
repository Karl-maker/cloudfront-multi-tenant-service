import { createHmac } from "node:crypto";

export const TEST_NOW_SECONDS = 1_900_000_000;
export const TEST_NOW_MS = TEST_NOW_SECONDS * 1000;
export const TEST_SIGNING_KEY = "test-signing-key-with-enough-entropy-for-hmac-tests";

export function signJwt(payload, signingKey = TEST_SIGNING_KEY, header = { alg: "HS256", typ: "JWT" }) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function signStripeWebhookPayload(payload, webhookSecret, timestamp = TEST_NOW_SECONDS) {
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function decodeJsonBody(response) {
  return response.body ? JSON.parse(response.body) : {};
}

export function createMockClient(handler) {
  const calls = [];

  return {
    calls,
    async send(command) {
      calls.push(command);
      return handler(command);
    }
  };
}

export function createJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

export function localstackConfig() {
  return {
    endpoint: process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566",
    region: "us-east-1",
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test"
    }
  };
}

export function requireLocalStack(t) {
  if (!process.env.LOCALSTACK_ENDPOINT) {
    t.skip("Set LOCALSTACK_ENDPOINT=http://localhost:4566 to run LocalStack tests.");
    return false;
  }

  return true;
}
