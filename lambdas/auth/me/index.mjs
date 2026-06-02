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
    const authorizer = event.requestContext?.authorizer?.lambda || {};
    const userId = authorizer.userId;

    if (!userId) {
      return jsonResponse(401, { message: "Unauthorized." });
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
      return jsonResponse(404, { message: "User not found." });
    }

    return jsonResponse(200, {
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
    });
  } catch (error) {
    console.error("Failed to load authenticated user", {
      message: error.message,
      name: error.name
    });

    return jsonResponse(500, { message: "Failed to load authenticated user." });
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
