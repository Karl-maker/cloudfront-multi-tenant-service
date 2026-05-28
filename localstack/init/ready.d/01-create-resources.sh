#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="${CLIENTS_TABLE_NAME:-syncpoly-clients}"
BUCKET_NAME="${S3_BUCKET_NAME:-syncpoly-sites}"
INDEX_NAME="${CUSTOM_DOMAIN_INDEX_NAME:-customDomain-index}"

if ! awslocal dynamodb describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; then
  awslocal dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
      AttributeName=username,AttributeType=S \
      AttributeName=customDomain,AttributeType=S \
    --key-schema AttributeName=username,KeyType=HASH \
    --global-secondary-indexes "[
      {
        \"IndexName\": \"$INDEX_NAME\",
        \"KeySchema\": [{\"AttributeName\": \"customDomain\", \"KeyType\": \"HASH\"}],
        \"Projection\": {\"ProjectionType\": \"ALL\"}
      }
    ]"

  awslocal dynamodb wait table-exists --table-name "$TABLE_NAME"
fi

awslocal s3 mb "s3://$BUCKET_NAME" >/dev/null 2>&1 || true

awslocal dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item '{
    "username": {"S": "acme"},
    "email": {"S": "owner@acme.test"},
    "isTrial": {"BOOL": true},
    "folder": {"S": "acme-site"}
  }'

awslocal dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item '{
    "username": {"S": "customco"},
    "email": {"S": "admin@customco.test"},
    "isTrial": {"BOOL": false},
    "folder": {"S": "customco-site"},
    "customDomain": {"S": "www.customco.test"}
  }'

printf '%s\n' '<h1>Acme site</h1>' >/tmp/acme-index.html
printf '%s\n' '<h1>CustomCo site</h1>' >/tmp/customco-index.html
awslocal s3 cp /tmp/acme-index.html "s3://$BUCKET_NAME/acme-site/index.html"
awslocal s3 cp /tmp/customco-index.html "s3://$BUCKET_NAME/customco-site/index.html"
