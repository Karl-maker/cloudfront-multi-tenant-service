# Syncpoly Site Proxy

Small Lambda codebase for resolving a requested host to a client record in DynamoDB, then redirecting that request into the client's folder in a shared S3 bucket.

## Shape

- `proxy/lambda.js` is the Lambda entrypoint.
- DynamoDB table primary key: `username` (the Syncpoly subdomain).
- DynamoDB GSI: `customDomain-index` with partition key `customDomain`.
- Required client attributes: `username`, `email`, `isTrial`, `folder`.
- Optional client attribute: `customDomain`.

## Environment

```bash
CLIENTS_TABLE_NAME=syncpoly-clients
S3_BUCKET_NAME=syncpoly-sites
SYNC_BASE_DOMAIN=syncpoly.com
CUSTOM_DOMAIN_INDEX_NAME=customDomain-index
AWS_REGION=us-east-1
```

For local tests against LocalStack:

```bash
DYNAMODB_ENDPOINT=http://localhost:4566
S3_PUBLIC_BASE_URL=http://s3.localhost.localstack.cloud:4566/syncpoly-sites
```

If another LocalStack already owns port `4566`, run this stack on another host port:

```bash
LOCALSTACK_PORT=4567 docker compose up -d
DYNAMODB_ENDPOINT=http://localhost:4567 npm run test:integration
DYNAMODB_ENDPOINT=http://localhost:4567 npm run test:e2e
```

## Run Locally

```bash
npm install
docker compose up -d
npm test
```

Run individual suites:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Integration and e2e tests use LocalStack. The full `npm test` command skips those suites if LocalStack is not running; the dedicated integration/e2e scripts require it.
