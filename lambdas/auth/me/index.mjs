import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

export const handler = createMeHandler();

export function createMeHandler({ dynamodbClient = dynamodb } = {}) {
  return async function meHandler(event) {
    return handleMe(event, { dynamodbClient });
  };
}

export async function handleMe(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;

  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return jsonResponse(204, {}, event);
    }

    const authorizer = event.requestContext?.authorizer?.lambda || {};
    const userId = authorizer.userId;

    if (!userId) {
      return jsonResponse(401, { message: "Unauthorized." }, event);
    }

    const response = await dynamodbClient.send(
      new GetItemCommand({
        TableName: process.env.USERS_TABLE_NAME,
        Key: {
          user_id: { S: userId }
        }
      })
    );

    if (!response.Item) {
      return jsonResponse(404, { message: "User not found." }, event);
    }

    return jsonResponse(
      200,
      {
        user: {
          userId: response.Item.user_id.S,
          provider: response.Item.provider?.S,
          providerSubject: response.Item.provider_subject?.S,
          email: response.Item.email?.S,
          emailVerified: response.Item.email_verified?.BOOL || false,
          name: response.Item.name?.S,
          picture: response.Item.picture?.S,
          stripeCustomerId: response.Item.stripe_customer_id?.S,
          lastLoginAt: response.Item.last_login_at?.S,
          updatedAt: response.Item.updated_at?.S
        }
      },
      event
    );
  } catch (error) {
    console.error("Failed to load authenticated user", {
      message: error.message,
      name: error.name
    });

    return jsonResponse(500, { message: "Failed to load authenticated user." }, event);
  }
}

function jsonResponse(statusCode, body, event) {
  return {
    statusCode,
    headers: responseHeaders(event),
    body: JSON.stringify(body)
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
