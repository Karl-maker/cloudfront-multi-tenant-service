'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, describe, it } = require('node:test');

const {
  createHandler,
  getLookupForHost,
  buildS3RedirectUrl
} = require('../proxy/lambda');

const LOCALSTACK_PORT = process.env.LOCALSTACK_PORT || '4566';
const LOCALSTACK_ENDPOINT = process.env.DYNAMODB_ENDPOINT || `http://localhost:${LOCALSTACK_PORT}`;
const REGION = process.env.AWS_REGION || 'us-east-1';
const CUSTOM_DOMAIN_INDEX_NAME = process.env.CUSTOM_DOMAIN_INDEX_NAME || 'customDomain-index';

describe('unit: proxy lambda domain matching', () => {
  it('resolves syncpoly subdomains by username', () => {
    assert.deepEqual(getLookupForHost('Acme.Syncpoly.com:443', 'syncpoly.com'), {
      type: 'subdomain',
      username: 'acme',
      host: 'acme.syncpoly.com'
    });
  });

  it('resolves non-syncpoly hosts as custom domains', () => {
    assert.deepEqual(getLookupForHost('www.customer.test', 'syncpoly.com'), {
      type: 'custom-domain',
      customDomain: 'www.customer.test',
      host: 'www.customer.test'
    });
  });

  it('builds S3 folder redirects with path and query preserved', () => {
    const location = buildS3RedirectUrl({
      s3Bucket: 'syncpoly-sites',
      folder: '/acme-site/',
      path: '/docs',
      query: '?preview=true'
    });

    assert.equal(location, 'https://syncpoly-sites.s3.amazonaws.com/acme-site/docs?preview=true');
  });

  it('redirects subdomain requests to the matched client folder', async () => {
    const handler = createHandler({
      s3Bucket: 'syncpoly-sites',
      syncBaseDomain: 'syncpoly.com',
      clientsRepository: fakeRepository({
        usernames: {
          acme: { username: 'acme', email: 'owner@acme.test', isTrial: true, folder: 'acme-site' }
        }
      })
    });

    const response = await handler({
      headers: { host: 'acme.syncpoly.com' },
      rawPath: '/dashboard',
      rawQueryString: 'mode=edit'
    });

    assert.equal(response.statusCode, 302);
    assert.equal(
      response.headers.Location,
      'https://syncpoly-sites.s3.amazonaws.com/acme-site/dashboard?mode=edit'
    );
  });

  it('redirects custom domains through the customDomain index lookup', async () => {
    const handler = createHandler({
      s3Bucket: 'syncpoly-sites',
      syncBaseDomain: 'syncpoly.com',
      clientsRepository: fakeRepository({
        customDomains: {
          'www.customer.test': {
            username: 'customer',
            email: 'team@customer.test',
            isTrial: false,
            folder: 'customer-site',
            customDomain: 'www.customer.test'
          }
        }
      })
    });

    const response = await handler({
      headers: { host: 'www.customer.test' },
      rawPath: '/',
      rawQueryString: ''
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.Location, 'https://syncpoly-sites.s3.amazonaws.com/customer-site/');
  });

  it('returns 404 when a domain does not match a client', async () => {
    const handler = createHandler({
      s3Bucket: 'syncpoly-sites',
      clientsRepository: fakeRepository()
    });

    const response = await handler({
      headers: { host: 'missing.syncpoly.com' },
      rawPath: '/'
    });

    assert.equal(response.statusCode, 404);
    assert.match(response.body, /ClientNotFound/);
  });
});

describe('integration: DynamoDB lookups through LocalStack', () => {
  const resources = [];

  after(async () => {
    for (const resource of resources.reverse()) {
      await resource.cleanup();
    }
  });

  it('finds subdomain clients by username and custom domains by indexed customDomain', async (t) => {
    const aws = await loadAwsSdkOrSkip(t);
    if (!aws) return;

    await requireLocalStackOrSkip(t);

    const tableName = uniqueTableName('clients-integration');
    const dynamoClient = createDynamoClient(aws);
    await createClientsTable(aws, dynamoClient, tableName);
    resources.push({ cleanup: () => deleteClientsTable(aws, dynamoClient, tableName) });

    await putClient(aws, dynamoClient, tableName, {
      username: 'acme',
      email: 'owner@acme.test',
      isTrial: true,
      folder: 'acme-site'
    });
    await putClient(aws, dynamoClient, tableName, {
      username: 'customco',
      email: 'admin@customco.test',
      isTrial: false,
      folder: 'customco-site',
      customDomain: 'portal.customco.test'
    });

    const handler = createHandler({
      tableName,
      dynamoClient,
      s3Bucket: 'syncpoly-sites',
      syncBaseDomain: 'syncpoly.com'
    });

    const subdomainResponse = await handler({
      headers: { host: 'acme.syncpoly.com' },
      rawPath: '/settings',
      rawQueryString: ''
    });
    const customDomainResponse = await handler({
      headers: { host: 'portal.customco.test' },
      rawPath: '/welcome',
      rawQueryString: 'ref=domain'
    });

    assert.equal(subdomainResponse.statusCode, 302);
    assert.equal(
      subdomainResponse.headers.Location,
      'https://syncpoly-sites.s3.amazonaws.com/acme-site/settings'
    );
    assert.equal(customDomainResponse.statusCode, 302);
    assert.equal(
      customDomainResponse.headers.Location,
      'https://syncpoly-sites.s3.amazonaws.com/customco-site/welcome?ref=domain'
    );
  });
});

describe('e2e: HTTP requests redirect by Host header', () => {
  const resources = [];

  after(async () => {
    for (const resource of resources.reverse()) {
      await resource.cleanup();
    }
  });

  it('redirects different hosts to their DynamoDB configured S3 folders', async (t) => {
    const aws = await loadAwsSdkOrSkip(t);
    if (!aws) return;

    await requireLocalStackOrSkip(t);

    const tableName = uniqueTableName('clients-e2e');
    const dynamoClient = createDynamoClient(aws);
    await createClientsTable(aws, dynamoClient, tableName);
    resources.push({ cleanup: () => deleteClientsTable(aws, dynamoClient, tableName) });

    await putClient(aws, dynamoClient, tableName, {
      username: 'beta',
      email: 'beta@syncpoly.test',
      isTrial: true,
      folder: 'beta-site'
    });
    await putClient(aws, dynamoClient, tableName, {
      username: 'customapp',
      email: 'ops@customapp.test',
      isTrial: false,
      folder: 'custom-app',
      customDomain: 'app.example.test'
    });

    const handler = createHandler({
      tableName,
      dynamoClient,
      s3Bucket: 'syncpoly-sites',
      s3PublicBaseUrl: 'http://s3.localhost.localstack.cloud:4566/syncpoly-sites',
      syncBaseDomain: 'syncpoly.com'
    });
    const server = await startProxyServer(handler);
    resources.push({ cleanup: () => closeServer(server) });

    const subdomainResponse = await request(server, {
      host: 'beta.syncpoly.com',
      path: '/launch?via=e2e'
    });
    const customDomainResponse = await request(server, {
      host: 'app.example.test',
      path: '/'
    });
    const missingResponse = await request(server, {
      host: 'missing.syncpoly.com',
      path: '/'
    });

    assert.equal(subdomainResponse.statusCode, 302);
    assert.equal(
      subdomainResponse.headers.location,
      'http://s3.localhost.localstack.cloud:4566/syncpoly-sites/beta-site/launch?via=e2e'
    );
    assert.equal(customDomainResponse.statusCode, 302);
    assert.equal(
      customDomainResponse.headers.location,
      'http://s3.localhost.localstack.cloud:4566/syncpoly-sites/custom-app/'
    );
    assert.equal(missingResponse.statusCode, 404);
  });
});

function fakeRepository({ usernames = {}, customDomains = {} } = {}) {
  return {
    async getByUsername(username) {
      return usernames[username] || null;
    },
    async getByCustomDomain(customDomain) {
      return customDomains[customDomain] || null;
    }
  };
}

async function loadAwsSdkOrSkip(t) {
  try {
    return {
      dynamodb: require('@aws-sdk/client-dynamodb'),
      libDynamodb: require('@aws-sdk/lib-dynamodb')
    };
  } catch (error) {
    if (process.env.REQUIRE_LOCALSTACK === '1') {
      throw error;
    }
    t.skip('AWS SDK dependencies are not installed. Run npm install to enable LocalStack suites.');
    return null;
  }
}

async function requireLocalStackOrSkip(t) {
  const ready = await canReachLocalStack();
  if (ready) {
    return;
  }

  const message = `LocalStack is not reachable at ${LOCALSTACK_ENDPOINT}. Run docker compose up -d.`;
  if (process.env.REQUIRE_LOCALSTACK === '1') {
    throw new Error(message);
  }

  t.skip(message);
}

function createDynamoClient(aws) {
  return new aws.dynamodb.DynamoDBClient({
    region: REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    }
  });
}

async function createClientsTable(aws, dynamoClient, tableName) {
  await dynamoClient.send(
    new aws.dynamodb.CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'username', AttributeType: 'S' },
        { AttributeName: 'customDomain', AttributeType: 'S' }
      ],
      KeySchema: [{ AttributeName: 'username', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: CUSTOM_DOMAIN_INDEX_NAME,
          KeySchema: [{ AttributeName: 'customDomain', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        }
      ]
    })
  );

  await aws.dynamodb.waitUntilTableExists(
    { client: dynamoClient, minDelay: 1, maxDelay: 2, maxWaitTime: 20 },
    { TableName: tableName }
  );
}

async function deleteClientsTable(aws, dynamoClient, tableName) {
  try {
    await dynamoClient.send(new aws.dynamodb.DeleteTableCommand({ TableName: tableName }));
  } catch (error) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
  }
}

async function putClient(aws, dynamoClient, tableName, client) {
  const documentClient = aws.libDynamodb.DynamoDBDocumentClient.from(dynamoClient);
  await documentClient.send(
    new aws.libDynamodb.PutCommand({
      TableName: tableName,
      Item: client
    })
  );
}

function uniqueTableName(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function canReachLocalStack() {
  return new Promise((resolve) => {
    const url = new URL('/_localstack/health', LOCALSTACK_ENDPOINT);
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('error', () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function startProxyServer(handler) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const lambdaResponse = await handler({
        headers: request.headers,
        rawPath: url.pathname,
        rawQueryString: url.searchParams.toString(),
        requestContext: {
          http: {
            method: request.method,
            path: url.pathname
          }
        }
      });

      response.writeHead(lambdaResponse.statusCode, lambdaResponse.headers);
      response.end(lambdaResponse.body || '');
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function request(server, { host, path }) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { host }
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response));
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
