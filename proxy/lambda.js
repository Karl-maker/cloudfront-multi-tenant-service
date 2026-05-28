'use strict';

const DEFAULT_SYNC_BASE_DOMAIN = 'syncpoly.com';
const DEFAULT_CUSTOM_DOMAIN_INDEX = 'customDomain-index';
const DEFAULT_REGION = 'us-east-1';

function loadAwsSdk() {
  const dynamodb = require('@aws-sdk/client-dynamodb');
  const libDynamodb = require('@aws-sdk/lib-dynamodb');

  return {
    DynamoDBClient: dynamodb.DynamoDBClient,
    DynamoDBDocumentClient: libDynamodb.DynamoDBDocumentClient,
    GetCommand: libDynamodb.GetCommand,
    QueryCommand: libDynamodb.QueryCommand
  };
}

function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') {
    return '';
  }

  return hostHeader
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/:\d+$/, '');
}

function getHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  const headerName = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return headerName ? headers[headerName] : undefined;
}

function getRequestHost(event) {
  return normalizeHost(
    getHeader(event.headers, 'x-forwarded-host') ||
      getHeader(event.headers, 'host') ||
      event.requestContext?.domainName
  );
}

function getRequestPath(event) {
  const path = event.rawPath || event.path || event.requestContext?.http?.path || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function getRequestQuery(event) {
  if (typeof event.rawQueryString === 'string') {
    return event.rawQueryString ? `?${event.rawQueryString}` : '';
  }

  if (!event.queryStringParameters) {
    return '';
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters)) {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

function getLookupForHost(hostInput, syncBaseDomain = DEFAULT_SYNC_BASE_DOMAIN) {
  const host = normalizeHost(hostInput);
  const baseDomain = normalizeHost(syncBaseDomain);
  const syncSuffix = `.${baseDomain}`;

  if (!host) {
    return { type: 'missing' };
  }

  if (host === baseDomain || host === `www.${baseDomain}`) {
    return { type: 'sync-root', host };
  }

  if (host.endsWith(syncSuffix)) {
    const username = host.slice(0, -syncSuffix.length);

    if (!username || username.includes('.')) {
      return { type: 'invalid-subdomain', host };
    }

    return { type: 'subdomain', username, host };
  }

  return { type: 'custom-domain', customDomain: host, host };
}

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function buildS3RedirectUrl({ s3Bucket, folder, path, query, s3PublicBaseUrl }) {
  const cleanFolder = trimSlashes(folder);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = s3PublicBaseUrl
    ? s3PublicBaseUrl.replace(/\/+$/, '')
    : `https://${s3Bucket}.s3.amazonaws.com`;

  return `${baseUrl}/${cleanFolder}${cleanPath}${query}`;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function redirectResponse(location, statusCode = 302) {
  return {
    statusCode,
    headers: {
      Location: location,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
}

function createDynamoClientsRepository(options = {}) {
  const {
    awsSdk = loadAwsSdk(),
    tableName = process.env.CLIENTS_TABLE_NAME,
    customDomainIndexName = process.env.CUSTOM_DOMAIN_INDEX_NAME || DEFAULT_CUSTOM_DOMAIN_INDEX,
    dynamoClient,
    dynamoDocumentClient
  } = options;

  if (!tableName) {
    throw new Error('CLIENTS_TABLE_NAME is required');
  }

  const documentClient =
    dynamoDocumentClient ||
    awsSdk.DynamoDBDocumentClient.from(
      dynamoClient ||
        new awsSdk.DynamoDBClient({
          region: process.env.AWS_REGION || DEFAULT_REGION,
          endpoint: process.env.DYNAMODB_ENDPOINT,
          credentials: process.env.DYNAMODB_ENDPOINT
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
              }
            : undefined
        })
    );

  return {
    async getByUsername(username) {
      const result = await documentClient.send(
        new awsSdk.GetCommand({
          TableName: tableName,
          Key: { username }
        })
      );

      return result.Item || null;
    },

    async getByCustomDomain(customDomain) {
      const result = await documentClient.send(
        new awsSdk.QueryCommand({
          TableName: tableName,
          IndexName: customDomainIndexName,
          KeyConditionExpression: 'customDomain = :customDomain',
          ExpressionAttributeValues: {
            ':customDomain': customDomain
          },
          Limit: 1
        })
      );

      return result.Items?.[0] || null;
    }
  };
}

function createHandler(options = {}) {
  const {
    clientsRepository = createDynamoClientsRepository(options),
    syncBaseDomain = process.env.SYNC_BASE_DOMAIN || DEFAULT_SYNC_BASE_DOMAIN,
    s3Bucket = process.env.S3_BUCKET_NAME,
    s3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL,
    redirectStatusCode = Number(process.env.REDIRECT_STATUS_CODE || 302)
  } = options;

  if (!s3Bucket && !s3PublicBaseUrl) {
    throw new Error('S3_BUCKET_NAME or S3_PUBLIC_BASE_URL is required');
  }

  return async function handler(event) {
    const host = getRequestHost(event || {});
    const lookup = getLookupForHost(host, syncBaseDomain);

    let client = null;
    if (lookup.type === 'subdomain') {
      client = await clientsRepository.getByUsername(lookup.username);
    } else if (lookup.type === 'custom-domain') {
      client = await clientsRepository.getByCustomDomain(lookup.customDomain);
    }

    if (!client) {
      return jsonResponse(404, {
        error: 'ClientNotFound',
        host,
        lookupType: lookup.type
      });
    }

    if (!client.folder) {
      return jsonResponse(500, {
        error: 'ClientFolderMissing',
        host,
        username: client.username
      });
    }

    const location = buildS3RedirectUrl({
      s3Bucket,
      folder: client.folder,
      path: getRequestPath(event || {}),
      query: getRequestQuery(event || {}),
      s3PublicBaseUrl
    });

    return redirectResponse(location, redirectStatusCode);
  };
}

const handler = async (event, context) => {
  const runtimeHandler = createHandler();
  return runtimeHandler(event, context);
};

module.exports = {
  handler,
  createHandler,
  createDynamoClientsRepository,
  getLookupForHost,
  normalizeHost,
  buildS3RedirectUrl
};
