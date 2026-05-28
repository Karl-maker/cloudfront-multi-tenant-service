#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
CONTENT_BUCKET="${CONTENT_BUCKET:-syncpoly-web-builder-sites}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$ROOT_DIR/site"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

if ! aws s3api head-bucket --bucket "$CONTENT_BUCKET" >/dev/null 2>&1; then
  echo "S3 bucket '$CONTENT_BUCKET' does not exist. Run Terraform apply first." >&2
  exit 1
fi

aws s3 cp "$SITE_DIR/404.html" "s3://$CONTENT_BUCKET/404.html" \
  --region "$AWS_REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache, max-age=0"

aws s3 cp "$SITE_DIR/404.css" "s3://$CONTENT_BUCKET/404.css" \
  --region "$AWS_REGION" \
  --content-type "text/css; charset=utf-8" \
  --cache-control "public, max-age=31536000, immutable"

if [ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/404.html" "/404.css" >/dev/null
fi

cat <<EOF
Global 404 assets uploaded.

Bucket: $CONTENT_BUCKET
Files:
- s3://$CONTENT_BUCKET/404.html
- s3://$CONTENT_BUCKET/404.css
EOF
