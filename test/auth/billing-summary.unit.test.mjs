import test from "node:test";
import assert from "node:assert/strict";
import { GetItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createBillingSummaryHandler } from "../../lambdas/auth/billing-summary/index.mjs";
import { TEST_NOW_MS, createJsonResponse, createMockClient, decodeJsonBody } from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.USERS_TABLE_NAME = "users-table";
  process.env.BILLING_EVENTS_TABLE_NAME = "billing-events-table";
  process.env.STRIPE_SECRET_ARN = "arn:test:stripe";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("billing summary requires authorizer context", async () => {
  const handler = createBillingSummaryHandler();
  const response = await handler({ requestContext: {} });

  assert.equal(response.statusCode, 401);
});

test("billing summary returns 404 for missing user without calling Stripe", async () => {
  const dynamodbClient = createMockClient((command) => {
    assert.ok(command instanceof GetItemCommand);
    return {};
  });
  const handler = createBillingSummaryHandler({
    dynamodbClient,
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    fetchImpl: () => assert.fail("stripe should not be called")
  });

  const response = await handler(authEvent());

  assert.equal(response.statusCode, 404);
});

test("billing summary creates a Stripe customer, persists it, sanitizes billing data, and computes dunning", async () => {
  const dynamodbClient = createMockClient((command) => {
    if (command instanceof GetItemCommand) {
      return {
        Item: {
          user_id: { S: "google:subject" },
          email: { S: "user@example.test" },
          name: { S: "Test User" }
        }
      };
    }

    if (command instanceof UpdateItemCommand) {
      assert.equal(command.input.ExpressionAttributeValues[":customerId"].S, "cus_created");
      return {};
    }

    if (command instanceof QueryCommand) {
      return {
        Items: [
          {
            stripe_event_id: { S: "evt_failed" },
            event_type: { S: "invoice.payment_failed" },
            invoice_id: { S: "in_failed" },
            subscription_id: { S: "sub_past_due" },
            status: { S: "open" },
            hosted_invoice_url: { S: "https://invoice.example.test" },
            next_payment_attempt: { N: "1900000600" },
            created_at: { S: "2030-03-17T17:46:40.000Z" }
          }
        ]
      };
    }

    assert.fail(`unexpected command ${command.constructor.name}`);
  });

  const fetchCalls = [];
  const handler = createBillingSummaryHandler({
    dynamodbClient,
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripeFetch(fetchCalls),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler(authEvent());
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(body.customer.id, "cus_created");
  assert.equal(body.paymentInfo.defaultPaymentMethodId, "pm_default");
  assert.equal(body.paymentMethods[0].card.last4, "4242");
  assert.equal(body.paymentMethods[0].card.fingerprint, undefined);
  assert.equal(body.dunning.status, "action_required");
  assert.equal(body.dunning.failedInvoiceCount, 1);
  assert.equal(body.subscriptions[0].latestPaymentIntentStatus, "requires_payment_method");
  assert.equal(body.subscriptions[0].items[0].productId, "prod_1");
  assert.equal(body.subscriptions[0].items[0].productName, "Builder Pro");
  assert.equal(body.subscriptions[0].items[0].productDescription, "Professional website subscription");
  assert.equal(body.subscriptions[0].items[0].intervalCount, 1);
  assert.equal(JSON.stringify(body).includes("sk_test_secret"), false);

  const createCustomer = fetchCalls.find((call) => call.path === "/v1/customers");
  assert.equal(createCustomer.options.method, "POST");
  assert.equal(new URLSearchParams(createCustomer.options.body).get("metadata[syncpoly_user_id]"), "google:subject");
  const subscriptionsCall = fetchCalls.find((call) => call.path === "/v1/subscriptions");
  const subscriptionExpansions = new URL(subscriptionsCall.url).searchParams.getAll("expand[]");
  assert.equal(subscriptionExpansions.includes("data.items.data.price.product"), false);
  assert.equal(subscriptionExpansions.includes("data.latest_invoice.payment_intent"), true);
  assert.ok(fetchCalls.some((call) => call.path === "/v1/products/prod_1"));
});

test("billing summary uses existing Stripe customer id and does not allow client-supplied customer ids", async () => {
  const dynamodbClient = createMockClient((command) => {
    if (command instanceof GetItemCommand) {
      return {
        Item: {
          user_id: { S: "google:subject" },
          email: { S: "user@example.test" },
          name: { S: "Test User" },
          stripe_customer_id: { S: "cus_existing" }
        }
      };
    }

    if (command instanceof QueryCommand) {
      return { Items: [] };
    }

    assert.fail("should not update user when customer id already exists");
  });
  const fetchCalls = [];
  const handler = createBillingSummaryHandler({
    dynamodbClient,
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripeFetch(fetchCalls),
    secretCache: {}
  });

  const response = await handler({
    ...authEvent(),
    queryStringParameters: {
      customer: "cus_attacker"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(fetchCalls.some((call) => call.path === "/v1/customers"), false);
  assert.ok(fetchCalls.every((call) => !call.url.includes("cus_attacker")));
  assert.ok(fetchCalls.some((call) => call.url.includes("cus_existing")));
});

test("billing summary maps Stripe auth failures to a non-secret 502 response", async () => {
  const handler = createBillingSummaryHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand) {
        return {
          Item: {
            user_id: { S: "google:subject" },
            email: { S: "user@example.test" },
            stripe_customer_id: { S: "cus_existing" }
          }
        };
      }

      if (command instanceof QueryCommand) {
        return { Items: [] };
      }

      assert.fail("unexpected dynamodb command");
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: async () =>
      createJsonResponse(
        {
          error: {
            message: "Invalid API Key provided: sk_test_secret"
          }
        },
        { ok: false, status: 401 }
      ),
    secretCache: {}
  });

  const response = await handler(authEvent());

  assert.equal(response.statusCode, 502);
  assert.equal(decodeJsonBody(response).message, "Failed to load billing details.");
  assert.equal(response.body.includes("sk_test_secret"), false);
});

test("billing summary returns partial data when product detail lookup fails", async () => {
  const handler = createBillingSummaryHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand) {
        return {
          Item: {
            user_id: { S: "google:subject" },
            email: { S: "user@example.test" },
            name: { S: "Test User" },
            stripe_customer_id: { S: "cus_existing" }
          }
        };
      }

      if (command instanceof QueryCommand) {
        return { Items: [] };
      }

      assert.fail("unexpected dynamodb command");
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripeFetch([], { failProduct: true }),
    secretCache: {}
  });

  const response = await handler(authEvent());
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.isPartial, true);
  assert.equal(body.partialFailures[0].section, "product:prod_1");
  assert.equal(body.subscriptions[0].items[0].productId, "prod_1");
  assert.equal(body.subscriptions[0].items[0].productName, null);
  assert.equal(body.paymentMethods[0].card.last4, "4242");
});

function authEvent() {
  return {
    requestContext: {
      authorizer: {
        lambda: {
          userId: "google:subject"
        }
      }
    }
  };
}

function createStripeSecretClient() {
  return createMockClient((command) => {
    assert.ok(command instanceof GetSecretValueCommand);
    return {
      SecretString: JSON.stringify({
        secret_key: "sk_test_secret",
        webhook_secret: "whsec_test"
      })
    };
  });
}

function createStripeFetch(calls, { failProduct = false } = {}) {
  return async (url, options = {}) => {
    const parsed = new URL(String(url));
    calls.push({
      path: parsed.pathname,
      url: String(url),
      options
    });
    assert.equal(options.headers.authorization, "Bearer sk_test_secret");
    assert.equal(options.headers["stripe-version"], "2025-06-30.basil");

    if (parsed.pathname === "/v1/customers") {
      return createJsonResponse({ id: "cus_created" });
    }

    if (parsed.pathname === "/v1/customers/cus_created" || parsed.pathname === "/v1/customers/cus_existing") {
      return createJsonResponse({
        id: parsed.pathname.endsWith("cus_existing") ? "cus_existing" : "cus_created",
        email: "user@example.test",
        name: "Test User",
        balance: 0,
        currency: "usd",
        delinquent: true,
        invoice_settings: {
          default_payment_method: "pm_default"
        },
        tax_ids: [{ value: "should-not-leak" }]
      });
    }

    if (parsed.pathname === "/v1/invoices") {
      return createJsonResponse({
        data: [
          {
            id: "in_failed",
            number: "SYNC-001",
            status: "open",
            billing_reason: "subscription_cycle",
            currency: "usd",
            amount_due: 5000,
            amount_paid: 0,
            amount_remaining: 5000,
            attempt_count: 2,
            next_payment_attempt: 1900000600,
            hosted_invoice_url: "https://invoice.example.test",
            invoice_pdf: "https://invoice.example.test/pdf",
            created: 1900000000,
            period_start: 1900000000,
            period_end: 1902592000,
            customer_email: "should-not-leak@example.test"
          }
        ]
      });
    }

    if (parsed.pathname === "/v1/subscriptions") {
      assert.equal(parsed.searchParams.get("status"), "all");
      return createJsonResponse({
        data: [
          {
            id: "sub_past_due",
            status: "past_due",
            currency: "usd",
            current_period_start: 1900000000,
            current_period_end: 1902592000,
            cancel_at_period_end: false,
            collection_method: "charge_automatically",
            default_payment_method: { id: "pm_default" },
            latest_invoice: {
              id: "in_failed",
              payment_intent: {
                status: "requires_payment_method"
              }
            },
            items: {
              data: [
                {
                  id: "si_1",
                  quantity: 1,
                  price: {
                    id: "price_1",
                    product: "prod_1",
                    nickname: "Builder Pro Monthly",
                    unit_amount: 2900,
                    currency: "usd",
                    recurring: {
                      interval: "month",
                      interval_count: 1
                    }
                  }
                }
              ]
            }
          }
        ]
      });
    }

    if (parsed.pathname === "/v1/products/prod_1") {
      if (failProduct) {
        return createJsonResponse(
          {
            error: {
              message: "Product details are temporarily unavailable."
            }
          },
          { ok: false, status: 500 }
        );
      }

      return createJsonResponse({
        id: "prod_1",
        name: "Builder Pro",
        description: "Professional website subscription",
        metadata: {
          internal_note: "should-not-leak"
        }
      });
    }

    if (parsed.pathname.endsWith("/payment_methods")) {
      return createJsonResponse({
        data: [
          {
            id: "pm_default",
            type: "card",
            billing_details: {
              name: "Test User",
              email: "user@example.test"
            },
            card: {
              brand: "visa",
              last4: "4242",
              exp_month: 12,
              exp_year: 2034,
              funding: "credit",
              country: "US",
              fingerprint: "do-not-return"
            }
          }
        ]
      });
    }

    assert.fail(`unexpected Stripe path ${parsed.pathname}`);
  };
}
