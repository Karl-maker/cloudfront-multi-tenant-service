import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeFolderName, validateSiteConfig } = require("../../../lib/site-config-schema.js");

const dynamodb = new DynamoDBClient({});
const DEFAULT_MEDIA_LIMIT_MB = 10;
const IMAGE_TYPES = new Set(["image/avif", "image/jpeg", "image/png", "image/svg+xml", "image/webp"]);
const TEMPLATES = new Set(["service", "real-estate"]);

export const handler = createWebsitesHandler();

export function createWebsitesHandler({
  dynamodbClient = dynamodb,
  nowMs = () => Date.now(),
  uuidFn = randomUUID,
  presignPutObject = createPresignedPutObjectUrl
} = {}) {
  return async function websitesHandler(event) {
    return handleWebsites(event, {
      dynamodbClient,
      nowMs,
      uuidFn,
      presignPutObject
    });
  };
}

export async function handleWebsites(event, deps = {}) {
  const dynamodbClient = deps.dynamodbClient || dynamodb;
  const nowMs = deps.nowMs || (() => Date.now());
  const uuidFn = deps.uuidFn || randomUUID;
  const presignPutObject = deps.presignPutObject || createPresignedPutObjectUrl;

  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return jsonResponse(204, {}, event);
    }

    const userId = event.requestContext?.authorizer?.lambda?.userId;
    if (!userId) {
      return jsonResponse(401, { message: "Unauthorized." }, event);
    }

    const method = event.requestContext?.http?.method || "GET";
    const route = routeInfo(event);

    if (!route.websiteId) {
      if (method === "GET") {
        const [websites, user] = await Promise.all([
          listWebsites(dynamodbClient, userId),
          getUser(dynamodbClient, userId)
        ]);
        return jsonResponse(200, {
          websites,
          capacity: websiteCapacity(user, websites.length)
        }, event);
      }

      if (method === "POST") {
        return createOwnedWebsite({ event, dynamodbClient, userId, nowMs, uuidFn });
      }

      return jsonResponse(405, { message: "Method not allowed." }, event);
    }

    const [website, user] = await Promise.all([
      getWebsite(dynamodbClient, userId, route.websiteId),
      getUser(dynamodbClient, userId)
    ]);
    if (!website) {
      return jsonResponse(404, { message: "Website not found." }, event);
    }
    if (!user) {
      return jsonResponse(404, { message: "User not found." }, event);
    }

    if (method === "GET" && route.action === "") {
      return jsonResponse(200, { website, capacity: websiteCapacity(user, undefined) }, event);
    }

    if (route.action === "media") {
      if (method === "GET") {
        const media = await listMedia(dynamodbClient, userId, route.websiteId);
        return jsonResponse(200, {
          media,
          quota: mediaQuota(user, media.reduce((sum, item) => sum + item.bytes, 0))
        }, event);
      }

      if (method === "POST") {
        return createMediaUpload({ event, dynamodbClient, user, website, nowMs, uuidFn, presignPutObject });
      }
    }

    if (method === "PUT" && route.action === "template") {
      return updateTemplate({ event, dynamodbClient, userId, website, nowMs });
    }

    if (method === "PUT" && route.action === "config") {
      return updateConfig({ event, dynamodbClient, user, website, nowMs });
    }

    if (method === "PUT" && route.action === "seo") {
      return updateSeo({ event, dynamodbClient, userId, website, nowMs });
    }

    if (method === "POST" && route.action === "deploy") {
      return requestDeploy({ event, dynamodbClient, userId, website, nowMs });
    }

    return jsonResponse(404, { message: "Website route not found." }, event);
  } catch (error) {
    console.error("Failed to manage websites", {
      message: error.message,
      name: error.name
    });

    return jsonResponse(error.statusCode || 500, { message: error.publicMessage || "Failed to manage websites." }, event);
  }
}

async function createOwnedWebsite({ event, dynamodbClient, userId, nowMs, uuidFn }) {
  const body = parseJsonBody(event.body, event.isBase64Encoded);
  const name = cleanString(body.name);
  if (!name) {
    return jsonResponse(400, { message: "Missing website name." }, event);
  }

  const [websites, user] = await Promise.all([
    listWebsites(dynamodbClient, userId),
    getUser(dynamodbClient, userId)
  ]);
  if (!user) {
    return jsonResponse(404, { message: "User not found." }, event);
  }

  const capacity = websiteCapacity(user, websites.length);
  if (capacity.remainingIncluded <= 0 && capacity.additionalWebsiteCredits <= 0) {
    return jsonResponse(402, {
      message: "Additional website purchase required.",
      paymentRequired: true,
      catalogItemId: "additional_website_one_time",
      amountCents: 2999,
      currency: "usd",
      capacity
    }, event);
  }

  const folder = normalizeFolderName(body.folder || name);
  if (!folder) {
    return jsonResponse(400, { message: "Website folder could not be derived from the name." }, event);
  }

  const websiteId = cleanString(body.websiteId) || uuidFn();
  const source = capacity.remainingIncluded > 0 ? "included" : "additional_credit";
  const timestamp = new Date(nowMs()).toISOString();
  const website = {
    userId,
    websiteId,
    folder,
    name,
    domain: cleanString(body.domain),
    template: normalizeTemplate(body.template || "service"),
    source,
    status: "draft",
    deploymentStatus: "not_deployed",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const transactItems = [
    {
      Put: {
        TableName: process.env.WEBSITE_FOLDERS_TABLE_NAME,
        Item: {
          folder: { S: folder },
          user_id: { S: userId },
          website_id: { S: websiteId },
          created_at: { S: timestamp }
        },
        ConditionExpression: "attribute_not_exists(folder)"
      }
    },
    {
      Put: {
        TableName: process.env.WEBSITES_TABLE_NAME,
        Item: websiteToDynamo(website),
        ConditionExpression: "attribute_not_exists(website_id)"
      }
    }
  ];

  if (capacity.remainingIncluded <= 0) {
    transactItems.push({
      Update: {
        TableName: process.env.USERS_TABLE_NAME,
        Key: {
          user_id: { S: userId }
        },
        ConditionExpression: "additional_website_credits >= :one",
        UpdateExpression: "SET updated_at = :updatedAt ADD additional_website_credits :minusOne",
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":minusOne": { N: "-1" },
          ":updatedAt": { S: timestamp }
        }
      }
    });
  }

  await dynamodbClient.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

  return jsonResponse(201, {
    website,
    capacity: websiteCapacity({
      ...user,
      additionalWebsiteCredits: capacity.remainingIncluded > 0 ? capacity.additionalWebsiteCredits : Math.max(capacity.additionalWebsiteCredits - 1, 0)
    }, websites.length + 1)
  }, event);
}

async function updateTemplate({ event, dynamodbClient, userId, website, nowMs }) {
  const body = parseJsonBody(event.body, event.isBase64Encoded);
  const template = normalizeTemplate(body.template);
  const timestamp = new Date(nowMs()).toISOString();

  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      Key: websiteKey(userId, website.websiteId),
      UpdateExpression: "SET template = :template, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":template": { S: template },
        ":updatedAt": { S: timestamp }
      }
    })
  );

  return jsonResponse(200, { website: { ...website, template, updatedAt: timestamp } }, event);
}

async function updateConfig({ event, dynamodbClient, user, website, nowMs }) {
  const body = parseJsonBody(event.body, event.isBase64Encoded);
  const config = body.config;
  const errors = validateSiteConfig(config);
  errors.push(...entitlementConfigErrors(config, user.entitlements));
  if (errors.length > 0) {
    return jsonResponse(400, { message: "Site config is invalid.", errors }, event);
  }

  const timestamp = new Date(nowMs()).toISOString();
  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      Key: websiteKey(user.userId, website.websiteId),
      UpdateExpression: "SET config_json = :config, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":config": { S: JSON.stringify(config) },
        ":updatedAt": { S: timestamp }
      }
    })
  );

  return jsonResponse(200, { config, updatedAt: timestamp }, event);
}

async function updateSeo({ event, dynamodbClient, userId, website, nowMs }) {
  const body = parseJsonBody(event.body, event.isBase64Encoded);
  const seo = {
    robotsTxt: cleanString(body.robotsTxt),
    sitemapXml: cleanString(body.sitemapXml),
    llmsTxt: cleanString(body.llmsTxt)
  };
  const errors = validateSeoFiles(seo);
  if (errors.length > 0) {
    return jsonResponse(400, { message: "SEO files are invalid.", errors }, event);
  }

  const timestamp = new Date(nowMs()).toISOString();
  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      Key: websiteKey(userId, website.websiteId),
      UpdateExpression: "SET seo_json = :seo, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":seo": { S: JSON.stringify(seo) },
        ":updatedAt": { S: timestamp }
      }
    })
  );

  return jsonResponse(200, { seo, updatedAt: timestamp }, event);
}

async function createMediaUpload({ event, dynamodbClient, user, website, nowMs, uuidFn, presignPutObject }) {
  const body = parseJsonBody(event.body, event.isBase64Encoded);
  const fileName = safeMediaFileName(body.fileName);
  const contentType = cleanString(body.contentType);
  const compressedBytes = Number(body.compressedBytes || body.bytes || 0);
  const originalBytes = Number(body.originalBytes || compressedBytes || 0);

  const errors = [];
  if (!fileName) errors.push("fileName must be a safe media file name.");
  if (!IMAGE_TYPES.has(contentType)) errors.push("contentType must be a supported image type.");
  if (!Number.isInteger(compressedBytes) || compressedBytes <= 0) errors.push("compressedBytes must be a positive integer.");
  if (body.compressed !== true) errors.push("Images must be compressed before requesting an upload URL.");

  const media = await listMedia(dynamodbClient, user.userId, website.websiteId);
  const quota = mediaQuota(user, media.reduce((sum, item) => sum + item.bytes, 0));
  if (quota.usedBytes + compressedBytes > quota.limitBytes) {
    errors.push("Media storage limit exceeded.");
  }
  if (errors.length > 0) {
    return jsonResponse(400, { message: "Media upload is invalid.", errors, quota }, event);
  }

  const mediaId = uuidFn();
  const key = `${website.folder}/media/${fileName}`;
  const timestamp = new Date(nowMs()).toISOString();
  await dynamodbClient.send(
    new PutItemCommand({
      TableName: process.env.WEBSITE_MEDIA_TABLE_NAME,
      Item: {
        user_id: { S: user.userId },
        media_id: { S: mediaId },
        website_id: { S: website.websiteId },
        file_name: { S: fileName },
        s3_key: { S: key },
        content_type: { S: contentType },
        bytes: { N: String(compressedBytes) },
        original_bytes: { N: String(originalBytes) },
        status: { S: "upload_pending" },
        created_at: { S: timestamp },
        updated_at: { S: timestamp }
      },
      ConditionExpression: "attribute_not_exists(media_id)"
    })
  );

  return jsonResponse(200, {
    media: {
      mediaId,
      websiteId: website.websiteId,
      fileName,
      key,
      bytes: compressedBytes,
      contentType,
      status: "upload_pending",
      createdAt: timestamp
    },
    upload: await presignPutObject({
      bucket: resolveContentBucket(),
      key,
      contentType,
      expiresInSeconds: 900
    }),
    quota: mediaQuota(user, quota.usedBytes + compressedBytes)
  }, event);
}

async function requestDeploy({ event, dynamodbClient, userId, website, nowMs }) {
  const timestamp = new Date(nowMs()).toISOString();
  const config = parseJson(website.configJson);
  const configErrors = validateSiteConfig(config);
  const seoErrors = validateSeoFiles(parseJson(website.seoJson));
  if (configErrors.length > 0 || seoErrors.length > 0) {
    return jsonResponse(400, {
      message: "Website files are invalid.",
      errors: [...configErrors, ...seoErrors]
    }, event);
  }

  const firstDeploy = !website.firstDeployApprovedAt && website.deploymentStatus === "not_deployed";
  const status = firstDeploy ? "pending_first_deploy_approval" : "deploy_requested";
  await dynamodbClient.send(
    new UpdateItemCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      Key: websiteKey(userId, website.websiteId),
      UpdateExpression: "SET deployment_status = :status, deploy_requested_at = :requestedAt, updated_at = :updatedAt",
      ExpressionAttributeValues: {
        ":status": { S: status },
        ":requestedAt": { S: timestamp },
        ":updatedAt": { S: timestamp }
      }
    })
  );

  if (firstDeploy) {
    return jsonResponse(202, {
      deploymentStatus: status,
      approvalRequired: true,
      message: "This website needs to be approved within 48 hours before first deployment."
    }, event);
  }

  return jsonResponse(202, {
    deploymentStatus: status,
    approvalRequired: false,
    cdn: {
      invalidatePaths: ["/site.config.json", "/media/*", "/sitemap.xml", "/robots.txt", "/llms.txt"]
    },
    godaddy: website.domain ? {
      action: "upsert_cname",
      domain: website.domain,
      value: process.env.CLOUDFRONT_DOMAIN_NAME || ""
    } : null
  }, event);
}

async function getUser(dynamodbClient, userId) {
  const response = await dynamodbClient.send(
    new GetItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: {
        user_id: { S: userId }
      }
    })
  );

  if (!response.Item) {
    return undefined;
  }

  return {
    userId: response.Item.user_id.S,
    entitlements: parseJson(response.Item.entitlements_json?.S),
    additionalWebsiteCredits: response.Item.additional_website_credits?.N ? Number(response.Item.additional_website_credits.N) : 0,
    additionalMediaStorageMb: response.Item.additional_media_storage_mb?.N ? Number(response.Item.additional_media_storage_mb.N) : 0
  };
}

async function getWebsite(dynamodbClient, userId, websiteId) {
  const response = await dynamodbClient.send(
    new GetItemCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      Key: websiteKey(userId, websiteId)
    })
  );

  return response.Item ? websiteFromDynamo(response.Item) : undefined;
}

async function listWebsites(dynamodbClient, userId) {
  const response = await dynamodbClient.send(
    new QueryCommand({
      TableName: process.env.WEBSITES_TABLE_NAME,
      KeyConditionExpression: "user_id = :userId",
      ExpressionAttributeValues: {
        ":userId": { S: userId }
      },
      ScanIndexForward: false
    })
  );

  return (response.Items || []).map(websiteFromDynamo);
}

async function listMedia(dynamodbClient, userId, websiteId) {
  const response = await dynamodbClient.send(
    new QueryCommand({
      TableName: process.env.WEBSITE_MEDIA_TABLE_NAME,
      KeyConditionExpression: "user_id = :userId",
      FilterExpression: "website_id = :websiteId",
      ExpressionAttributeValues: {
        ":userId": { S: userId },
        ":websiteId": { S: websiteId }
      },
      ScanIndexForward: false
    })
  );

  return (response.Items || []).map((item) => ({
    mediaId: item.media_id.S,
    websiteId: item.website_id.S,
    fileName: item.file_name.S,
    key: item.s3_key.S,
    contentType: item.content_type.S,
    bytes: item.bytes?.N ? Number(item.bytes.N) : 0,
    originalBytes: item.original_bytes?.N ? Number(item.original_bytes.N) : 0,
    status: item.status?.S || "upload_pending",
    createdAt: item.created_at?.S,
    updatedAt: item.updated_at?.S
  }));
}

function websiteToDynamo(website) {
  return {
    user_id: { S: website.userId },
    website_id: { S: website.websiteId },
    folder: { S: website.folder },
    name: { S: website.name },
    domain: { S: website.domain || "" },
    template: { S: website.template },
    source: { S: website.source },
    status: { S: website.status },
    deployment_status: { S: website.deploymentStatus },
    created_at: { S: website.createdAt },
    updated_at: { S: website.updatedAt }
  };
}

function websiteFromDynamo(item) {
  return {
    userId: item.user_id.S,
    websiteId: item.website_id.S,
    folder: item.folder?.S || "",
    name: item.name?.S || "",
    domain: item.domain?.S || "",
    template: item.template?.S || "service",
    source: item.source?.S || "included",
    status: item.status?.S || "draft",
    deploymentStatus: item.deployment_status?.S || "not_deployed",
    configJson: item.config_json?.S,
    seoJson: item.seo_json?.S,
    deployRequestedAt: item.deploy_requested_at?.S,
    firstDeployApprovedAt: item.first_deploy_approved_at?.S,
    createdAt: item.created_at?.S,
    updatedAt: item.updated_at?.S
  };
}

function websiteCapacity(user, currentWebsiteCount = 0) {
  const includedWebsiteLimit = includedWebsitesFromEntitlements(user?.entitlements);
  const additionalWebsiteCredits = Math.max(user?.additionalWebsiteCredits || 0, 0);
  const remainingIncluded = Math.max(includedWebsiteLimit - currentWebsiteCount, 0);

  return {
    includedWebsiteLimit,
    currentWebsiteCount,
    remainingIncluded,
    additionalWebsiteCredits,
    canCreate: remainingIncluded > 0 || additionalWebsiteCredits > 0
  };
}

function mediaQuota(user, usedBytes) {
  const baseMb = mediaLimitFromEntitlements(user?.entitlements);
  const additionalMb = Math.max(user?.additionalMediaStorageMb || 0, 0);
  const limitMb = baseMb + additionalMb;
  const limitBytes = limitMb * 1024 * 1024;
  return {
    usedBytes,
    limitBytes,
    limitMb,
    remainingBytes: Math.max(limitBytes - usedBytes, 0)
  };
}

function includedWebsitesFromEntitlements(entitlements = {}) {
  const entitlement = entitlements.included_websites || entitlements.websites;
  if (!entitlement) {
    return 1;
  }

  return Math.max(Number(entitlement.limit ?? entitlement.value ?? 1) || 1, 0);
}

function mediaLimitFromEntitlements(entitlements = {}) {
  const entitlement = entitlements.media_storage_mb || entitlements.media_storage;
  if (!entitlement) {
    return DEFAULT_MEDIA_LIMIT_MB;
  }

  return Math.max(Number(entitlement.limit ?? entitlement.value ?? DEFAULT_MEDIA_LIMIT_MB) || DEFAULT_MEDIA_LIMIT_MB, 0);
}

function entitlementConfigErrors(config, entitlements = {}) {
  const errors = [];
  const adsRemoved = Boolean(entitlements.ads_removed?.value);
  const syncpolyBannerRequired = entitlements.syncpoly_banner?.value !== false;

  if (!adsRemoved && (config?.ads?.enabled === false || config?.monetization?.adsEnabled === false)) {
    errors.push("Plan entitlement does not allow removing ads.");
  }
  if (syncpolyBannerRequired && (config?.syncpoly?.banner === false || config?.branding?.showSyncpolyBanner === false)) {
    errors.push("Plan entitlement does not allow removing the Syncpoly banner.");
  }
  return errors;
}

function validateSeoFiles(seo) {
  const errors = [];
  if (seo.robotsTxt && !/User-agent:/i.test(seo.robotsTxt)) {
    errors.push("robotsTxt must include a User-agent rule.");
  }
  if (seo.sitemapXml && !/<urlset[\s>]/i.test(seo.sitemapXml)) {
    errors.push("sitemapXml must include a urlset.");
  }
  if (seo.llmsTxt && seo.llmsTxt.length > 100_000) {
    errors.push("llmsTxt is too large.");
  }
  return errors;
}

function normalizeTemplate(value) {
  const template = cleanString(value);
  if (!TEMPLATES.has(template)) {
    const error = new Error("Unsupported template.");
    error.statusCode = 400;
    error.publicMessage = "Unsupported template.";
    throw error;
  }
  return template;
}

function safeMediaFileName(value) {
  const clean = cleanString(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.endsWith("/") || clean.startsWith("media/")) {
    return "";
  }
  return clean
    .split("/")
    .map((part) => normalizeFolderName(part.replace(/\.[^.]+$/, "")) + extension(part))
    .join("/");
}

function extension(fileName) {
  const match = String(fileName).toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function routeInfo(event) {
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const match = path.match(/^\/websites(?:\/([^/]+))?(?:\/([^/]+))?/);
  return {
    websiteId: event.pathParameters?.websiteId || match?.[1] || "",
    action: event.pathParameters?.action || match?.[2] || ""
  };
}

function websiteKey(userId, websiteId) {
  return {
    user_id: { S: userId },
    website_id: { S: websiteId }
  };
}

function resolveContentBucket() {
  return process.env.CONTENT_BUCKET || process.env.SITE_BUCKET || process.env.S3_BUCKET || "syncpoly-web-builder-sites";
}

async function createPresignedPutObjectUrl({ bucket, key, contentType, expiresInSeconds }) {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  if (!accessKeyId || !secretAccessKey) {
    return { method: "PUT", url: "", headers: { "content-type": contentType }, expiresInSeconds };
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "content-type;host",
    ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {})
  });
  const canonicalQuery = sortQuery(query);
  const canonicalRequest = [
    "PUT",
    `/${encodedKey}`,
    canonicalQuery,
    `content-type:${contentType}\nhost:${host}\n`,
    "content-type;host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp, region), stringToSign, "hex");

  return {
    method: "PUT",
    url: `https://${host}/${encodedKey}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    headers: { "content-type": contentType },
    expiresInSeconds
  };
}

function sortQuery(params) {
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function signingKey(secretAccessKey, dateStamp, region) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function parseJson(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
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

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
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
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
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
