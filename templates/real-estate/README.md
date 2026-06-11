# Next Static Config Template

A reusable Next.js App Router template for building many static websites from one editable JSON file. It is configured for `next build` static export, so production output is the `out/` folder and can be hosted on S3, CloudFront, GitHub Pages, Netlify static hosting, or any plain file server.

## Why This Setup

Current Next.js static export guidance uses `output: "export"` in `next.config.mjs`. `next build` then emits HTML, CSS, JS, and generated route files into `out/`. This template keeps every route build-time renderable and avoids server-only features such as request-time route handlers, redirects, rewrites, cookies, server actions, and the default Next image optimizer.

Research references:

- Next.js static export: https://nextjs.org/docs/app/guides/static-exports
- Next.js Metadata API: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- Next.js manifest route: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
- Next.js robots route: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
- Next.js sitemap route: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Next.js image behavior for static export: https://nextjs.org/docs/app/api-reference/components/image
- `llms.txt` proposal: https://llmstxt.org/

## Quick Start

```bash
npm install
npm run dev
```

Build and preview the S3-ready output:

```bash
npm run check
npm run preview
```

The production files are written to `out/`.

## Runtime Config

The template intentionally ships with no active `site.config.json`. `next build` emits an embedded placeholder shell, and the browser looks for `/site.config.json` at runtime.

On S3, upload a project-specific `site.config.json` next to `index.html` in the bucket root. The live site fetches that file to render visible copy, sections, colors, images, contact details, navigation, footer links, social links, and trial banner settings. Replacing only that JSON file updates the website content without rebuilding the Next.js template.

Social preview crawlers such as WhatsApp, iMessage, Slack, and Facebook read the initial static HTML and usually do not run the browser-side runtime config fetch. To make link previews site-specific, build the static export with the project config available at build time:

```bash
SITE_CONFIG=/path/to/site.config.json npm run build
```

`BUILD_SITE_CONFIG` is also supported. The exported HTML then contains that site's `<title>`, description, Open Graph, Twitter card, canonical URL, icons, manifest link, JSON-LD, and page routes. Deploy those generated HTML files as the HTML served for that site, not as a shared template for multiple unrelated sites.

In the SyncPoly repo, the deployment workflow does this automatically for configs under `sites/<folder>/site.config.json`: it builds this template with the config, uploads the generated HTML under `/<folder>/_site/`, and CloudFront serves that HTML for page requests. Social platforms then see config-specific preview tags before any browser JavaScript runs.

S3 cannot dynamically compute files like `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, or `llms.txt` from JSON at request time. The build therefore emits generic shell versions. To make those discovery files match a project config, run this after `npm run build`:

```bash
npm run runtime:prepare -- /path/to/site.config.json out
```

That command copies the external runtime config into `out/site.config.json` and regenerates `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, `llms.txt`, and `llm.txt` from it before upload.

If you add brand-new page paths, rebuild with those paths included in the shell route list or configure S3/CloudFront to fall back unknown routes to `index.html` like a single-page app.

## Main File To Edit

Create a project-specific `site.config.json` outside the template, then upload it to S3 or pass it to `npm run runtime:prepare`. The schema lives at `content/site.schema.json`, so editors with JSON Schema support can autocomplete and flag basic mistakes.

For detailed authoring rules, naming conventions, section examples, and launch checks, see `docs/site-config-guide.md`.

The preset examples include a modern pressure washing-style local service structure with homepage sections, dedicated service pages, nested service-detail pages, results, FAQ, service area, about, contact, policy pages, logo placeholder, and image placeholders.

Top-level fields:

- `deployment`: optional `basePath` and `assetPrefix` for subdirectory or CDN asset hosting. Leave both empty for a normal S3 bucket at the domain root.
- `trial`: boolean that shows or hides the top trial attribution banner.
- `trialBanner`: optional text, image, destination URL, and button label for the trial banner.
- `site`: global identity, canonical URL, locale, description, author, manifest values, and `llms.txt` guidance.
- `seo`: default title/image, robots settings, and site-level JSON-LD.
- `theme`: colors, fonts, radius, max width, background, and optional `customCss`.
- `navigation`: logo text, header links, and optional header CTA.
- `blocks`: reusable default sections such as FAQ, contact, and CTA. Pages can insert them with `{ "use": "defaultFaq" }`.
- `pages`: the route list. Every page gets statically generated.
- `footer`: footer tagline, internal/static footer links, optional social links, and copyright.

## Default Policy Pages

The default config includes separate placeholder legal pages:

- `/privacy/`
- `/terms/`
- `/cookies/`

They are written for the template as shipped: static pages, optional contact form, social links, PWA service-worker caching, hosting/CDN logs, and no analytics, ads, accounts, payments, or non-essential cookies by default.

Before launch, replace these placeholders with reviewed policies for the actual project. Update them if you add analytics, advertising pixels, embedded media, payments, newsletters, CRM tools, chat widgets, user accounts, or any provider that sets cookies or processes visitor data.

Useful references:

- FTC privacy and security guidance: https://www.ftc.gov/business-guidance/privacy-security
- ICO cookie guidance: https://ico.org.uk/for-the-public/online/cookies

## Presets

Complete starter configs live in `content/presets`:

- `saas-product`
- `local-service`
- `portfolio`
- `event-microsite`

List or apply them:

```bash
npm run preset:list
npm run preset:use -- saas-product
npm run validate:presets
```

Applying a preset writes `public/site.config.json` for local preview only. The template does not require or ship that file by default. Update `site.url`, identity, SEO, contact routes, copy, and assets before shipping.

## Pages

Each object in `pages` creates one static page:

```json
{
  "path": "/services/",
  "title": "Services",
  "layout": "content",
  "description": "Short fallback description.",
  "seo": {
    "title": "Services",
    "description": "Search and share description.",
    "image": "/images/og-default.svg",
    "keywords": ["service one", "service two"]
  },
  "sections": []
}
```

Use trailing slashes in config paths for readability. The renderer normalizes them. Nested routes such as `/services/audit/` are supported because the catch-all page exports `generateStaticParams()`.

The pressure washing starter demonstrates this with:

- `/services/`
- `/services/driveway-cleaning/`
- `/services/house-washing/`
- `/services/roof-gutter-care/`
- `/services/commercial-cleaning/`
- `/results/`
- `/faq/`
- `/service-area/`
- `/about/`
- `/contact/`
- `/privacy/`, `/terms/`, and `/cookies/`

To add more pages, copy an object in `pages`, give it a unique `path`, fill in `title`, `description`, `seo`, and `sections`, then link to it from `navigation.links`, `footer.links`, a section action, or a card `href`.

## Sections

Sections are rendered in the order listed on each page. Included section types:

Every section type below is optional. A page can use any combination, and the template will only render the sections present in that page's `sections` array. Testimonials, FAQ, contact, rates, amenities, location, galleries, and CTAs can all be removed without changing code.

- `hero`: large intro with optional badges, actions, stats, and media.
- `mediaGallery`: configurable image carousel using `mediaItems` and optional `carousel` settings.
- `rates`: pricing, packages, booking tiers, or service plans.
- `amenities`: feature and amenity grid for properties, venues, services, or neighborhoods.
- `location`: Google Maps embed, address, hours, and location-specific CTAs.
- `featureGrid`: repeated feature cards.
- `split`: two-column copy plus media or bullets.
- `cardGrid`: general card list.
- `stats`: metric strip.
- `timeline`: process steps.
- `faq`: accessible disclosure list.
- Nested FAQ items are supported with `children`.
- `testimonials`: review cards with configurable star ratings and customer bylines.
- `cta`: conversion band.
- `richText`: simple editorial paragraphs.
- `logoCloud`: compact label list.
- `contact`: contact methods plus optional configurable form fields and a `mailto:`, same-origin, or third-party form action.

For detailed examples of every major structure, including hero layouts, video media, nested FAQ, maps, rates, amenities, and page-level SEO JSON-LD, see [`docs/section-structure-guide.md`](docs/section-structure-guide.md).

Common section fields:

- `id`: used for anchors, for example `#content-model`.
- `type`: one of the section types above.
- `kicker`, `title`, `body`: section intro copy.
- `variant`: layout modifier, such as `centered`, `mediaLeft`, or `mediaRight`.
- `className`: custom class hook for `theme.customCss` or `globals.css`.
- `background`: `{ "type": "solid" | "gradient" | "image", "value": "..." }`.
- `actions`: links rendered as buttons.
- `items`: repeated content for grids, timeline, FAQ, logo cloud, and stats.

Reusable block fields:

```json
{
  "blocks": {
    "defaultFaq": {
      "id": "faq",
      "type": "faq",
      "title": "Questions",
      "items": []
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

Any field on the reference overrides the block. For example, `{ "use": "defaultFaq", "title": "Buying questions" }`.

## Navigation Rules

Header links and the header CTA are filtered at render time. Internal links only appear when they point to:

- a configured page in `pages`
- an anchor on a configured page, such as `/#faq`
- generated static files such as `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/llms.txt`, or `/llm.txt`

This means you can remove `/contact/` or `/about/` from `pages` without leaving broken header navigation behind.

On mobile, the header collapses these links behind an accessible menu button. The menu expands only when the visitor taps it, then closes after a navigation link is selected.

## Footer Social Links

Social media icons render only when `footer.socialLinks` exists and contains entries:

```json
{
  "footer": {
    "socialLinks": [
      { "platform": "github", "label": "GitHub", "href": "https://github.com/example" },
      { "platform": "linkedin", "label": "LinkedIn", "href": "https://www.linkedin.com/company/example" },
      { "platform": "x", "label": "X", "href": "https://x.com/example" }
    ]
  }
}
```

Supported icon names include `github`, `linkedin`, `x`, `twitter`, `instagram`, `facebook`, `youtube`, `tiktok`, `discord`, `mastodon`, `threads`, `bluesky`, `email`, and `website`. Unknown platform names fall back to a globe icon.

## Images

Put local assets in `public/images` and reference them as `/images/file-name.ext`. Remote `https://...` image URLs also work. For S3-first sites, local images are usually easier to cache, audit, and version.

The template uses normal static image URLs and sets `images.unoptimized: true` in `next.config.mjs`. If you later want transformed responsive images, use a static-export-compatible external loader such as Cloudinary instead of the default Next image optimizer.

Replace before launch:

- `public/images/aquabright-logo-placeholder.svg`
- `public/images/pressure-washing-hero-placeholder.svg`
- `public/images/driveway-cleaning-placeholder.svg`
- `public/images/house-washing-placeholder.svg`
- `public/images/roof-cleaning-placeholder.svg`
- `public/images/commercial-cleaning-placeholder.svg`
- `public/images/before-after-placeholder.svg`
- `public/images/og-pressure-placeholder.svg`
- `public/images/hero-placeholder.svg`
- `public/images/static-hosting-placeholder.svg`
- `public/images/og-default.svg`
- `public/images/icon.svg`

For social sharing, a PNG or JPG Open Graph image is usually safer than SVG. Update `seo.defaultImage` and page-level `seo.image` after adding it.

## SEO And Discovery Files

Generated from config at build time:

- `/sitemap.xml` from `pages`
- `/robots.txt` from `seo.robots`
- `/manifest.webmanifest` from `site.manifest`
- `/llms.txt` from `site.llms` and `pages`
- `/llm.txt` as a compatibility alias for the singular spelling
- JSON-LD in the layout and each page
- per-page title, description, canonical URL, Open Graph, and Twitter metadata

Set `site.url` to the final production URL before building. Canonical URLs, sitemap entries, robots sitemap references, Open Graph URLs, and `llms.txt` links all depend on it.

## PWA Settings

The template includes a lightweight static PWA setup:

- `/manifest.webmanifest` generated from `site.manifest`
- `public/sw.js` service worker for basic cache and offline fallback behavior
- client-side service worker registration through `site.pwa`
- `/offline/` fallback page in the default config and presets
- Apple web app metadata and `theme-color`

Relevant config:

```json
{
  "site": {
    "manifest": {
      "display": "standalone",
      "backgroundColor": "#f6f0e8",
      "themeColor": "#214e5b",
      "icon": "/images/icon.svg",
      "categories": ["business", "productivity"]
    },
    "pwa": {
      "enabled": true,
      "serviceWorker": "/sw.js",
      "offlinePath": "/offline/",
      "cacheName": "my-site-v1"
    }
  }
}
```

For production-grade app install polish, replace the placeholder SVG icon with proper PNG icon sizes as well.

## Static Hosting On S3

Build:

```bash
npm run check
```

Upload:

```bash
aws s3 sync out/ s3://your-bucket-name --delete
```

Recommended S3 or CloudFront settings:

- Serve `index.html` as the index document.
- Serve `404.html` as the error document.
- Use CloudFront with HTTPS and compression for production.
- Cache hashed `/_next/static/*` assets long-term.
- Cache HTML, `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, and `llms.txt` for shorter periods so content updates propagate.
- Keep `sw.js` on a short cache TTL so PWA cache updates roll out predictably.

## Testing

Unit and browser coverage is included:

```bash
npm run test:unit
npm run test:e2e
npm run check
npm run check:full
```

Jest covers config resolution, reusable default blocks, navigation/footer filtering, and section rendering. Playwright covers desktop/mobile layout, navigation output, multi-page routes, contact defaults, and PWA/discovery files.

## GitHub CI

The workflow at `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It installs dependencies with `npm ci`, installs Playwright Chromium, runs `npm run check`, then runs the Playwright suite.

## Adding Custom CSS

For small project-level overrides, use `theme.customCss`:

```json
{
  "theme": {
    "customCss": ".pricing-emphasis { border-color: var(--color-accent); }"
  }
}
```

Then add `"className": "pricing-emphasis"` to a section.

For structural changes, edit `src/app/globals.css` or add a new section renderer in `src/components/SectionRenderer.tsx`.

## Static Export Rules To Keep

- Do not add request-time API routes.
- Do not use cookies, headers, server actions, redirects, rewrites, or ISR.
- Dynamic routes must stay backed by `generateStaticParams()`.
- Browser-only APIs such as `window` belong in Client Components and must be guarded with effects.
- Forms on S3 need a `mailto:` action, external form endpoint, same-origin serverless endpoint, email link, or client-side service. The default `mailto:estimates@example.com` placeholder opens the visitor's email client; replace it with the real destination or provider before launch.
- Contact form fields are configured in `section.form.fields`. The default pressure washing form asks for name, email, phone, service location, service type, preferred timing, and project details.
