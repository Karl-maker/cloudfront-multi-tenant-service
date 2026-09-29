# Website Builder

This projects easily allows AI agents to utilize the cli to deploy simple static websites with multitenant setup utilizing cloudfront and s3.

The browser keeps the original URL:

```text
https://atlantic-villa-tobago.syncpoly.com/faq
```

CloudFront rewrites the origin request to:

```text
s3://syncpoly-web-builder-sites/syncpoly/templates/real-estate/faq/index.html
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
- `lambdas/auth/` contains the Google login API, API Gateway JWT authorizer, `/auth/me`, Stripe billing summary, and Stripe webhook handlers.

## Hardcoded Host Map

For now, edit this object directly in `cloudfront/domain-folder-router.js`:

```js
var sitesByHost = {
  "atlantic-villa-tobago.syncpoly.com": { folder: "atlantic-villa-tobago", template: "real-estate" }
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

Auth-specific test layers:

```bash
npm run test:unit
docker compose --profile test up -d localstack
npm run test:localstack
docker compose --profile test down -v
```

`test:unit` covers Google OAuth error handling, Google ID token `aud`/`iss`/`exp`/verified-email checks, JWT signature/expiry/issuer/audience failures, malformed bearer headers, `/auth/me` authorization context, and Terraform security assertions. `test:localstack` adds DynamoDB/Secrets Manager integration coverage and a local HTTP e2e path that exercises the real Lambda handlers against LocalStack services.

Site upload CLI:

```bash
npm run site:make-input -- --site example --name "Example Co" --industry "Villa rental" --phone "+1 555 0100" --booking-url "https://example.com/book" --whatsapp "+1 555 0100" --pricing "Consultation:Free:Quick scope call|Standard:From $199:Most service visits" --map "Port of Spain, Trinidad"
npm run site:media-manifest -- --site ./sites/example
npm run site:make -- --input ./sites/example/site.input.json --site example --template service
npm run site:make-config -- --input ./sites/example/site.input.json --site example --template real-estate
npm run site:make-seo -- --site ./sites/example
npm run site:audit -- --site ./sites/example
npm run site:add-route -- --site example --template real-estate
npm run site:launch-check -- --site ./sites/example --run-checks
npm run site:upload-templates -- --templates service,real-estate
npm run site:upload-template -- --template-name service
npm run site:validate-config -- --file ./sites/example/site.config.json
npm run site:upload-config -- --file ./sites/example/site.config.json
npm run site:upload-media -- --source ./sites/example/media --config ./sites/example/site.config.json
npm run site:upload-media -- --source ./sites/example/media --config ./sites/example/site.config.json --max-width 1600 --quality 72
npm run site:upload-seo -- --source ./sites/example --config ./sites/example/site.config.json
npm run site -- preview --site ./sites/example --template ./templates/real-estate --port 4173
npm run site:screenshot -- --site ./sites/example --url http://127.0.0.1:4173/ --out ./sites/example/screenshots
npm run site:screenshot-audit -- --site ./sites/example
npm run site:make-outreach -- --site ./sites/example --benefit findability
npm run site:publish -- --site ./sites/example --template real-estate --skip-upload --skip-dns
npm run godaddy:add-cname -- --domain syncpoly.com --name example --value d111111abcdef8.cloudfront.net
```

Google Places lead finder:

```bash
GOOGLE_PLACES_API_KEY=... npm run companies:no-website -- --query "pressure washing in Tampa, FL" --format table
npm run companies:no-website -- --industry "villa rental" --location "Tobago" --format csv --out ./tmp/no-website-leads.csv
```

The lead finder uses Google Places Text Search and filters for businesses where Google does not return a `websiteUri`. It accepts API keys from `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_API_KEY`, or `GOOGLE_API_KEY`; it also loads `.env` by default. The default field mask includes `places.websiteUri`, business name, address, phone, status, type, and Google Maps URL. `websiteUri` is required for filtering, so custom `--field-mask` values must include `places.websiteUri`.

Use `site:make-input`, `site:media-manifest`, and `site:make` to turn lightweight business facts and tenant media into `site.input.json`, `site.config.json`, `robots.txt`, `sitemap.xml`, `llms.txt`, and `llm.txt`. Pass `--template service` or `--template real-estate` so the CLI selects the matching default preset; `--theme` remains available when a site intentionally needs to override that template default. The service template owns the modern layout for hero, gallery, service cards, rates, booking CTAs, WhatsApp click-to-chat, location/Google Maps, contact, and SEO support. AI agents should focus on text, contact details, media paths, services, prices, FAQs, booking links, and service areas instead of writing CSS or SEO files by hand. `site:audit`, `site:add-route`, `site:launch-check`, `site:screenshot-audit`, `site:make-outreach`, and `site:publish` cover the proof gates that agents used to perform manually.

`upload-media` optimizes media before uploading to S3. JPG/PNG/WebP/AVIF files are resized to fit within `1920x1920`, compressed for web delivery, and JPG/PNG/AVIF files also get a generated `.webp` sibling by default. Use `--no-webp` or `SITE_MEDIA_WEBP=0` to disable WebP variants.

Put every tenant-owned image in `sites/<name>/media`, including logos, favicons, OG/social images, hero photos, and gallery images. `upload-folder` rejects image files unless the target prefix is `media`; use `upload-media` for images so compression and WebP generation stay consistent.

Template types are registered in `templates/templates.json`; `real-estate` is the first vendored template folder under `templates/real-estate`. `service` and the legacy `pressure-washer` alias currently point at that same export until they get their own folders. `site:publish` uploads the selected shared template before tenant config/media/SEO unless `--skip-template-upload` or `--skip-upload` is used. The `Deploy Changed Templates` GitHub Actions workflow maps changed `templates/<source-folder>` folders through the registry and uploads only the affected S3 template prefixes.

Use `syncpoly-site preview` and `syncpoly-site screenshot` for QA screenshots. Preview overlays a generated site folder onto the template export and serves it on localhost, so outreach screenshots come from `http://127.0.0.1:<port>/` instead of the public domain.

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
- the template at `/workspace/web-builder/templates/real-estate`

The model defaults are cost-aware: the primary site-building model is `openai/gpt-5.4-mini`, heartbeat work uses `openai/gpt-5.4-nano`, and higher-cost models are not the default.

WhatsApp site-building intake is configured as a one-at-a-time queue. `./bin/start-clawbot.sh` writes these defaults into `.env` and `bin/configure-openclaw.js` applies them to `openclaw-data/config/openclaw.json` at startup:

```text
OPENCLAW_MAX_CONCURRENT=1
OPENCLAW_QUEUE_MODE=followup
OPENCLAW_WHATSAPP_QUEUE_MODE=followup
OPENCLAW_QUEUE_DEBOUNCE_MS=1000
OPENCLAW_QUEUE_CAP=100
OPENCLAW_QUEUE_DROP=summarize
```

OpenClaw's default queue mode is `steer`, which can inject new WhatsApp messages into an active agent run. For Syncpoly website batches, `followup` is intentional: each new WhatsApp message waits until the current build turn finishes, then the site skill processes the next request in order. A single WhatsApp message can still contain several website requests; the skill treats those as an ordered batch and completes one full site workflow, screenshot QA, and outreach step before moving to the next item.

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

The `Deploy Changed Lambdas` workflow deploys only Lambda folders changed in a push to `main`. Terraform still owns initial Lambda creation, Lambda configuration, IAM, API Gateway, DynamoDB, Secrets Manager, and CloudFront resources. If a Lambda does not exist yet, the changed-Lambda workflow skips it and prints a notice to run the Terraform workflow with `action=apply` first.

## Auth API

Terraform creates these auth resources:

- `syncpoly-builder-google-login`: `POST /auth/google`, exchanges a Google OAuth authorization code.
- `syncpoly-builder-auth-authorizer`: API Gateway Lambda authorizer for Syncpoly JWT bearer tokens.
- `syncpoly-builder-auth-me`: `GET /auth/me`, protected by the authorizer.
- `syncpoly-builder-billing-summary`: `GET /billing/summary`, protected by the authorizer.
- `syncpoly-builder-billing-pricing`: `GET /billing/catalog` and protected `POST /billing/checkout`.
- `syncpoly-builder-websites`: protected website ownership, config, SEO, media upload, and deploy request endpoints.
- `syncpoly-builder-stripe-webhook`: `POST /billing/stripe-webhook`, verifies Stripe signatures and records billing/dunning events.
- `syncpoly-builder-users`, `syncpoly-builder-logins`, `syncpoly-builder-websites`, `syncpoly-builder-website-folders`, `syncpoly-builder-website-media`, `syncpoly-builder-billing-catalog`, and `syncpoly-builder-billing-events`: DynamoDB tables for users, login audit records, owned websites, globally unique site folders, media records, pricing/entitlement catalog records, and Stripe billing events.
- `syncpoly-builder-google-oauth`, `syncpoly-builder-jwt-signing-key`, and `syncpoly-builder-stripe`: Secrets Manager secrets.
- A CloudFront distribution in front of the HTTP API.
- A regional AWS WAF on the API Gateway stage with the same managed rules and 2,000 requests per 5 minutes per-IP rate limit as the static-site CloudFront WAF.

Set `auth_allowed_origins` in Terraform for the frontend domains allowed to call the API; it defaults to `https://syncpoly.com`.

After the first Terraform apply, set secret values directly in AWS Secrets Manager:

```json
{
  "client_id": "google-client-id.apps.googleusercontent.com",
  "client_secret": "google-client-secret",
  "redirect_uri": "https://example.com/auth/callback"
}
```

```json
{
  "signing_key": "a-long-random-jwt-signing-key"
}
```

```json
{
  "secret_key": "sk_live_or_test_key",
  "webhook_secret": "whsec_stripe_webhook_signing_secret"
}
```

Call login with:

```bash
curl -X POST "$AUTH_API/auth/google" \
  -H "content-type: application/json" \
  -d '{"code":"GOOGLE_AUTHORIZATION_CODE","redirectUri":"https://example.com/auth/callback"}'
```

Use the returned `accessToken` for protected endpoints:

```bash
curl "$AUTH_API/auth/me" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

Pricing catalog is public and returns seeded plans/add-ons/products with boolean and usage entitlements. Usage entitlements for plan services reset monthly. The default catalog includes Free Website Plan, Basic Website Plan at $39.99/month, Custom Solution Plan, Additional Website at a one-time $29.99, 10MB Media Storage at a one-time $4.99, 5 More Change Requests, and Managed Promotions. Each website plan includes one owned website. Free includes 10MB of media storage; Basic includes 50MB. Yearly subscription prices are calculated with a 20% discount.

```bash
curl "$AUTH_API/billing/catalog"
```

Checkout selection is protected. If the selected paid catalog item does not yet have Stripe product/price IDs, the API creates them and stores the IDs on the catalog record. If the Stripe customer already has a default payment method or any saved payment method, the API creates the subscription directly so Stripe charges the saved card. If the card requires authentication, the response includes `paymentActionRequired: true` with a Stripe PaymentIntent `clientSecret` for the frontend challenge. If there is no saved payment method, it returns a Stripe Checkout Session URL. The endpoint stores checkout responses by idempotency key, so repeated button taps replay the same result instead of creating a second subscription or checkout session.

```bash
curl -X POST "$AUTH_API/billing/checkout" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"itemId":"basic_website_plan","interval":"month","idempotencyKey":"frontend-button-click-id"}'
```

Websites are protected and scoped to the authenticated user. A user can create one included website from their plan entitlement. Website names derive globally unique S3 folder names in `syncpoly-builder-website-folders`. After the included capacity is used, `POST /websites` returns `402` with `catalogItemId: "additional_website_one_time"` until the user buys another website credit. Successful one-time payment grants `additional_website_credits`; creating the next website consumes one credit atomically with the folder claim.

```bash
curl "$AUTH_API/websites" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

```bash
curl -X POST "$AUTH_API/websites" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Customer Website","domain":"example.com"}'
```

Website content endpoints let owners update the selected template, validated site config, SEO files, compressed media, and deployment requests:

```bash
curl -X PUT "$AUTH_API/websites/WEBSITE_ID/template" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"template":"service"}'
```

```bash
curl -X PUT "$AUTH_API/websites/WEBSITE_ID/config" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"config":{...}}'
```

Config updates are validated with the shared site config schema. Entitlement blocks prevent users from disabling ads or the Syncpoly banner when their current plan does not allow it.

```bash
curl -X PUT "$AUTH_API/websites/WEBSITE_ID/seo" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"robotsTxt":"User-agent: *","sitemapXml":"<urlset></urlset>","llmsTxt":"About"}'
```

Media uploads require client-side image compression first. `POST /websites/{websiteId}/media` validates the compressed byte count against the user's `media_storage_mb` entitlement plus any `additional_media_storage_mb`, stores a pending media record, and returns a presigned S3 `PUT` URL.

```bash
curl -X POST "$AUTH_API/websites/WEBSITE_ID/media" \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"fileName":"hero.jpg","contentType":"image/jpeg","compressed":true,"originalBytes":1500000,"compressedBytes":900000}'
```

```bash
curl "$AUTH_API/websites/WEBSITE_ID/media" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

Deployment requests validate config and SEO before marking the website for deployment. The first deployment returns `202` with `approvalRequired: true` and the message that the website needs to be approved within 48 hours. Later deployments return the CDN invalidation paths and GoDaddy CNAME action needed by the deploy worker.

```bash
curl -X POST "$AUTH_API/websites/WEBSITE_ID/deploy" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

Billing summary is also protected. It uses the authenticated user only, auto-creates a Stripe Customer if the user does not have `stripe_customer_id`, stores that id on the user record, and returns sanitized customer, invoice, subscription, payment method, payment status, and dunning data:

```bash
curl "$AUTH_API/billing/summary" \
  -H "authorization: Bearer ACCESS_TOKEN"
```

Configure the Stripe webhook endpoint to:

```text
POST $AUTH_API/billing/stripe-webhook
```

The webhook validates the `Stripe-Signature` header before writing invoice/subscription dunning events.

Terraform intentionally ignores manual changes to CloudFront aliases and viewer certificates, so adding custom domains later in the AWS console will not be removed by the next apply.

CloudFront is configured to serve `/404.html` as a shared global error page for S3 `403` and `404` misses. The function leaves `/404.html` and `/404.css` at the S3 bucket root so the shared page works for every mapped domain.
