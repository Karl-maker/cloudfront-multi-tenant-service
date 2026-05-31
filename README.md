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
/site.config.json
/llm.txt
/llms.txt
/sitemap.xml
/robot.txt
/robots.txt
/media/*
/public/media/*
/favicon.ico
/favicon.png
/favicon.svg
/public/favicon.ico
/public/favicon.png
/public/favicon.svg
```

are rewritten to the mapped tenant folder:

```text
s3://syncpoly-web-builder-sites/hello-site/site.config.json
s3://syncpoly-web-builder-sites/hello-site/llm.txt
s3://syncpoly-web-builder-sites/hello-site/llms.txt
s3://syncpoly-web-builder-sites/hello-site/sitemap.xml
s3://syncpoly-web-builder-sites/hello-site/robot.txt
s3://syncpoly-web-builder-sites/hello-site/media/example.jpg
s3://syncpoly-web-builder-sites/hello-site/media/favicon.svg
s3://syncpoly-web-builder-sites/hello-site/media/logo.png
```

## Shape

- `cloudfront/domain-folder-router.js` is the CloudFront Function source.
- `docs/site-config-guide.md` explains site config, S3 layout, and naming conventions.
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
- Long-cache paths are `/_next/static/*`, `/assets/*`, `/images/*`, `/fonts/*`, `/media/*`, `/favicon.ico`, and `/404.css`.

The distribution also adds baseline browser security headers, including HSTS, frame denial, content type sniffing protection, referrer policy, and a restrictive permissions policy.

## Local Commands

```bash
npm install
npm run build
npm test
```

Site upload CLI:

```bash
npm run site:validate-config -- --file ./sites/example/site.config.json
npm run site:upload-config -- --file ./sites/example/site.config.json
npm run site:upload-media -- --source ./sites/example/media --config ./sites/example/site.config.json
npm run site:upload-media -- --source ./sites/example/media --config ./sites/example/site.config.json --max-width 1600 --quality 72
npm run site:upload-seo -- --source ./sites/example --config ./sites/example/site.config.json
npm run site -- preview --site ./sites/example --template /Users/family/Documents/syncpoly-ou/web-builder-templates/next-static-config-template --port 4173
npm run godaddy:add-cname -- --domain syncpoly.com --name example --value d111111abcdef8.cloudfront.net
```

`upload-media` optimizes media before uploading to S3. JPG/PNG/WebP/AVIF files are resized to fit within `1920x1920`, compressed for web delivery, and JPG/PNG/AVIF files also get a generated `.webp` sibling by default. Use `--no-webp` or `SITE_MEDIA_WEBP=0` to disable WebP variants.

Put every tenant-owned image in `sites/<name>/media`, including logos, favicons, OG/social images, hero photos, and gallery images. `upload-folder` rejects image files unless the target prefix is `media`; use `upload-media` for images so compression and WebP generation stay consistent.

Use `syncpoly-site preview` for QA screenshots. It overlays a generated site folder onto the template export and serves it on localhost, so outreach screenshots come from `http://127.0.0.1:<port>/` instead of the public domain.

Upload the global 404 page after the content bucket exists:

```bash
npm run deploy:global-404
```

To upload and invalidate CloudFront locally:

```bash
CLOUDFRONT_DISTRIBUTION_ID="$(terraform -chdir=infra output -raw cloudfront_distribution_id)" \
npm run deploy:global-404
```

## AI Clawbot

AI Clawbot now uses the normal OpenClaw gateway setup copied from the local `/Users/family/Documents/ai-agent` pattern and adjusted for Syncpoly website building.

Add your OpenAI key to `.env` as either `OPEN_AI_KEY` or `OPENAI_API_KEY`:

```text
OPEN_AI_KEY=...
```

Start it with:

```bash
./bin/start-clawbot.sh
```

or:

```bash
npm run clawbot:start
```

The gateway runs at:

```text
http://127.0.0.1:18789/
```

If `18789` is already taken by another OpenClaw setup, `./bin/start-clawbot.sh` uses the next free local port and prints the URL.

Channel setup is handled manually in the OpenClaw UI. The start script only starts OpenClaw and never blocks on channel-provider values.

The real `.env` file is not mounted into the OpenClaw workspace. Docker Compose reads `.env` on the host and passes only named runtime variables into the container. The agent can see:

- the Syncpoly website project tools at `/workspace/web-builder`
- the custom skill at `/workspace/.agents/skills/syncpoly-site-cli/SKILL.md`
- the template at `/workspace/templates/next-static-config-template`

The model defaults are cost-aware: the primary site-building model is `openai/gpt-5.4-mini`, heartbeat work uses `openai/gpt-5.4-nano`, and higher-cost models are not the default.

Check the Compose setup without starting it:

```bash
npm run clawbot:check
```

Run OpenClaw CLI commands against this Syncpoly container, not another local gateway:

```bash
npm run clawbot:openclaw -- channels login --channel whatsapp
```

Equivalent direct commands:

```bash
docker compose exec openclaw openclaw channels login --channel whatsapp
openclaw --container syncpoly-openclaw channels login --channel whatsapp
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
