import test from "node:test";
import assert from "node:assert/strict";
import { GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createWebsitesHandler } from "../../lambdas/auth/websites/index.mjs";
import { TEST_NOW_MS, createMockClient, decodeJsonBody } from "./helpers.mjs";

const oldEnv = { ...process.env };

test.beforeEach(() => {
  process.env.CONTENT_BUCKET = "sites-bucket";
  process.env.USERS_TABLE_NAME = "users-table";
  process.env.WEBSITE_FOLDERS_TABLE_NAME = "website-folders-table";
  process.env.WEBSITE_MEDIA_TABLE_NAME = "website-media-table";
  process.env.WEBSITES_TABLE_NAME = "websites-table";
});

test.afterEach(() => {
  process.env = { ...oldEnv };
});

test("websites list returns owned websites and capacity", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            websiteItem({ websiteId: "site_1", name: "Main Website" })
          ]
        };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ includedWebsites: 1 }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    })
  });

  const response = await handler(authEvent("GET", "/websites"));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.websites.length, 1);
  assert.equal(body.capacity.includedWebsiteLimit, 1);
  assert.equal(body.capacity.canCreate, false);
});

test("websites create claims a globally unique folder and allows the first included website", async () => {
  const writes = [];
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof QueryCommand) {
        return { Items: [] };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ includedWebsites: 1 }) };
      }
      if (command instanceof TransactWriteItemsCommand) {
        writes.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    nowMs: () => TEST_NOW_MS,
    uuidFn: () => "site_free"
  });

  const response = await handler(authEvent("POST", "/websites", { name: "Main Website", domain: "example.test" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.website.websiteId, "site_free");
  assert.equal(body.website.folder, "main-website");
  assert.equal(body.website.source, "included");
  assert.equal(writes[0].TransactItems[0].Put.TableName, "website-folders-table");
  assert.equal(writes[0].TransactItems[0].Put.ConditionExpression, "attribute_not_exists(folder)");
});

test("websites create requires the one-time additional website product after included capacity is used", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof QueryCommand) {
        return { Items: [websiteItem({ websiteId: "site_1" })] };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ includedWebsites: 1 }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    })
  });

  const response = await handler(authEvent("POST", "/websites", { name: "Second Website" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 402);
  assert.equal(body.paymentRequired, true);
  assert.equal(body.catalogItemId, "additional_website_one_time");
  assert.equal(body.amountCents, 2999);
});

test("websites create consumes a paid additional website credit", async () => {
  const writes = [];
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof QueryCommand) {
        return { Items: [websiteItem({ websiteId: "site_1" })] };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ includedWebsites: 1, credits: 1 }) };
      }
      if (command instanceof TransactWriteItemsCommand) {
        writes.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    nowMs: () => TEST_NOW_MS,
    uuidFn: () => "site_paid"
  });

  const response = await handler(authEvent("POST", "/websites", { name: "Second Website" }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.website.source, "additional_credit");
  assert.equal(writes[0].TransactItems[2].Update.TableName, "users-table");
  assert.equal(writes[0].TransactItems[2].Update.ExpressionAttributeValues[":minusOne"].N, "-1");
  assert.equal(body.capacity.additionalWebsiteCredits, 0);
});

test("websites config validates schema and blocks unentitled banner removal", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return { Item: websiteItem({ websiteId: "site_1" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ includedWebsites: 1, syncpolyBanner: true }) };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    })
  });

  const config = validConfig();
  config.syncpoly = { banner: false };

  const response = await handler(authEvent("PUT", "/websites/site_1/config", { config }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 400);
  assert.ok(body.errors.includes("Plan entitlement does not allow removing the Syncpoly banner."));
});

test("websites media upload requires compressed media and enforces quota before returning a presigned URL", async () => {
  const writes = [];
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return { Item: websiteItem({ websiteId: "site_1", folder: "main-website" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ mediaStorageMb: 10 }) };
      }
      if (command instanceof QueryCommand) {
        return { Items: [] };
      }
      if (command instanceof PutItemCommand) {
        writes.push(command.input);
        return {};
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    nowMs: () => TEST_NOW_MS,
    uuidFn: () => "media_1",
    presignPutObject: async ({ bucket, key, contentType }) => ({
      method: "PUT",
      url: `https://upload.example.test/${bucket}/${key}`,
      headers: { "content-type": contentType },
      expiresInSeconds: 900
    })
  });

  const response = await handler(authEvent("POST", "/websites/site_1/media", {
    fileName: "Gallery/Hero Photo.jpg",
    contentType: "image/jpeg",
    compressed: true,
    originalBytes: 1_500_000,
    compressedBytes: 900_000
  }));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.media.key, "main-website/media/gallery/hero-photo.jpg");
  assert.equal(body.upload.method, "PUT");
  assert.equal(writes[0].Item.bytes.N, "900000");
});

test("websites media upload rejects quota overages", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return { Item: websiteItem({ websiteId: "site_1" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ mediaStorageMb: 10 }) };
      }
      if (command instanceof QueryCommand) {
        return { Items: [mediaItem({ bytes: 10 * 1024 * 1024 })] };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    presignPutObject: () => assert.fail("presign should not be called")
  });

  const response = await handler(authEvent("POST", "/websites/site_1/media", {
    fileName: "hero.jpg",
    contentType: "image/jpeg",
    compressed: true,
    compressedBytes: 1
  }));

  assert.equal(response.statusCode, 400);
  assert.ok(decodeJsonBody(response).errors.includes("Media storage limit exceeded."));
});

test("websites media upload rejects images that were not compressed first", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return { Item: websiteItem({ websiteId: "site_1" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ mediaStorageMb: 10 }) };
      }
      if (command instanceof QueryCommand) {
        return { Items: [] };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    }),
    presignPutObject: () => assert.fail("presign should not be called")
  });

  const response = await handler(authEvent("POST", "/websites/site_1/media", {
    fileName: "hero.jpg",
    contentType: "image/jpeg",
    compressed: false,
    compressedBytes: 1024
  }));

  assert.equal(response.statusCode, 400);
  assert.ok(decodeJsonBody(response).errors.includes("Images must be compressed before requesting an upload URL."));
});

test("websites media list returns items and storage quota with add-on capacity", async () => {
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return { Item: websiteItem({ websiteId: "site_1" }) };
      }
      if (command instanceof GetItemCommand) {
        return { Item: userItem({ mediaStorageMb: 10, additionalMediaStorageMb: 10 }) };
      }
      if (command instanceof QueryCommand) {
        return { Items: [mediaItem({ bytes: 2 * 1024 * 1024 })] };
      }
      assert.fail(`unexpected command ${command.constructor.name}`);
    })
  });

  const response = await handler(authEvent("GET", "/websites/site_1/media"));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.media.length, 1);
  assert.equal(body.quota.limitMb, 20);
  assert.equal(body.quota.usedBytes, 2 * 1024 * 1024);
});

test("websites deploy returns first-deploy approval message", async () => {
  const updates = [];
  const handler = createWebsitesHandler({
    dynamodbClient: createMockClient((command) => {
      if (command instanceof GetItemCommand && command.input.TableName === "websites-table") {
        return {
          Item: websiteItem({
            websiteId: "site_1",
            configJson: JSON.stringify(validConfig()),
            seoJson: JSON.stringify({ robotsTxt: "User-agent: *", sitemapXml: "<urlset></urlset>", llmsTxt: "About" })
          })
        };
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
    nowMs: () => TEST_NOW_MS
  });

  const response = await handler(authEvent("POST", "/websites/site_1/deploy"));
  const body = decodeJsonBody(response);

  assert.equal(response.statusCode, 202);
  assert.equal(body.approvalRequired, true);
  assert.match(body.message, /48 hours/);
  assert.equal(updates[0].ExpressionAttributeValues[":status"].S, "pending_first_deploy_approval");
});

function authEvent(method, rawPath, body) {
  return {
    rawPath,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      http: { method, path: rawPath },
      authorizer: {
        lambda: {
          userId: "google:subject"
        }
      }
    }
  };
}

function userItem({ includedWebsites = 1, credits = 0, mediaStorageMb = 10, additionalMediaStorageMb = 0, syncpolyBanner = true } = {}) {
  return {
    user_id: { S: "google:subject" },
    entitlements_json: {
      S: JSON.stringify({
        included_websites: {
          type: "usage",
          limit: includedWebsites
        },
        media_storage_mb: {
          type: "usage",
          limit: mediaStorageMb
        },
        ads_removed: {
          type: "boolean",
          value: false
        },
        syncpoly_banner: {
          type: "boolean",
          value: syncpolyBanner
        }
      })
    },
    additional_website_credits: { N: String(credits) },
    additional_media_storage_mb: { N: String(additionalMediaStorageMb) }
  };
}

function websiteItem({
  websiteId,
  name = "Website",
  folder = "website",
  configJson,
  seoJson
}) {
  return {
    user_id: { S: "google:subject" },
    website_id: { S: websiteId },
    folder: { S: folder },
    name: { S: name },
    domain: { S: "example.test" },
    template: { S: "service" },
    source: { S: "included" },
    status: { S: "draft" },
    deployment_status: { S: "not_deployed" },
    created_at: { S: "2030-03-17T17:46:40.000Z" },
    updated_at: { S: "2030-03-17T17:46:40.000Z" },
    ...(configJson ? { config_json: { S: configJson } } : {}),
    ...(seoJson ? { seo_json: { S: seoJson } } : {})
  };
}

function mediaItem({ bytes = 1024 } = {}) {
  return {
    user_id: { S: "google:subject" },
    media_id: { S: "media_1" },
    website_id: { S: "site_1" },
    file_name: { S: "hero.jpg" },
    s3_key: { S: "website/media/hero.jpg" },
    content_type: { S: "image/jpeg" },
    bytes: { N: String(bytes) },
    original_bytes: { N: String(bytes) },
    status: { S: "uploaded" },
    created_at: { S: "2030-03-17T17:46:40.000Z" },
    updated_at: { S: "2030-03-17T17:46:40.000Z" }
  };
}

function validConfig() {
  return {
    site: {
      name: "Test Site",
      shortName: "Test",
      url: "https://example.test",
      locale: "en-US",
      description: "A test website"
    },
    seo: {
      defaultTitle: "Test Site",
      defaultImage: "/media/hero.jpg"
    },
    footer: {},
    blocks: {},
    pages: [
      {
        path: "/",
        title: "Home",
        description: "Homepage",
        sections: [
          {
            type: "hero",
            id: "hero"
          }
        ]
      }
    ]
  };
}
