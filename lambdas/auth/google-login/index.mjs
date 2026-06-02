import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHmac, randomUUID } from "node:crypto";

const dynamodb = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const TOKEN_TTL_SECONDS = Number.parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || "3600", 10);
const ISSUER = process.env.JWT_ISSUER || "syncpoly-builder";
const AUDIENCE = process.env.JWT_AUDIENCE || "syncpoly-builder-api";

let googleSecretCache;
let jwtSecretCache;

export const handler = createGoogleLoginHandler();

export function createGoogleLoginHandler({
  dynamodbClient = dynamodb,
  secretsClient = secrets,
  fetchImpl = fetch,
  nowMs = () => Date.now(),
  uuidFn = randomUUID,
  secretCache = {}
} = {}) {
  return async function googleLoginHandler(event) {
    return handleGoogleLogin(event, {
      dynamodbClient,
      secretsClient,
      fetchImpl,
      nowMs,
      uuidFn,
      secretCache
    });
  };
}

export async function handleGoogleLogin(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;
  const secretsClient = deps.secretsClient || secrets;
  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || (() => Date.now());
  const uuidFn = deps.uuidFn || randomUUID;
  const secretCache = deps.secretCache || {};

  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return jsonResponse(204, {}, event);
    }

    const body = parseJsonBody(event.body, event.isBase64Encoded);
    if (!body.code || typeof body.code !== "string") {
      return jsonResponse(400, { message: "Missing Google authorization code." }, event);
    }

    const googleSecret = await getJsonSecret(process.env.GOOGLE_OAUTH_SECRET_ARN, "google", secretsClient, secretCache);
    const jwtSecret = await getJsonSecret(process.env.JWT_SECRET_ARN, "jwt", secretsClient, secretCache);
    const redirectUri = body.redirectUri || googleSecret.redirect_uri;

    if (!googleSecret.client_id || !googleSecret.client_secret || !redirectUri) {
      return jsonResponse(500, { message: "Google OAuth secret is not fully configured." }, event);
    }

    const googleTokens = await exchangeGoogleCode({
      code: body.code,
      clientId: googleSecret.client_id,
      clientSecret: googleSecret.client_secret,
      redirectUri,
      fetchImpl
    });

    if (!googleTokens.id_token) {
      return jsonResponse(401, { message: "Google did not return an identity token." }, event);
    }

    const googleIdentity = await verifyGoogleIdToken(googleTokens.id_token, googleSecret.client_id, fetchImpl, nowMs);
    const nowSeconds = Math.floor(nowMs() / 1000);
    const expiresAt = nowSeconds + TOKEN_TTL_SECONDS;
    const userId = `google:${googleIdentity.sub}`;
    const user = {
      userId,
      provider: "google",
      providerSubject: googleIdentity.sub,
      email: googleIdentity.email,
      emailVerified: googleIdentity.email_verified === "true" || googleIdentity.email_verified === true,
      name: googleIdentity.name,
      picture: googleIdentity.picture,
      lastLoginAt: new Date(nowMs()).toISOString()
    };

    const accessToken = signJwt(
      {
        iss: ISSUER,
        aud: AUDIENCE,
        sub: userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        provider: user.provider,
        iat: nowSeconds,
        exp: expiresAt
      },
      jwtSecret.signing_key
    );

    await writeLoginRecords({
      user,
      loginId: uuidFn(),
      expiresAt,
      scope: googleTokens.scope,
      ttl: nowSeconds + Number.parseInt(process.env.LOGINS_TTL_SECONDS || "7776000", 10),
      ipAddress: event.requestContext?.http?.sourceIp,
      userAgent: event.headers?.["user-agent"] || event.headers?.["User-Agent"],
      dynamodbClient
    });

    return jsonResponse(
      200,
      {
        accessToken,
        tokenType: "Bearer",
        expiresIn: TOKEN_TTL_SECONDS,
        expiresAt,
        user,
        provider: {
          name: "google",
          scope: googleTokens.scope,
          accessToken: googleTokens.access_token,
          accessTokenExpiresIn: googleTokens.expires_in
        }
      },
      event
    );
  } catch (error) {
    console.error("Google login failed", {
      message: error.message,
      name: error.name
    });

    return jsonResponse(error.statusCode || 500, { message: error.publicMessage || "Google login failed." }, event);
  }
}

function parseJsonBody(body, isBase64Encoded = false) {
  if (!body) {
    return {};
  }

  const text = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.publicMessage = "Request body must be valid JSON.";
    throw error;
  }
}

async function exchangeGoogleCode({ code, clientId, clientSecret, redirectUri, fetchImpl }) {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error("Google token exchange failed.");
    error.statusCode = 401;
    error.publicMessage = payload.error_description || payload.error || "Google token exchange failed.";
    throw error;
  }

  return payload;
}

async function verifyGoogleIdToken(idToken, expectedAudience, fetchImpl, nowMs = () => Date.now()) {
  const url = new URL(GOOGLE_TOKENINFO_URL);
  url.searchParams.set("id_token", idToken);

  const response = await fetchImpl(url);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error("Google ID token verification failed.");
    error.statusCode = 401;
    error.publicMessage = payload.error_description || "Google ID token verification failed.";
    throw error;
  }

  if (payload.aud !== expectedAudience) {
    const error = new Error("Google ID token audience mismatch.");
    error.statusCode = 401;
    error.publicMessage = "Google ID token audience mismatch.";
    throw error;
  }

  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    const error = new Error("Google ID token issuer mismatch.");
    error.statusCode = 401;
    error.publicMessage = "Google ID token issuer mismatch.";
    throw error;
  }

  if (!payload.exp || Number.parseInt(payload.exp, 10) <= Math.floor(nowMs() / 1000)) {
    const error = new Error("Google ID token is expired.");
    error.statusCode = 401;
    error.publicMessage = "Google ID token is expired.";
    throw error;
  }

  if (!payload.email || !(payload.email_verified === "true" || payload.email_verified === true)) {
    const error = new Error("Google account email is not verified.");
    error.statusCode = 401;
    error.publicMessage = "Google account email is not verified.";
    throw error;
  }

  if (!payload.sub) {
    const error = new Error("Google ID token subject is missing.");
    error.statusCode = 401;
    error.publicMessage = "Google ID token subject is missing.";
    throw error;
  }

  return payload;
}

async function writeLoginRecords({ user, loginId, expiresAt, scope, ttl, ipAddress, userAgent, dynamodbClient }) {
  const now = new Date().toISOString();
  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: {
        user_id: { S: user.userId }
      },
      UpdateExpression: [
        "SET provider = :provider",
        "provider_subject = :providerSubject",
        "email = :email",
        "email_verified = :emailVerified",
        "#name = :name",
        "picture = :picture",
        "last_login_at = :lastLoginAt",
        "updated_at = :updatedAt"
      ].join(", "),
      ExpressionAttributeNames: {
        "#name": "name"
      },
      ExpressionAttributeValues: {
        ":provider": { S: user.provider },
        ":providerSubject": { S: user.providerSubject },
        ":email": { S: user.email || "" },
        ":emailVerified": { BOOL: Boolean(user.emailVerified) },
        ":name": { S: user.name || "" },
        ":picture": { S: user.picture || "" },
        ":lastLoginAt": { S: user.lastLoginAt },
        ":updatedAt": { S: now }
      }
    })
  );

  await dynamodbClient.send(
    new PutItemCommand({
      TableName: process.env.LOGINS_TABLE_NAME,
      Item: {
        user_id: { S: user.userId },
        login_id: { S: loginId },
        provider: { S: user.provider },
        email: { S: user.email || "" },
        scope: { S: scope || "" },
        ip_address: { S: ipAddress || "" },
        user_agent: { S: userAgent || "" },
        created_at: { S: now },
        token_expires_at: { N: String(expiresAt) },
        ttl: { N: String(ttl) }
      }
    })
  );
}

async function getJsonSecret(secretArn, type, secretsClient, secretCache = {}) {
  if (!secretArn) {
    throw new Error(`Missing ${type} secret ARN.`);
  }

  const cached = secretCache[type] || (type === "google" ? googleSecretCache : jwtSecretCache);
  if (cached) {
    return cached;
  }

  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const raw = response.SecretString || Buffer.from(response.SecretBinary || "", "base64").toString("utf8");
  const parsed = JSON.parse(raw);

  secretCache[type] = parsed;
  if (type === "google") {
    googleSecretCache = parsed;
  } else {
    jwtSecretCache = parsed;
  }

  return parsed;
}

function signJwt(payload, signingKey) {
  if (!signingKey) {
    throw new Error("JWT signing key is not configured.");
  }

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", signingKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function jsonResponse(statusCode, body, event) {
  return {
    statusCode,
    headers: responseHeaders(event),
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}

function responseHeaders(event) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "300"
  };
  const origin = getHeader(event?.headers, "origin");
  if (allowedOrigins().has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}

function allowedOrigins() {
  return new Set(
    (process.env.AUTH_ALLOWED_ORIGINS || "https://syncpoly.com,https://www.syncpoly.com")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return undefined;
}
