import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHmac, timingSafeEqual } from "node:crypto";

const secrets = new SecretsManagerClient({});
const ISSUER = process.env.JWT_ISSUER || "syncpoly-builder";
const AUDIENCE = process.env.JWT_AUDIENCE || "syncpoly-builder-api";

let jwtSecretCache;

export const handler = createAuthorizerHandler();

export function createAuthorizerHandler({
  secretsClient = secrets,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  secretCache = {}
} = {}) {
  return async function authorizerHandler(event) {
    return handleAuthorize(event, {
      secretsClient,
      nowSeconds,
      secretCache
    });
  };
}

export async function handleAuthorize(event, deps = {}) {
  const secretsClient = deps.secretsClient || secrets;
  const nowSeconds = deps.nowSeconds || (() => Math.floor(Date.now() / 1000));
  const secretCache = deps.secretCache || {};

  try {
    const token = extractBearerToken(event.identitySource);
    if (!token) {
      return deny();
    }

    const jwtSecret = await getJwtSecret(secretsClient, secretCache);
    const claims = verifyJwt(token, jwtSecret.signing_key, nowSeconds());

    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) {
      return deny();
    }

    return {
      isAuthorized: true,
      context: {
        userId: claims.sub,
        email: claims.email || "",
        name: claims.name || "",
        provider: claims.provider || ""
      }
    };
  } catch (error) {
    console.warn("JWT authorization failed", {
      message: error.message,
      routeArn: event.routeArn
    });
    return deny();
  }
}

function extractBearerToken(identitySource = []) {
  const header = Array.isArray(identitySource) ? identitySource.find(Boolean) : identitySource;
  if (!header || typeof header !== "string") {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function getJwtSecret(secretsClient, secretCache = {}) {
  if (secretCache.jwt || jwtSecretCache) {
    return secretCache.jwt || jwtSecretCache;
  }

  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }));
  const raw = response.SecretString || Buffer.from(response.SecretBinary || "", "base64").toString("utf8");
  jwtSecretCache = JSON.parse(raw);
  secretCache.jwt = jwtSecretCache;
  return jwtSecretCache;
}

export function verifyJwt(token, signingKey, now = Math.floor(Date.now() / 1000)) {
  if (!signingKey) {
    throw new Error("JWT signing key is not configured.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Malformed JWT.");
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (header.alg !== "HS256") {
    throw new Error("Unsupported JWT algorithm.");
  }

  const expectedSignature = createHmac("sha256", signingKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  const actual = Buffer.from(encodedSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid JWT signature.");
  }

  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new Error("Expired JWT.");
  }

  return claims;
}

function deny() {
  return {
    isAuthorized: false
  };
}
