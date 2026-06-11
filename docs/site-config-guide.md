# Site Config And Naming Guide

This project serves many sites from one CloudFront distribution and one S3 bucket.

Most page requests use a shared template:

```text
/about
-> s3://syncpoly-web-builder-sites/syncpoly/templates/service/about/index.html
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
    service/
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
    template: "service"
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
service
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
template: service
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

The shared Next static template fetches tenant config from:

```text
/site.config.json
```

The browser URL stays tenant-specific, and CloudFront maps the request to the correct S3 folder.

The template schema lives at:

```text
/workspace/templates/next-static-config-template/content/site.schema.json
```

Keep `site.config.json` as strict JSON: no comments, no trailing commas, UTF-8 encoding, absolute canonical URLs, and tenant image paths that start with `/media/`.

Required top-level fields:

- `site`: identity, canonical URL, locale, description, manifest, PWA, and `llms.txt` notes.
- `seo`: default title/image, robots settings, and site-level JSON-LD.
- `theme`: color tokens, font stacks, radius, max width, background, and optional scoped `customCss`.
- `navigation`: logo text/logo, header links, and optional CTA.
- `pages`: the static route list. Must include `path: "/"`.
- `footer`: tagline, footer links, social links, and copyright.

Common optional fields:

- `deployment`: `basePath` and `assetPrefix`; leave empty for Syncpoly S3/CloudFront root hosting.
- `trial` and `trialBanner`: Syncpoly attribution banner controls.
- `blocks`: reusable sections that pages can insert with `{ "use": "blockName" }`.
- `syncpoly`: local deployment hints such as `folder` and `bucket`.

## Configuring Pages

Every object in `pages` creates one route. Use lowercase kebab-case paths and trailing slashes for readability. The renderer normalizes them.

Page shape:

```json
{
  "path": "/services/",
  "title": "Services",
  "layout": "content",
  "description": "Short fallback description for this page.",
  "seo": {
    "image": "/media/hero-pressure-washing.jpg",
    "title": "Pressure Washing Services",
    "description": "Browse driveway, house, roof, and commercial pressure washing services.",
    "keywords": ["pressure washing", "driveway cleaning"],
    "structuredData": {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": "Pressure washing services"
    }
  },
  "sections": []
}
```

Use page-level `seo.title` without repeating the brand when `seo.titleTemplate` already appends it. Add page-level `seo.structuredData` only when you have truthful, verified page-specific data.

Do not add routes casually. If a page path is not present in the template export, rebuild the template with that route or keep the content as a section on an existing page. Update `navigation.links`, `footer.links`, CTAs, and cards only after the target page or anchor exists.

## Configuring Sections

Sections render in the exact order listed in each page's `sections` array.

Valid section types from the current template schema:

```text
hero, mediaGallery, rates, amenities, location, featureGrid, split, cardGrid, stats, timeline, faq, testimonials, cta, richText, logoCloud, contact
```

Common section fields:

- `id`: required anchor target; use lowercase kebab-case and keep it unique within the page.
- `type`: required renderer type from the list above.
- `kicker`, `title`, `body`: section intro copy.
- `variant`: layout modifier such as `centered`, `split`, `mediaLeft`, or `mediaRight`.
- `className`: scoped CSS hook when `theme.customCss` is truly needed.
- `background`: `{ "type": "solid" | "gradient" | "image", "value": "...", "overlay": "..." }`.
- `media`: one image, video, or embed.
- `mediaItems` and `carousel`: hero/gallery carousel media and behavior.
- `actions`: CTA links rendered as buttons.
- `items`: repeated entries for cards, rates, amenities, stats, timeline, FAQ, testimonials, and logo cloud.
- `methods` and `form`: contact/location details and contact form settings.

Hero sections support background images and optional carousel media:

```json
{
  "id": "hero",
  "type": "hero",
  "variant": "centered",
  "kicker": "Exterior cleaning",
  "title": "Eco-conscious pressure washing that restores curb appeal.",
  "body": "Driveways, patios, siding, decks, and storefronts.",
  "background": {
    "type": "image",
    "value": "/media/hero-pressure-washing.jpg",
    "overlay": "linear-gradient(90deg, rgba(7, 38, 48, 0.78), rgba(7, 38, 48, 0.28))"
  },
  "actions": [
    { "label": "Request a quote", "href": "tel:+15550100", "style": "primary" },
    { "label": "View services", "href": "#services", "style": "secondary" }
  ]
}
```

Use `rates` for packages, service pricing, room rates, or quote ranges. The CLI still accepts `pricing[]` in `site.input.json`, but generated `site.config.json` uses section type `rates`:

```json
{
  "id": "rates",
  "type": "rates",
  "kicker": "Rates",
  "title": "Simple options to start the conversation.",
  "items": [
    {
      "label": "Popular",
      "title": "Driveway Refresh",
      "price": "From $99",
      "body": "A focused clean for driveways and walkways.",
      "amenities": ["Pre-rinse", "Surface clean", "Final rinse"],
      "href": "#contact"
    }
  ]
}
```

Use `location` for Google Maps, service areas, office details, hours, and directions. The CLI still accepts `map` in `site.input.json`, but generated config uses section type `location`:

```json
{
  "id": "location",
  "type": "location",
  "kicker": "Location",
  "title": "Find us or check the service area.",
  "map": {
    "title": "Service area map",
    "query": "Port of Spain, Trinidad",
    "address": "Port of Spain, Trinidad"
  },
  "methods": [
    { "label": "Hours", "value": "Mon - Fri, 8:00am - 5:00pm" }
  ]
}
```

Use reusable `blocks` for shared FAQ/contact/CTA content:

```json
{
  "blocks": {
    "defaultFaq": {
      "id": "faq",
      "type": "faq",
      "title": "Questions",
      "items": [
        { "question": "What areas do you serve?", "answer": "Replace with the verified service area." }
      ]
    }
  },
  "pages": [
    {
      "path": "/",
      "sections": [{ "use": "defaultFaq" }]
    }
  ]
}
```

## SEO And Discovery Files

Set `site.url` to the final production origin before generating SEO files. It drives canonical URLs, sitemap URLs, robots sitemap references, Open Graph URLs, JSON-LD URLs, and `llms.txt` links.

Global SEO shape:

```json
{
  "seo": {
    "titleTemplate": "%s | Aurum Eco Power Wash",
    "defaultTitle": "Aurum Eco Power Wash | Exterior Cleaning",
    "defaultImage": "/media/hero-pressure-washing.jpg",
    "robots": {
      "index": true,
      "follow": true,
      "allow": ["/"],
      "disallow": ["/offline/"]
    },
    "structuredData": {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "Aurum Eco Power Wash"
    }
  }
}
```

SEO files belong in the tenant folder, next to `site.config.json`:

```text
sites/<name>/
  site.config.json
  robots.txt
  sitemap.xml
  llms.txt
  llm.txt
```

Generate them with:

```bash
npm run site:make -- --input ./sites/<name>/site.input.json --site <name> --template service
```

Refresh only SEO files after editing an existing config:

```bash
npm run site:make-seo -- --site ./sites/<name>
```

Upload them separately from config and media:

```bash
npm run site:upload-seo -- --source ./sites/<name> --config ./sites/<name>/site.config.json
```

`upload-seo` includes `robots.txt`, `robot.txt`, `sitemap.xml`, `llms.txt`, and `llm.txt` when present. Keep `llms.txt` factual and short: describe the business, canonical URL, important pages, and any notes useful to AI/search systems. Do not invent locations, reviews, ratings, licenses, guarantees, or prices for structured data or SEO copy.

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
    site.input.json
    site.config.json
    robots.txt
    sitemap.xml
    llms.txt
    llm.txt
    media/
      logo.png
      favicon.svg
      og-default.jpg
```

Generate input, config, and SEO files from lightweight content:

```bash
npm run site:media-manifest -- --site ./sites/aurum-eco-power-wash --text
npm run site:make-input -- \
  --site aurum-eco-power-wash \
  --name "Aurum Eco Power Wash" \
  --industry "Exterior cleaning" \
  --phone "+1 555 0100" \
  --booking-url "https://example.com/book" \
  --whatsapp "+1 555 0100" \
  --pricing "Driveway Refresh:From $99:Driveways and walkways|Full Exterior:From $249:Siding, patios, and entry areas" \
  --map "Port of Spain, Trinidad" \
  --media-source ./sites/aurum-eco-power-wash/media
npm run site:make -- \
  --input ./sites/aurum-eco-power-wash/site.input.json \
  --site aurum-eco-power-wash \
  --template service
npm run site:audit -- --site ./sites/aurum-eco-power-wash
```

The CLI selects a default theme preset from the target template: `--template service` uses the modern service preset, while `--template real-estate` uses the property-focused real-estate preset. Pass `--theme` only when intentionally overriding that template default. The service template owns the polished gallery, rates, booking button, WhatsApp click-to-chat, location/Google Maps, and contact layouts. The AI should usually edit only `site.input.json`; the CLI owns section structure, `theme.colors`, `theme.fonts`, `theme.customCss`, `robots.txt`, `sitemap.xml`, `llms.txt`, and `llm.txt`.

Minimal `site.input.json`:

```json
{
  "site": {
    "name": "Aurum Eco Power Wash",
    "description": "Professional exterior cleaning and pressure washing."
  },
  "business": {
    "industry": "Exterior cleaning"
  },
  "contact": {
    "phone": "+1 555 0100",
    "whatsapp": "+1 555 0100"
  },
  "booking": {
    "label": "Book now",
    "href": "https://example.com/book"
  },
  "media": {
    "hero": "/media/hero-pressure-washing.jpg",
    "logo": "/media/logo.png",
    "favicon": "/media/favicon.svg",
    "gallery": [
      {
        "src": "/media/hero-pressure-washing.jpg",
        "alt": "Freshly cleaned driveway"
      }
    ]
  },
  "copy": {
    "headline": "Eco-conscious pressure washing that restores curb appeal.",
    "subheadline": "Driveways, patios, siding, decks, and storefronts."
  },
  "services": [
    {
      "title": "Driveway Cleaning",
      "body": "Remove stains, buildup, and weathering from concrete and pavers."
    }
  ],
  "pricing": [
    {
      "title": "Driveway Refresh",
      "price": "From $99",
      "body": "A focused clean for driveways and walkways.",
      "features": ["Pre-rinse", "Surface clean", "Final rinse"]
    }
  ],
  "map": {
    "query": "Port of Spain, Trinidad",
    "label": "Open in Google Maps"
  }
}
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

If `site.config.json` already exists and only SEO files need to be refreshed, run:

```bash
npm run site:make-seo -- --site ./sites/aurum-eco-power-wash
```

Add the CloudFront route and run local proof checks:

```bash
npm run site:add-route -- --site aurum-eco-power-wash --template service
npm run site:launch-check -- --site ./sites/aurum-eco-power-wash --run-checks
```

Capture localhost QA screenshots after starting preview:

```bash
npm run site:screenshot -- \
  --site ./sites/aurum-eco-power-wash \
  --url http://127.0.0.1:4173/ \
  --out ./sites/aurum-eco-power-wash/screenshots
npm run site:screenshot-audit -- --site ./sites/aurum-eco-power-wash
```

This writes `desktop.png` and `mobile.png` using Playwright when available, with an `npx playwright screenshot` fallback.

Generate outreach text from the same site input:

```bash
npm run site:make-outreach -- --site ./sites/aurum-eco-power-wash --benefit services
```

For a supervised end-to-end gate, run:

```bash
npm run site:publish -- --site ./sites/aurum-eco-power-wash --template service
```

Use `--skip-upload` or `--skip-dns` only when the current environment cannot perform those steps.

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

## Uploading The Shared Template

The Next static config template is vendored in this repo under `templates/next-static-config-template`.

Template types are registered in `templates/templates.json`. The current `service`, `real-estate`, and `pressure-washer` template types share the same export but upload to separate S3 prefixes under `syncpoly/templates/<template-type>/`.

Build or refresh the template export, then upload the registered template types with the CLI:

```bash
cd /workspace/web-builder/templates/next-static-config-template
npm run build
cd /workspace/web-builder
syncpoly-site upload-templates --templates service,real-estate
```

The successful proof strings are:

```text
Template uploaded: syncpoly/templates/service/ (... file(s))
Template uploaded: syncpoly/templates/real-estate/ (... file(s))
```

The template upload includes its static shell files, route pages such as `/amenities/index.html`, and generated static discovery files in `out/`. Tenant-specific `site.config.json`, media, `robots.txt`, `sitemap.xml`, `llms.txt`, and `llm.txt` are still uploaded per site with `upload-config`, `upload-media`, and `upload-seo`. `syncpoly-site publish` uploads the selected shared template before tenant files unless `--skip-template-upload` or `--skip-upload` is used.

## Adding A New Site

1. Choose the domain, folder, and template names.
2. Create the S3 tenant folder.
3. Add `site.config.json`.
4. Upload `media/`, `robots.txt`, `sitemap.xml`, `llms.txt`, and `llm.txt`.
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
