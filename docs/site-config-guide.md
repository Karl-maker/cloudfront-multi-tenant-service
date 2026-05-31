# Site Config And Naming Guide

This project serves many sites from one CloudFront distribution and one S3 bucket.

Most page requests use a shared template:

```text
/about
-> s3://syncpoly-web-builder-sites/syncpoly/templates/pressure-washer/about/index.html
```

Tenant-owned files use the mapped site folder:

```text
/site.config.json
-> s3://syncpoly-web-builder-sites/aurum-eco-power-wash/site.config.json
```

## S3 Layout

Use this structure inside `syncpoly-web-builder-sites`:

```text
syncpoly/
  templates/
    pressure-washer/
      index.html
      about/
        index.html
      assets/
        app.css
        app.js

aurum-eco-power-wash/
  site.config.json
  llm.txt
  llms.txt
  robots.txt
  sitemap.xml
  media/
    logo.png
    favicon.svg
    og-default.jpg
    hero-pressure-washing.jpg
    driveway-before-after.jpg
```

## Host Map

Add each public hostname in `cloudfront/domain-folder-router.js`:

```js
var sitesByHost = {
  "aurum-eco-power-wash.syncpoly.com": {
    folder: "aurum-eco-power-wash",
    template: "pressure-washer"
  }
};
```

Each host entry has:

- `folder`: the tenant-owned folder in S3.
- `template`: the shared template under `syncpoly/templates`.

## Naming Conventions

Use lowercase `kebab-case` everywhere:

```text
aurum-eco-power-wash
pressure-washer
hero-pressure-washing.jpg
driveway-before-after.jpg
```

Avoid:

- spaces
- uppercase letters
- underscores
- special punctuation
- leading or trailing slashes in `folder` and `template`

Recommended pattern:

```text
domain: aurum-eco-power-wash.syncpoly.com
folder: aurum-eco-power-wash
template: pressure-washer
```

## Tenant-Owned Routes

These routes map to the tenant folder:

```text
/site.config.json       -> /<folder>/site.config.json
/public/site.config.json -> /<folder>/site.config.json
/llm.txt                -> /<folder>/llm.txt
/llms.txt               -> /<folder>/llms.txt
/sitemap.xml            -> /<folder>/sitemap.xml
/robot.txt              -> /<folder>/robot.txt
/robots.txt             -> /<folder>/robots.txt
/media/*                -> /<folder>/media/*
/public/media/*         -> /<folder>/media/*
/favicon.ico            -> /<folder>/media/favicon.ico
/favicon.png            -> /<folder>/media/favicon.png
/favicon.svg            -> /<folder>/media/favicon.svg
/public/favicon.ico     -> /<folder>/media/favicon.ico
/public/favicon.png     -> /<folder>/media/favicon.png
/public/favicon.svg     -> /<folder>/media/favicon.svg
```

All other paths map to the shared template:

```text
/<path>
-> /syncpoly/templates/<template>/<path>
```

## Site Config Contract

The shared template should fetch config from:

```text
/site.config.json
```

The browser URL stays tenant-specific, and CloudFront maps the request to the correct S3 folder.

Keep `site.config.json` as valid JSON:

- no comments
- no trailing commas
- UTF-8 encoding
- tenant image paths should start with `/media/`

Example:

```json
{
  "site": {
    "name": "Aurum Eco Power Wash",
    "slug": "aurum-eco-power-wash",
    "template": "pressure-washer",
    "domain": "aurum-eco-power-wash.syncpoly.com"
  },
  "brand": {
    "logo": "/media/logo.png",
    "primaryColor": "#0f766e",
    "accentColor": "#f5b942"
  },
  "seo": {
    "title": "Aurum Eco Power Wash",
    "description": "Professional exterior cleaning and pressure washing.",
    "image": "/media/hero-pressure-washing.jpg"
  },
  "contact": {
    "phone": "+1 555 0100",
    "email": "hello@example.com",
    "serviceArea": "Local service area"
  },
  "hero": {
    "headline": "Eco-conscious pressure washing that restores curb appeal.",
    "subheadline": "Driveways, patios, siding, decks, and storefronts.",
    "image": "/media/hero-pressure-washing.jpg",
    "ctaLabel": "Request a quote",
    "ctaHref": "tel:+15550100"
  },
  "services": [
    {
      "name": "Driveway Cleaning",
      "description": "Remove stains, buildup, and weathering from concrete and pavers."
    },
    {
      "name": "House Washing",
      "description": "Soft-wash exterior siding, trim, and entry areas."
    }
  ]
}
```

## Uploading A Site

The repo includes a CLI for tenant uploads. It uses AWS credentials from your environment and targets:

```text
CONTENT_BUCKET or S3_BUCKET: S3 bucket name
SITE_FOLDER: tenant folder override
SITE_CONFIG: path to site.config.json
AWS_REGION: optional AWS region
DRY_RUN=1: print aws commands without uploading
```

The config can also carry upload targeting hints:

```json
{
  "syncpoly": {
    "bucket": "syncpoly-web-builder-sites",
    "folder": "aurum-eco-power-wash"
  }
}
```

CLI args and env vars override these config attributes.

Expected local folder:

```text
sites/
  aurum-eco-power-wash/
    site.config.json
    robots.txt
    sitemap.xml
    media/
      logo.png
      favicon.svg
      og-default.jpg
```

Validate and upload config:

```bash
CONTENT_BUCKET=syncpoly-web-builder-sites \
npm run site:upload-config -- --file ./sites/aurum-eco-power-wash/site.config.json
```

If `SITE_FOLDER` is not set, the CLI derives the folder from `site.url`, for example:

```json
{
  "site": {
    "url": "https://aurum-eco-power-wash.syncpoly.com"
  }
}
```

derives:

```text
aurum-eco-power-wash
```

Compress and upload tenant media:

```bash
CONTENT_BUCKET=syncpoly-web-builder-sites \
SITE_CONFIG=./sites/aurum-eco-power-wash/site.config.json \
npm run site:upload-media -- --source ./sites/aurum-eco-power-wash/media
```

SVG files are minified. PNG/JPG/WebP/AVIF files are resized to fit within `1920x1920`, stripped of metadata, and recompressed when `sharp` is installed. JPG/PNG/AVIF files also generate same-path `.webp` variants by default, for example `gallery/truck.jpg` uploads with `gallery/truck.webp`. Use `--max-width`, `--max-height`, `--quality`, or `--no-webp` to tune the output.

Upload SEO files:

```bash
CONTENT_BUCKET=syncpoly-web-builder-sites \
SITE_CONFIG=./sites/aurum-eco-power-wash/site.config.json \
npm run site:upload-seo -- --source ./sites/aurum-eco-power-wash
```

SEO upload includes:

```text
llm.txt
llms.txt
sitemap.xml
robot.txt
robots.txt
```

After changing config or media, invalidate the public paths:

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/site.config.json" "/media/*" "/sitemap.xml" "/robots.txt"
```

Use versioned filenames for long-lived media when possible:

```text
/media/logo-v2.png
/media/hero-pressure-washing-v3.jpg
```

## Adding A New Site

1. Choose the domain, folder, and template names.
2. Create the S3 tenant folder.
3. Add `site.config.json`.
4. Upload `media/`, `robots.txt`, `sitemap.xml`, and `llms.txt`.
5. Add the host mapping in `cloudfront/domain-folder-router.js`.
6. Run:

```bash
npm run build
npm test
```

7. Apply Terraform so the CloudFront Function is updated.
8. Add the custom domain alias and certificate manually in CloudFront if needed.

## Adding A GoDaddy CNAME

If the domain uses GoDaddy DNS, add the CNAME with:

```bash
GODADDY_API_KEY=... \
GODADDY_API_SECRET=... \
npm run godaddy:add-cname -- \
  --domain syncpoly.com \
  --name aurum-eco-power-wash \
  --value d1mp8fjhswh27j.cloudfront.net
```

That creates:

```text
aurum-eco-power-wash.syncpoly.com CNAME d1mp8fjhswh27j.cloudfront.net
```

Dry run:

```bash
DRY_RUN=1 npm run godaddy:add-cname -- \
  --domain syncpoly.com \
  --name aurum-eco-power-wash \
  --value d1mp8fjhswh27j.cloudfront.net
```
