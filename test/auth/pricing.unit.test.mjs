import test from "node:test";
import assert from "node:assert/strict";
import { GetItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createPricingHandler } from "../../lambdas/auth/pricing/index.mjs";
import { TEST_NOW_MS, createJsonResponse, createMockClient, decodeJsonBody } from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.BILLING_CATALOG_TABLE_NAME = "billing-catalog-table";
  process.env.BILLING_CHECKOUT_CANCEL_URL = "https://app.example.test/cancel";
  process.env.BILLING_CHECKOUT_SUCCESS_URL = "https://app.example.test/success";
  process.env.BILLING_CUSTOM_SOLUTION_EMAIL = "sales@example.test";
  process.env.STRIPE_SECRET_ARN = "arn:test:stripe";
  process.env.USERS_TABLE_NAME = "users-table";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("pricing catalog returns seeded plans and addons with monthly reset entitlements", async () => {
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      assert.ok(command instanceof ScanCommand);
      return {
        Items: [
          catalogItem({
            itemId: "basic_website_plan",
            itemType: "plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999,
            entitlements: {
              ads_removed: { type: "boolean", value: true },
              change_requests: { type: "usage", limit: 3, reset_strategy: "monthly" }
            }
          }),
          catalogItem({
            itemId: "addon_5_change_requests",
            itemType: "addon",
            name: "5 More Change Requests",
            amountMonthlyCents: 999,
            entitlements: {
              change_requests: { type: "usage", add: 5, reset_strategy: "monthly" }
            },
            sortOrder: 110
          })
        ]
      };
    }),
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    fetchImpl: () => assert.fail("stripe should not be called")
  });

  const response = await handler({ requestContext: { http: { method: "GET" } } });
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.resetStrategy, "monthly");
  assert.equal(body.catalog[0].itemId, "basic_website_plan");
  assert.equal(body.catalog[0].amountYearlyCents, 38390);
  assert.equal(body.catalog[0].entitlements.change_requests.limit, 3);
  assert.equal(body.catalog[1].itemType, "addon");
});

test("pricing free plan updates user entitlements without Stripe", async () => {
  const updates = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return { Item: catalogItem({ itemId: "free_website_plan", checkoutMode: "free", name: "Free Website Plan" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem() };
      }
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    fetchImpl: () => assert.fail("stripe should not be called"),
    nowMs: () => TEST_NOW_MS
  });

  const response = await handler(checkoutEvent({ itemId: "free_website_plan" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(updates[0].ExpressionAttributeValues[":planId"].S, "free_website_plan");
  assert.equal(updates[0].ExpressionAttributeValues[":resetStrategy"].S, "monthly");
});

test("pricing custom solution returns email conversation instead of checkout", async () => {
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "custom_solution_plan",
            checkoutMode: "conversation",
            name: "Custom Solution Plan"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem() };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    fetchImpl: () => assert.fail("stripe should not be called")
  });

  const response = await handler(checkoutEvent({ itemId: "custom_solution_plan" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.conversationRequired, true);
  assert.equal(body.contactEmail, "sales@example.test");
});

test("pricing creates a Stripe customer portal session for the authenticated user", async () => {
  process.env.BILLING_PORTAL_RETURN_URL = "https://syncpoly.com/billing";
  const fetchCalls = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: false }),
    secretCache: {}
  });

  const response = await handler(portalEvent({ returnUrl: "https://www.syncpoly.com/billing?tab=subscription" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.portal.url, "https://billing.stripe.example.test/session");
  assert.equal(body.stripeCustomerId, "cus_existing");
  const portalCall = fetchCalls.find((call) => call.path === "/v1/billing_portal/sessions");
  const params = new URLSearchParams(portalCall.options.body);
  assert.equal(params.get("customer"), "cus_existing");
  assert.equal(params.get("return_url"), "https://www.syncpoly.com/billing?tab=subscription");
});

test("pricing creates Stripe product with monthly and yearly prices then charges saved payment method directly", async () => {
  const fetchCalls = [];
  const updates = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "basic_website_plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: true }),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "basic_website_plan", interval: "year" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.chargedSavedPaymentMethod, true);
  assert.equal(body.subscription.id, "sub_created");
  assert.equal(body.stripePriceId, "price_year_created");
  assert.ok(fetchCalls.some((call) => call.path === "/v1/products"));
  assert.ok(fetchCalls.some((call) => call.path === "/v1/prices" && new URLSearchParams(call.options.body).get("unit_amount") === "3999"));
  assert.ok(fetchCalls.some((call) => call.path === "/v1/prices" && new URLSearchParams(call.options.body).get("unit_amount") === "38390"));
  const subscriptionCall = fetchCalls.find((call) => call.path === "/v1/subscriptions");
  assert.equal(new URLSearchParams(subscriptionCall.options.body).get("default_payment_method"), "pm_default");
  assert.equal(new URLSearchParams(subscriptionCall.options.body).get("payment_behavior"), "default_incomplete");
  assert.equal(new URLSearchParams(subscriptionCall.options.body).getAll("expand[]").includes("latest_invoice.payment_intent"), true);
  assert.match(subscriptionCall.options.headers["idempotency-key"], /^syncpoly_subscription_/);
  assert.equal(fetchCalls.some((call) => call.path === "/v1/checkout/sessions"), false);
  assert.ok(updates.some((update) => update.TableName === "billing-catalog-table"));
});

test("pricing returns a Stripe payment challenge when saved-card subscription needs action", async () => {
  const fetchCalls = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "basic_website_plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999,
            stripeProductId: "prod_existing",
            stripePriceMonthId: "price_month_existing",
            stripePriceYearId: "price_year_existing"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, {
      hasDefaultPaymentMethod: true,
      requiresAction: true
    }),
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "basic_website_plan" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.chargedSavedPaymentMethod, false);
  assert.equal(body.paymentActionRequired, true);
  assert.equal(body.paymentChallenge.paymentIntentId, "pi_requires_action");
  assert.equal(body.paymentChallenge.clientSecret, "pi_requires_action_secret");
  assert.equal(body.paymentChallenge.nextActionType, "use_stripe_sdk");
  assert.equal(fetchCalls.some((call) => call.path === "/v1/checkout/sessions"), false);
});

test("pricing uses Checkout when the Stripe customer has no saved default payment method", async () => {
  const fetchCalls = [];
  const updates = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "addon_5_change_requests",
            itemType: "addon",
            name: "5 More Change Requests",
            amountMonthlyCents: 999,
            stripeProductId: "prod_existing",
            stripePriceMonthId: "price_month_existing"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: false }),
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "addon_5_change_requests" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, true);
  assert.equal(body.checkout.url, "https://checkout.example.test/session");
  const checkoutCall = fetchCalls.find((call) => call.path === "/v1/checkout/sessions");
  assert.equal(new URLSearchParams(checkoutCall.options.body).get("line_items[0][price]"), "price_month_existing");
  assert.ok(fetchCalls.some((call) => call.path === "/v1/prices" && new URLSearchParams(call.options.body).get("unit_amount") === "9590"));
  assert.equal(updates[0].ExpressionAttributeValues[":yearPriceId"].S, "price_year_created");
  assert.equal(fetchCalls.some((call) => call.path === "/v1/subscriptions"), false);
});

test("pricing stores a checkout response behind a server idempotency key", async () => {
  process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME = "checkout-requests-table";
  const writes = [];
  const fetchCalls = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "basic_website_plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999,
            stripeProductId: "prod_existing",
            stripePriceMonthId: "price_month_existing",
            stripePriceYearId: "price_year_existing"
          })
        };
      }
      if (command instanceof GetItemCommand && command.input.TableName === "users-table") {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof GetItemCommand && command.input.TableName === "checkout-requests-table") {
        return {};
      }
      if (command instanceof PutItemCommand || command instanceof UpdateItemCommand) {
        writes.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: false }),
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "basic_website_plan", idempotencyKey: "button-click-1" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, true);
  assert.equal(writes[0].TableName, "checkout-requests-table");
  assert.equal(writes[0].ConditionExpression, "attribute_not_exists(idempotency_key)");
  assert.equal(writes[1].TableName, "checkout-requests-table");
  assert.equal(writes[1].ExpressionAttributeValues[":status"].S, "completed");
  assert.equal(JSON.parse(writes[1].ExpressionAttributeValues[":responseJson"].S).checkout.id, "cs_created");
  const checkoutCall = fetchCalls.find((call) => call.path === "/v1/checkout/sessions");
  assert.match(checkoutCall.options.headers["idempotency-key"], /^syncpoly_checkout-session_/);
});

test("pricing replays a completed checkout request instead of charging twice", async () => {
  process.env.BILLING_CHECKOUT_REQUESTS_TABLE_NAME = "checkout-requests-table";
  const replayBody = {
    checkoutRequired: true,
    checkout: {
      id: "cs_existing",
      url: "https://checkout.example.test/existing"
    }
  };
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "basic_website_plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999,
            stripeProductId: "prod_existing",
            stripePriceMonthId: "price_month_existing",
            stripePriceYearId: "price_year_existing"
          })
        };
      }
      if (command instanceof GetItemCommand && command.input.TableName === "users-table") {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof GetItemCommand && command.input.TableName === "checkout-requests-table") {
        return {
          Item: {
            idempotency_key: { S: command.input.Key.idempotency_key.S },
            status: { S: "completed" },
            response_status: { N: "200" },
            response_json: { S: JSON.stringify(replayBody) }
          }
        };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createMockClient(() => assert.fail("secrets should not be called")),
    fetchImpl: () => assert.fail("stripe should not be called")
  });

  const response = await handler(checkoutEvent({ itemId: "basic_website_plan" }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(decodeJsonBody(response), replayBody);
});

test("pricing charges a saved non-default payment method before falling back to Checkout", async () => {
  const fetchCalls = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "basic_website_plan",
            name: "Basic Website Plan",
            amountMonthlyCents: 3999,
            stripeProductId: "prod_existing",
            stripePriceMonthId: "price_month_existing",
            stripePriceYearId: "price_year_existing"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, {
      hasDefaultPaymentMethod: false,
      savedPaymentMethodId: "pm_saved"
    }),
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "basic_website_plan" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.paymentMethodId, "pm_saved");
  const subscriptionCall = fetchCalls.find((call) => call.path === "/v1/subscriptions");
  assert.equal(new URLSearchParams(subscriptionCall.options.body).get("default_payment_method"), "pm_saved");
  assert.equal(fetchCalls.some((call) => call.path === "/v1/checkout/sessions"), false);
});

test("pricing charges the one-time additional website product and grants a website credit", async () => {
  const fetchCalls = [];
  const updates = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "additional_website_one_time",
            itemType: "product",
            checkoutMode: "payment",
            name: "Additional Website",
            amountOneTimeCents: 2999,
            stripeProductId: "prod_existing",
            stripePriceOneTimeId: "price_one_time_existing"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: true }),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "additional_website_one_time" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.chargedSavedPaymentMethod, true);
  assert.equal(body.paymentIntent.id, "pi_succeeded");
  assert.equal(body.stripePriceId, "price_one_time_existing");
  const paymentIntentCall = fetchCalls.find((call) => call.path === "/v1/payment_intents");
  assert.equal(new URLSearchParams(paymentIntentCall.options.body).get("amount"), "2999");
  assert.equal(new URLSearchParams(paymentIntentCall.options.body).get("metadata[syncpoly_catalog_item_id]"), "additional_website_one_time");
  assert.match(paymentIntentCall.options.headers["idempotency-key"], /^syncpoly_payment-intent_/);
  assert.ok(updates.some((update) => update.TableName === "users-table" && update.ExpressionAttributeValues[":amount"].N === "1"));
});

test("pricing charges the one-time media storage add-on and grants storage capacity", async () => {
  const fetchCalls = [];
  const updates = [];
  const handler = createPricingHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "billing-catalog-table") {
        return {
          Item: catalogItem({
            itemId: "media_storage_10mb_one_time",
            itemType: "product",
            checkoutMode: "payment",
            name: "10MB Media Storage",
            amountOneTimeCents: 499,
            stripeProductId: "prod_existing",
            stripePriceOneTimeId: "price_media_existing"
          })
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ stripeCustomerId: "cus_existing" }) };
      }
      if (command instanceof UpdateItemCommand) {
        updates.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    secretsClient: createStripeSecretClient(),
    fetchImpl: createStripePricingFetch(fetchCalls, { hasDefaultPaymentMethod: true }),
    nowMs: () => TEST_NOW_MS,
    secretCache: {}
  });

  const response = await handler(checkoutEvent({ itemId: "media_storage_10mb_one_time" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.checkoutRequired, false);
  assert.equal(body.paymentIntent.id, "pi_succeeded");
  const paymentIntentCall = fetchCalls.find((call) => call.path === "/v1/payment_intents");
  assert.equal(new URLSearchParams(paymentIntentCall.options.body).get("amount"), "499");
  assert.equal(new URLSearchParams(paymentIntentCall.options.body).get("metadata[syncpoly_catalog_item_id]"), "media_storage_10mb_one_time");
  assert.ok(updates.some((update) => update.TableName === "users-table" && update.UpdateExpression.includes("additional_media_storage_mb") && update.ExpressionAttributeValues[":amount"].N === "10"));
});

function checkoutEvent(body) {
  return {
    body: JSON.stringify(body),
    requestContext: {
      http: { method: "POST" },
      authorizer: {
        lambda: {
          userId: "google:subject"
        }
      }
    }
  };
}

function portalEvent(body = {}) {
  return {
    body: JSON.stringify(body),
    rawPath: "/billing/portal",
    routeKey: "POST /billing/portal",
    requestContext: {
      http: { method: "POST", path: "/billing/portal" },
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

function createStripePricingFetch(calls, { hasDefaultPaymentMethod, savedPaymentMethodId = "", requiresAction = false }) {
  return async (url, options = {}) => {
    const parsed = new URL(String(url));
    calls.push({
      path: parsed.pathname,
      url: String(url),
      options
    });
    assert.equal(options.headers.authorization, "Bearer sk_test_secret");
    assert.equal(options.headers["stripe-version"], "2025-06-30.basil");

    if (parsed.pathname === "/v1/products") {
      return createJsonResponse({ id: "prod_created" });
    }
    if (parsed.pathname === "/v1/prices") {
      const params = new URLSearchParams(options.body);
      return createJsonResponse({ id: params.get("recurring[interval]") === "year" ? "price_year_created" : "price_month_created" });
    }
    if (parsed.pathname === "/v1/customers/cus_existing") {
      return createJsonResponse({
        id: "cus_existing",
        invoice_settings: {
          default_payment_method: hasDefaultPaymentMethod ? "pm_default" : null
        }
      });
    }
    if (parsed.pathname === "/v1/customers/cus_existing/payment_methods") {
      return createJsonResponse({
        data: savedPaymentMethodId ? [{ id: savedPaymentMethodId }] : []
      });
    }
    if (parsed.pathname === "/v1/subscriptions") {
      if (requiresAction) {
        return createJsonResponse({
          id: "sub_created",
          status: "incomplete",
          current_period_start: 1900000000,
          current_period_end: 1902592000,
          latest_invoice: {
            id: "in_requires_action",
            payment_intent: {
              id: "pi_requires_action",
              status: "requires_action",
              client_secret: "pi_requires_action_secret",
              next_action: {
                type: "use_stripe_sdk"
              }
            }
          }
        });
      }

      return createJsonResponse({
        id: "sub_created",
        status: "active",
        current_period_start: 1900000000,
        current_period_end: 1902592000,
        latest_invoice: "in_paid"
      });
    }
    if (parsed.pathname === "/v1/payment_intents") {
      return createJsonResponse({
        id: "pi_succeeded",
        status: "succeeded",
        amount: 2999,
        currency: "usd"
      });
    }
    if (parsed.pathname === "/v1/checkout/sessions") {
      return createJsonResponse({
        id: "cs_created",
        url: "https://checkout.example.test/session"
      });
    }
    if (parsed.pathname === "/v1/billing_portal/sessions") {
      return createJsonResponse({
        id: "bps_created",
        url: "https://billing.stripe.example.test/session"
      });
    }

    assert.fail(`unexpected Stripe path ${parsed.pathname}`);
  };
}

function userItem({ stripeCustomerId } = {}) {
  return {
    user_id: { S: "google:subject" },
    email: { S: "user@example.test" },
    name: { S: "Test User" },
    ...(stripeCustomerId ? { stripe_customer_id: { S: stripeCustomerId } } : {})
  };
}

function catalogItem({
  itemId,
  itemType = "plan",
  checkoutMode = "subscription",
  name,
  description = "Catalog item",
  amountMonthlyCents = 0,
  amountOneTimeCents = 0,
  yearlyDiscountPercent = 20,
  sortOrder = 10,
  entitlements = {
    ads_removed: { type: "boolean", value: false },
    syncpoly_banner: { type: "boolean", value: true },
    location_map: { type: "boolean", value: true }
  },
  stripeProductId,
  stripePriceMonthId,
  stripePriceYearId,
  stripePriceOneTimeId
}) {
  return {
    item_id: { S: itemId },
    item_type: { S: itemType },
    checkout_mode: { S: checkoutMode },
    name: { S: name },
    description: { S: description },
    status: { S: "active" },
    currency: { S: "usd" },
    amount_monthly_cents: { N: String(amountMonthlyCents) },
    amount_one_time_cents: { N: String(amountOneTimeCents) },
    yearly_discount_percent: { N: String(yearlyDiscountPercent) },
    sort_order: { N: String(sortOrder) },
    entitlements_json: { S: JSON.stringify(entitlements) },
    ...(stripeProductId ? { stripe_product_id: { S: stripeProductId } } : {}),
    ...(stripePriceMonthId ? { stripe_price_month_id: { S: stripePriceMonthId } } : {}),
    ...(stripePriceYearId ? { stripe_price_year_id: { S: stripePriceYearId } } : {}),
    ...(stripePriceOneTimeId ? { stripe_price_one_time_id: { S: stripePriceOneTimeId } } : {})
  };
}
