# Syncpoly CloudFront Folder Router

CloudFront Function setup for serving many domains from different folders in one private S3 bucket.

The browser keeps the original URL:

```text
https://hello.com/about
```

CloudFront rewrites the origin request to:

```text
s3://syncpoly-web-builder-sites/syncpoly/templates/pressure-washer/about/index.html
```

Tenant-owned public files are mapped to the tenant folder instead of the shared template. Requests for:

```text
/public/site.config.json
/llm.txt
/llms.txt
/sitemap.xml
/robot.txt
/robots.txt
/public/favicon.ico
/public/favicon.png
/public/favicon.svg
/media/*
/public/media/*
```

are rewritten to the mapped tenant folder:

```text
s3://syncpoly-web-builder-sites/hello-site/site.config.json
s3://syncpoly-web-builder-sites/hello-site/llm.txt
s3://syncpoly-web-builder-sites/hello-site/llms.txt
s3://syncpoly-web-builder-sites/hello-site/sitemap.xml
s3://syncpoly-web-builder-sites/hello-site/robot.txt
s3://syncpoly-web-builder-sites/hello-site/favicon.ico
s3://syncpoly-web-builder-sites/hello-site/media/example.jpg
```

## Shape

- `cloudfront/domain-folder-router.js` is the CloudFront Function source.
- `test/cloudfront-function.test.js` tests host-to-folder rewrites locally.
- `site/404.html` and `site/404.css` are the shared CloudFront error page assets.
- `infra/` creates the private S3 bucket, CloudFront Function, CloudFront distribution, AWS WAF, cache policies, security headers, Origin Access Control, and read-only S3 bucket policy.
- `bin/bootstrap-tf-state.sh` creates the hardcoded Terraform state bucket and DynamoDB lock table.
- `bin/upload-global-404.sh` uploads the shared 404 assets to the content bucket root.

## Hardcoded Host Map

For now, edit this object directly in `cloudfront/domain-folder-router.js`:

```js
var sitesByHost = {
  "hello.com": { folder: "hello-site", template: "pressure-washer" },
  "www.hello.com": { folder: "hello-site", template: "pressure-washer" }
};
```

CloudFront Functions cannot call DynamoDB directly, so hardcoded mappings or CloudFront KeyValueStore are the practical paths here.

## WAF And Caching

CloudFront includes AWS Shield Standard automatically. Terraform also attaches an AWS WAF Web ACL to the distribution with:

- Amazon IP reputation list
- AWS common rule set
- known bad input rules
- SQL injection rules
- IP rate limiting at `2,000` requests per 5 minutes

Caching is split by path:

- Pages use a short cache: 5 minute default, 1 hour max.
- Static assets use a long cache: 1 year default/max.
- Long-cache paths are `/_next/static/*`, `/assets/*`, `/images/*`, `/fonts/*`, `/favicon.ico`, and `/404.css`.

The distribution also adds baseline browser security headers, including HSTS, frame denial, content type sniffing protection, referrer policy, and a restrictive permissions policy.

## Local Commands

```bash
npm install
npm run build
npm test
```

Upload the global 404 page after the content bucket exists:

```bash
npm run deploy:global-404
```

To upload and invalidate CloudFront locally:

```bash
CLOUDFRONT_DISTRIBUTION_ID="$(terraform -chdir=infra output -raw cloudfront_distribution_id)" \
npm run deploy:global-404
```

Terraform validation without touching remote state:

```bash
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

## Terraform State Bootstrap

The backend is hardcoded to:

```text
S3 bucket: syncpoly-web-builder-terraform-state
State key: cloudfront/terraform.tfstate
DynamoDB lock table: syncpoly-web-builder-terraform-locks
Region: us-east-1
```

Create those once with AWS credentials in your environment:

```bash
AWS_ACCESS_KEY_ID=... \
AWS_SECRET_ACCESS_KEY=... \
AWS_REGION=us-east-1 \
./bin/bootstrap-tf-state.sh
```

Then run:

```bash
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
npm run deploy:global-404
```

## GitHub Secrets

The manual Terraform workflow reads AWS credentials from GitHub secrets:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

CI runs build, tests, Terraform formatting, and Terraform validation. The manual `Terraform` workflow bootstraps state, plans, and can apply when you choose `apply`.

Terraform intentionally ignores manual changes to CloudFront aliases and viewer certificates, so adding custom domains later in the AWS console will not be removed by the next apply.

CloudFront is configured to serve `/404.html` as a shared global error page for S3 `403` and `404` misses. The function leaves `/404.html` and `/404.css` at the S3 bucket root so the shared page works for every mapped domain.
