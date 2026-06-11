# Site Config Authoring Guide

This guide explains how to create, edit, name, validate, and ship a website using `site.config.json` in this template.

The short version: almost every client-facing part of the site comes from one JSON file. Keep that file structured, consistently named, and carefully validated, and the template can generate pages, navigation, SEO metadata, sitemap, robots, manifest, `llms.txt`, footer links, forms, and theme styling from the same source of truth.

## Source Of Truth

The active local config is:

```text
public/site.config.json
```

The schema reference is:

```text
content/site.schema.json
```

The TypeScript shape is:

```text
src/types/site.ts
```

The renderer that turns sections into UI is:

```text
src/components/SectionRenderer.tsx
```

When in doubt, treat the schema and TypeScript types as the authority. The examples in this guide are meant to help humans work safely, but the app ultimately follows the code and schema.

## Runtime And Build Behavior

This template supports a static build and a runtime config file.

For local development, `public/site.config.json` is used as the current website config. The app also fetches `/site.config.json` in the browser. While that runtime config is loading, the site shows a skeleton instead of flashing a default page.

For social sharing previews, the config must also be available when the static HTML is built. Crawlers such as WhatsApp read the exported `<head>` tags and usually do not run the runtime fetch. Build with the project config before upload:

```bash
SITE_CONFIG=/path/to/site.config.json npm run build
```

Use `BUILD_SITE_CONFIG` instead of `SITE_CONFIG` if the deployment environment already reserves `SITE_CONFIG` for another step. The generated HTML should be served for that specific site; otherwise a shared template export will keep sharing one site's Open Graph title, description, image, canonical URL, and JSON-LD across every site that uses it.

In the SyncPoly deployment workflow, configs under `sites/<folder>/site.config.json` are built this way automatically and uploaded to `/<folder>/_site/`, which is the HTML CloudFront serves for page requests.

For deployment, run a normal build:

```bash
npm run build
```

If you need to prepare an exported `out/` folder with a specific config and regenerated discovery files, run:

```bash
npm run runtime:prepare -- public/site.config.json out
```

That copies the config into `out/site.config.json` and regenerates:

- `sitemap.xml`
- `robots.txt`
- `manifest.webmanifest`
- `llms.txt`
- `llm.txt`

Always validate the config after edits:

```bash
npm run validate:config -- public/site.config.json
```

For broader verification:

```bash
npm run typecheck
npm run test:unit -- --runInBand
npm run build
```

## JSON Rules

`site.config.json` is strict JSON.

Use:

- Double quotes for every key and string.
- No comments.
- No trailing commas.
- Arrays for ordered lists.
- Objects for named groups.
- Absolute URLs for canonical public domains.
- Root-relative paths for local assets and internal site files.

Avoid:

- JavaScript comments such as `// note`.
- Unquoted keys.
- Smart quotes.
- Empty required fields.
- Duplicate page paths.
- Internal links to pages or anchors that do not exist.

## Top-Level Structure

A complete config has these top-level fields:

```json
{
  "$schema": "../content/site.schema.json",
  "deployment": {},
  "trial": true,
  "trialBanner": {},
  "site": {},
  "seo": {},
  "theme": {},
  "navigation": {},
  "blocks": {},
  "pages": [],
  "footer": {}
}
```

Required by the schema:

- `site`
- `seo`
- `theme`
- `navigation`
- `pages`
- `footer`

Optional but commonly used:

- `deployment`
- `trial`
- `trialBanner`
- `blocks`

## Naming Conventions

Use naming conventions aggressively. They keep configs easy to scan and reduce broken links.

### Client And Brand Names

Use the full legal or public brand name in `site.name`.

Example:

```json
"name": "Aurum Eco Power Wash"
```

Use a shorter label in `site.shortName`.

Example:

```json
"shortName": "Aurum Eco"
```

Use `navigation.logoText` as fallback text for the header if no logo exists. When a logo is configured, the header displays the logo image instead of the visible text name.

### Page Paths

Use lowercase kebab-case paths with trailing slashes.

Good:

```text
/
/services/
/services/mobile-car-wash/
/service-area/
/privacy/
```

Avoid:

```text
/Services
/mobile_car_wash
/serviceArea
/services/mobile car wash
```

The code normalizes paths internally, but writing them consistently prevents confusion.

### Section IDs

Use lowercase kebab-case section IDs.

Good:

```json
"id": "hero"
"id": "service-list"
"id": "eco-process"
"id": "estimate-form"
```

Section IDs are used for:

- HTML `id` attributes.
- Anchor links such as `/#services`.
- Link validation.
- Debugging and tests.

Make section IDs unique within a page. Reusing the same section ID on different pages is fine.

### Block Keys

Use lower camel case for reusable block keys.

Good:

```json
"defaultFaq"
"defaultContact"
"homeCta"
"serviceFaq"
```

Use `default` as a prefix when the block is generic and shared across multiple pages.

### Image File Names

Use lowercase kebab-case for local image assets.

Good:

```text
public/images/aurum-car-wash-hero.svg
public/images/aurum-wheel-rinse.svg
public/images/aurum-og.png
```

Reference local assets with root-relative paths:

```json
"src": "/images/aurum-car-wash-hero.svg"
```

Remote images may use full HTTPS URLs:

```json
"src": "https://eco-power-wash.syncpoly.com/media/logo.png"
```

### Form Field Names

Use simple lowercase or lower camel case names.

Good:

```json
"name": "email"
"name": "phone"
"name": "vehicle"
"name": "preferredDate"
```

Avoid spaces and punctuation in form field names.

### CSS Class Hooks

Use `className` sparingly. When needed, use lowercase kebab-case.

Good:

```json
"className": "home-services"
```

Avoid creating config-only styling hooks unless the shared template cannot express the layout.

## Deployment

`deployment` controls paths for hosting under a subdirectory.

Normal domain root hosting:

```json
"deployment": {
  "basePath": "",
  "assetPrefix": ""
}
```

Only use `basePath` when the site is hosted under a subfolder.

Example:

```json
"deployment": {
  "basePath": "/campaign",
  "assetPrefix": ""
}
```

Most client sites should leave both values empty.

## Trial Banner

`trial` controls whether the top SyncPoly attribution banner appears.

```json
"trial": true
```

`trialBanner` controls its text, image, URL, and button label.

```json
"trialBanner": {
  "text": "This site was built with SyncPoly.",
  "href": "https://www.syncpoly.com",
  "image": {
    "src": "https://d1mp8fjhswh27j.cloudfront.net/assets/syncpoly-icon.png",
    "alt": "SyncPoly icon"
  },
  "buttonLabel": "Check us out"
}
```

Use a real `alt` value for meaningful images. If an image is purely decorative in component code, the component may hide it from assistive tech, but the config should still describe the asset honestly.

## Site Identity

The `site` object defines global identity.

Important fields:

- `name`: Full site or company name.
- `shortName`: Short brand name used by manifest and compact contexts.
- `url`: Final canonical production URL.
- `locale`: Locale string, usually `en_US`.
- `description`: Global fallback description.
- `updatedAt`: Last meaningful content update date.
- `keywords`: Search phrases associated with the business.
- `author`: Site owner metadata.
- `social.sameAs`: Official profile URLs.
- `manifest`: PWA metadata.
- `pwa`: Service worker and offline settings.
- `llms`: Summary and machine-readable notes for `llms.txt`.

Example:

```json
"site": {
  "name": "Aurum Eco Power Wash",
  "shortName": "Aurum Eco",
  "url": "https://aurum-eco-power-wash.syncpoly.com",
  "locale": "en_US",
  "description": "Premium eco-minded mobile power washing for cars, SUVs, trucks, wheels, and small fleets.",
  "updatedAt": "2026-05-29"
}
```

### Canonical URL

Set `site.url` to the final production domain before launch.

This value affects:

- Canonical URLs.
- Sitemap URLs.
- Robots sitemap reference.
- Open Graph URLs.
- `llms.txt` links.
- Structured data.

Use the full origin with protocol:

```json
"url": "https://aurum-eco-power-wash.syncpoly.com"
```

Do not include a trailing slash in `site.url`.

## SEO

The `seo` object provides global defaults.

```json
"seo": {
  "titleTemplate": "%s | Aurum Eco Power Wash",
  "defaultTitle": "Aurum Eco Power Wash | Eco Car Power Washing",
  "defaultImage": "/images/aurum-og.svg",
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
```

### Title Rules

Use page-level `seo.title` without the brand suffix when `titleTemplate` already adds it.

Good:

```json
"title": "Car Wash Services"
```

Avoid:

```json
"title": "Car Wash Services | Aurum Eco Power Wash"
```

### Description Rules

Descriptions should be plain text, usually 140 to 160 characters for search snippets, but clarity matters more than exact length.

Good descriptions:

- State what the page offers.
- Include the service and brand naturally.
- Avoid vague slogans.
- Avoid keyword stuffing.

### Robots Rules

`seo.robots.disallow` affects discovery files. Disallowed pages are filtered out of generated `sitemap.xml` and `llms.txt`.

Example:

```json
"robots": {
  "allow": ["/"],
  "disallow": ["/offline/"]
}
```

Keep utility pages such as `/offline/` disallowed unless there is a specific reason to index them.

### Structured Data

Use schema.org JSON-LD. Keep it truthful.

For local businesses, common fields include:

- `@context`
- `@type`
- `name`
- `url`
- `image`
- `description`
- `areaServed`
- `sameAs`

Do not invent addresses, phone numbers, ratings, prices, opening hours, or service areas if they are not verified.

## Theme

The `theme` object drives the visual system.

```json
"theme": {
  "mode": "dark",
  "colors": {
    "background": "#07080b",
    "surface": "#111419",
    "surfaceAlt": "#171e24",
    "text": "#f7f2e8",
    "muted": "#b5bdc3",
    "primary": "#d8b86a",
    "primaryContrast": "#090b0e",
    "accent": "#54d6bf",
    "accentContrast": "#06110e",
    "border": "#2b343c"
  },
  "fonts": {
    "heading": "Inter, ui-sans-serif, system-ui, sans-serif",
    "body": "Inter, ui-sans-serif, system-ui, sans-serif"
  },
  "radius": "16px",
  "maxWidth": "1220px",
  "background": {
    "type": "gradient",
    "value": "linear-gradient(135deg, #07080b 0%, #0d1117 48%, #0d1b1a 100%)"
  },
  "customCss": ""
}
```

### Required Color Tokens

Use these keys consistently:

- `background`: Page background.
- `surface`: Forms, footer, subtle panels.
- `surfaceAlt`: Hover states and skeleton blocks.
- `text`: Main readable text.
- `muted`: Body copy and secondary labels.
- `primary`: Main CTA color.
- `primaryContrast`: Text color on primary.
- `accent`: Secondary accent.
- `accentContrast`: Text color on accent.
- `border`: Divider and border color.

The template uses these tokens across components. If one is too low contrast, multiple sections may become hard to read.

### Dark Theme Contrast

For dark sites:

- Keep `text` very light.
- Keep `muted` readable, not too dim.
- Keep `primaryContrast` dark if `primary` is light.
- Keep `accentContrast` dark if `accent` is light.
- Avoid using saturated accent colors as large backgrounds.

### Radius

Use `radius` to control the feel of buttons, forms, images, and panels.

Guidance:

- `6px` to `8px`: utilitarian and sharp.
- `12px` to `18px`: modern and polished.
- `24px+`: softer, more lifestyle-oriented.

### Custom CSS

Prefer config fields and shared template CSS before using `theme.customCss`.

Use `customCss` only for client-specific exceptions. Keep selectors scoped to a `className` that you place on a section.

Example:

```json
{
  "id": "special-offer",
  "type": "cta",
  "className": "special-offer"
}
```

Then:

```json
"customCss": ".special-offer .cta-band { border: 1px solid var(--color-border); }"
```

Do not paste large CSS systems into `customCss`. If many sites need the same behavior, update the template CSS instead.

## Navigation

`navigation` controls the header.

```json
"navigation": {
  "logoText": "Aurum Eco",
  "logo": {
    "src": "https://eco-power-wash.syncpoly.com/media/logo.png",
    "alt": "Aurum Eco Power Wash logo"
  },
  "links": [
    { "label": "Home", "href": "/" },
    { "label": "Services", "href": "/services/" },
    { "label": "Results", "href": "/results/" },
    { "label": "About", "href": "/about/" },
    { "label": "FAQ", "href": "/faq/" },
    { "label": "Contact", "href": "/contact/" }
  ],
  "cta": {
    "label": "Get a Quote",
    "href": "/contact/",
    "style": "primary"
  }
}
```

### Header Logo Behavior

If `navigation.logo` exists, the header displays the logo image and hides the visible text name. The brand link still has an accessible label based on `site.name`.

If `navigation.logo` is missing, the header falls back to:

- A generated mark.
- The visible `navigation.logoText`.

### Header Link Filtering

Header links and the CTA are filtered at render time.

Internal links only render when they point to:

- A configured page in `pages`.
- A valid section anchor on a configured page.
- A generated static file such as `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/llms.txt`, `/llm.txt`, or `/icon.svg`.

This prevents broken navigation if a page is removed from the config.

### Navigation Labels

Keep labels short:

- Home
- Services
- Results
- About
- FAQ
- Contact

Avoid:

- Long phrases.
- Repeating the brand name.
- Labels that wrap on mobile.

## Blocks

`blocks` are reusable sections. They let many pages share one FAQ, contact form, or CTA.

Example:

```json
"blocks": {
  "defaultFaq": {
    "id": "faq",
    "type": "faq",
    "kicker": "FAQ",
    "title": "Before you book",
    "items": [
      {
        "question": "Is power washing safe for car paint?",
        "answer": "Aurum positions vehicle care around controlled pressure, careful distance, and surface-aware products."
      }
    ]
  }
}
```

Use a block on a page:

```json
{
  "use": "defaultFaq"
}
```

Override a block field on one page:

```json
{
  "use": "defaultFaq",
  "title": "Service questions"
}
```

If a block reference points to a missing block name, validation fails.

## Pages

Every object in `pages` creates one route.

Required fields:

- `path`
- `title`
- `description`
- `sections`

Recommended fields:

- `layout`
- `seo`

Example:

```json
{
  "path": "/services/",
  "title": "Services",
  "layout": "content",
  "description": "Car, wheel, fleet, and detailing prep services from Aurum Eco Power Wash.",
  "seo": {
    "title": "Car Wash Services",
    "description": "Browse eco-minded car power washing services for exterior washes, wheels, tires, fleets, and detailing prep.",
    "image": "/images/aurum-og.svg"
  },
  "sections": []
}
```

### Page Order

Keep page order logical:

1. Home.
2. Main service index.
3. Service detail pages.
4. Results or work examples.
5. FAQ.
6. Service area.
7. About.
8. Contact.
9. Policy pages.
10. Offline fallback.

This order affects how humans read the config. It may also affect generated discovery output order.

### Home Page

Always include:

```json
"path": "/"
```

Validation requires a home page.

### Policy Pages

Recommended policy pages:

- `/privacy/`
- `/terms/`
- `/cookies/`

Keep policy language aligned with the actual site behavior. Update it if you add analytics, ads, payment tools, newsletters, chat widgets, embedded media, CRM forms, or tracking pixels.

### Offline Page

The offline page should usually exist if PWA caching is enabled.

Recommended:

```json
"path": "/offline/"
```

Also add it to robots `disallow`.

## Sections

Sections render in the order they appear on a page.

Common fields:

- `id`: Required unique section identifier.
- `type`: Required section type.
- `className`: Optional CSS hook.
- `kicker`: Small label above a title.
- `title`: Main section heading.
- `body`: Supporting copy.
- `variant`: Layout modifier.
- `columns`: Grid column count for grid sections.
- `background`: Section background.
- `media`: Image or remote image.
- `actions`: Button links.
- `badges`: Hero chips.
- `stats`: Hero stat strip.
- `bullets`: Split section checklist.
- `content`: Rich text paragraphs.
- `items`: Repeated entries for grids, FAQs, stats, timelines, testimonials, and logo clouds.
- `methods`: Contact method entries.
- `form`: Contact form settings.

### Hero

Best for the first section on a page.

```json
{
  "id": "hero",
  "type": "hero",
  "variant": "split",
  "kicker": "Premium mobile car wash",
  "title": "A cleaner finish with a lighter footprint.",
  "body": "Aurum Eco Power Wash brings a water-minded exterior clean to cars, SUVs, trucks, wheels, and small fleets.",
  "actions": [
    { "label": "Get a Quote", "href": "/contact/", "style": "primary" },
    { "label": "View Services", "href": "/services/", "style": "secondary" }
  ],
  "stats": [
    { "label": "Focus", "value": "Cars" },
    { "label": "Method", "value": "Eco" }
  ],
  "media": {
    "src": "/images/aurum-car-wash-hero.svg",
    "alt": "A dark car being power washed with gold and aqua spray accents"
  }
}
```

Hero variants:

- `split`: Copy and media side by side.
- `centered`: Copy centered, no side media.

Use `badges` only when chips add real value. For cleaner premium layouts, omit them.

### Feature Grid

Best for services, benefits, or value props.

```json
{
  "id": "services",
  "type": "featureGrid",
  "kicker": "Services",
  "title": "Refined care for every vehicle.",
  "body": "Focused wash packages for daily drivers, weekend cars, work trucks, and small fleets.",
  "columns": 2,
  "items": [
    {
      "title": "Mobile car wash",
      "body": "Exterior foam, controlled rinse, trim awareness, and finish checks for cars and SUVs.",
      "href": "/services/mobile-car-wash/",
      "media": {
        "src": "/images/aurum-car-wash-hero.svg",
        "alt": "Car exterior wash illustration"
      }
    }
  ]
}
```

Use `columns` carefully:

- `2`: Better for large cards with images.
- `3`: Good for concise benefits.
- `4`: Use only when copy is very short.

### Card Grid

Use for general lists. It renders like `featureGrid`, but the class name is different so it can be styled separately.

Good uses:

- Service detail callouts.
- Coverage notes.
- Short value lists.

### Split

Use for copy plus media or bullets.

```json
{
  "id": "eco-process",
  "type": "split",
  "variant": "mediaLeft",
  "kicker": "Aurum Method",
  "title": "Strong finish, controlled process.",
  "body": "The brand lands dark and premium, while the wash process stays measured.",
  "bullets": [
    "Exterior-first packages built for cars and trucks",
    "Wheel, tire, trim, and high-touch areas treated with care"
  ],
  "media": {
    "src": "/images/aurum-detail-rinse.svg",
    "alt": "A close vehicle rinse with dark gold and aqua accents"
  }
}
```

Variants:

- `mediaLeft`: Media appears first on desktop.
- Omit `variant` or use another value for default copy/media order.

### Stats

Use for a metric strip.

```json
{
  "id": "stats",
  "type": "stats",
  "items": [
    { "label": "Vehicles", "value": "Cars" },
    { "label": "Options", "value": "Fleets" }
  ]
}
```

Keep stat values short. Long values wrap poorly.

### Timeline

Use for process steps.

```json
{
  "id": "process",
  "type": "timeline",
  "kicker": "Process",
  "title": "Simple, polished, predictable.",
  "items": [
    {
      "title": "Send the details",
      "body": "Share vehicle type, condition, location, and timing."
    },
    {
      "title": "Match the package",
      "body": "Choose the wash option that fits the vehicle."
    }
  ]
}
```

Use three steps when possible. Four is acceptable. More than four usually needs another layout.

### FAQ

Use for questions and answers.

```json
{
  "id": "faq",
  "type": "faq",
  "kicker": "FAQ",
  "title": "Before you book",
  "items": [
    {
      "question": "Is power washing safe for car paint?",
      "answer": "Aurum positions vehicle care around controlled pressure, careful distance, and surface-aware products."
    }
  ]
}
```

FAQ item fields:

- `question`
- `answer`

Keep answers concise and factual. Do not overpromise.

### Testimonials

Use for reviews or bylined quotes.

```json
{
  "id": "reviews",
  "type": "testimonials",
  "kicker": "Reviews",
  "title": "Reviews that speak clearly.",
  "columns": 3,
  "items": [
    {
      "name": "Customer Name",
      "role": "Vehicle owner",
      "location": "Local area",
      "rating": 5,
      "body": "The vehicle looked clean and professionally finished."
    }
  ]
}
```

Only use real testimonials when approved. Do not invent customer names or ratings for a real business.

### CTA

Use for conversion moments.

```json
{
  "id": "quote",
  "type": "cta",
  "kicker": "Aurum Eco Power Wash",
  "title": "Ready for a cleaner vehicle?",
  "body": "Send the wash details and start with the right package.",
  "actions": [
    { "label": "Get a Quote", "href": "/contact/", "style": "primary" }
  ]
}
```

Keep CTAs short and direct.

### Rich Text

Use for policy pages, explanations, and simple editorial content.

```json
{
  "id": "privacy-content",
  "type": "richText",
  "kicker": "Privacy",
  "title": "Privacy basics",
  "content": [
    "Aurum Eco Power Wash collects only the details needed to respond to wash requests.",
    "Do not submit sensitive payment information through the form."
  ]
}
```

Each `content` entry renders as one paragraph.

### Logo Cloud

Use for short labels. Despite the name, this renderer currently outputs text labels, not image logos.

```json
{
  "id": "partners",
  "type": "logoCloud",
  "title": "Trusted by local drivers",
  "items": [
    { "label": "Cars" },
    { "label": "SUVs" },
    { "label": "Small fleets" }
  ]
}
```

### Contact

Use for contact methods and an optional form.

```json
{
  "id": "estimate-form",
  "type": "contact",
  "kicker": "Request a Quote",
  "title": "Book a refined wash",
  "body": "Share the vehicle details and Aurum Eco Power Wash will help match the right service.",
  "methods": [
    {
      "label": "Service focus",
      "value": "Cars, SUVs, trucks, wheels, and small fleets"
    }
  ],
  "form": {
    "enabled": true,
    "action": "mailto:quotes@aurum-eco-power-wash.syncpoly.com",
    "method": "POST",
    "encType": "text/plain",
    "submitLabel": "Send wash request",
    "fields": [
      {
        "name": "name",
        "label": "Name",
        "type": "text",
        "autoComplete": "name",
        "required": true
      },
      {
        "name": "message",
        "label": "Wash notes",
        "type": "textarea",
        "rows": 5,
        "required": true
      }
    ]
  }
}
```

Supported form field types:

- `text`
- `email`
- `tel`
- `textarea`
- `select`

For `select`, include `options`.

```json
{
  "name": "service",
  "label": "Service needed",
  "type": "select",
  "placeholder": "Choose a service",
  "options": [
    "Mobile car wash",
    "Wheel and tire reset",
    "Small fleet wash"
  ]
}
```

## Links

Link objects use:

```json
{
  "label": "Get a Quote",
  "href": "/contact/"
}
```

Action objects may also include:

```json
"style": "primary"
```

Supported action styles:

- `primary`
- `secondary`
- `text`

### Internal Links

Use root-relative paths:

```json
"/services/"
"/contact/"
"/services/mobile-car-wash/"
```

Anchor links:

```json
"/#services"
"/faq/#faq"
```

Only use anchor links to section IDs that exist.

### External Links

Use full URLs:

```json
"https://www.instagram.com/aurumecopowerwash"
```

External links automatically open with appropriate external-link attributes in the shared link component.

### Email And Phone Links

Use:

```json
"mailto:quotes@example.com"
"tel:+15551234567"
```

## Images And Alt Text

Every configured image requires:

- `src`
- `alt`

Example:

```json
"media": {
  "src": "/images/aurum-detail-rinse.svg",
  "alt": "A close vehicle rinse with gold and aqua spray accents"
}
```

### Alt Text Guidelines

Good alt text:

- Describes what is visually meaningful.
- Stays short.
- Avoids phrases like "image of" or "picture of".
- Does not stuff keywords.

If the logo is in `navigation.logo`, the header uses the logo visually and the brand link uses an accessible label based on `site.name`.

### Image Format Guidelines

Use:

- SVG for simple generated illustrations and logos.
- PNG for logos requiring transparency.
- JPG or WebP for photos.
- PNG or JPG for Open Graph images when possible.

SVG Open Graph images can work, but PNG or JPG is safer across social platforms.

## Backgrounds

Background objects use:

```json
{
  "type": "gradient",
  "value": "linear-gradient(135deg, #07080b 0%, #0d1117 48%, #0d1b1a 100%)"
}
```

Supported background types:

- `solid`
- `gradient`
- `image`

For image backgrounds:

```json
{
  "type": "image",
  "value": "/images/background.jpg",
  "overlay": "linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55))"
}
```

Use overlays to keep text readable.

## Footer

The footer controls tagline, links, social links, and copyright.

```json
"footer": {
  "tagline": "Premium eco-minded car power washing with a refined dark finish.",
  "links": [
    { "label": "Services", "href": "/services/" },
    { "label": "Privacy", "href": "/privacy/" }
  ],
  "socialLinks": [
    {
      "platform": "instagram",
      "label": "Instagram",
      "href": "https://www.instagram.com/aurumecopowerwash"
    }
  ],
  "copyright": "Copyright 2026 Aurum Eco Power Wash."
}
```

Supported social icon platform examples:

- `facebook`
- `instagram`
- `youtube`
- `tiktok`
- `linkedin`
- `x`
- `twitter`
- `github`
- `email`
- `website`

Unknown platform names fall back to a generic website icon.

## Copywriting Conventions

Use a consistent voice across the config.

For professional service sites:

- Keep headlines clear.
- Prefer specific service language over slogans.
- Avoid hype.
- Avoid repeated adjectives.
- Keep body copy short.
- Keep button labels action-oriented.
- Use sentence case for headlines unless the brand requires title case.

Good:

```text
A cleaner finish with a lighter footprint.
```

Less ideal:

```text
THE ULTIMATE CLEANING EXPERIENCE!!!
```

### Button Labels

Good:

- Get a Quote
- View Services
- Request Prep
- Ask About Fleet Washing

Avoid:

- Click Here
- Learn More About Our Amazing Services Today
- Submit

### Kicker Labels

Kickers are short category labels.

Good:

- Services
- Process
- About
- Request a Quote
- Small fleet wash

Avoid long phrases. The visual style treats kickers as compact labels.

## Accessibility Checklist

Before shipping a config, check:

- Every image has useful `alt`.
- Buttons and links have clear labels.
- Header logo has a configured `alt`, even though the header may use an accessible brand label.
- Contact fields have clear `label` values.
- Form fields that must be filled have `required: true`.
- Text has enough contrast with the theme colors.
- Section backgrounds do not hide text.
- Link text makes sense out of context.
- FAQ questions are written as real questions.

## SEO And Discovery Checklist

Before launch, check:

- `site.url` is the final production URL.
- `site.name` and `site.shortName` are correct.
- `site.description` is accurate.
- `seo.defaultTitle` is accurate.
- `seo.defaultImage` points to a real asset.
- Every page has a useful `seo.title`.
- Every page has a useful `seo.description`.
- `seo.robots.disallow` includes utility pages such as `/offline/`.
- `site.updatedAt` reflects the latest meaningful content update.
- `site.social.sameAs` contains only real official profiles.
- Structured data does not include unverified claims.
- `llms.summary` and `llms.notes` are factual.

## Adding A New Service Page

1. Add a new page object in `pages`.
2. Use a lowercase kebab-case path.
3. Add SEO metadata.
4. Add a hero section.
5. Add one or two content sections.
6. Add a CTA or contact block.
7. Link to it from the service grid.
8. Validate the config.
9. Run a build.

Example page:

```json
{
  "path": "/services/interior-wipe-down/",
  "title": "Interior Wipe-Down",
  "layout": "content",
  "description": "Interior wipe-down add-on for Aurum Eco Power Wash customers.",
  "seo": {
    "title": "Interior Wipe-Down",
    "description": "Add an interior wipe-down to an Aurum Eco Power Wash exterior service.",
    "image": "/images/aurum-og.svg"
  },
  "sections": [
    {
      "id": "interior-hero",
      "type": "hero",
      "variant": "split",
      "kicker": "Interior add-on",
      "title": "A cleaner cabin touchpoint.",
      "body": "A light interior wipe-down add-on for common touch surfaces after the exterior wash.",
      "actions": [
        { "label": "Request This Add-On", "href": "/contact/", "style": "primary" }
      ],
      "media": {
        "src": "/images/aurum-detail-rinse.svg",
        "alt": "Vehicle detail service illustration"
      }
    },
    {
      "use": "defaultContact"
    }
  ]
}
```

Then add a service card:

```json
{
  "title": "Interior wipe-down",
  "body": "A light add-on for common touch surfaces inside the vehicle.",
  "href": "/services/interior-wipe-down/",
  "media": {
    "src": "/images/aurum-detail-rinse.svg",
    "alt": "Interior wipe-down service illustration"
  }
}
```

## Removing A Page

1. Remove the page object from `pages`.
2. Remove or update links to that path from:
   - `navigation.links`
   - `navigation.cta`
   - `footer.links`
   - section `actions`
   - card `href` values
3. Remove service cards that point to it.
4. Validate the config.
5. Build the site.

The header and footer filter invalid internal links, but content links inside sections should still be cleaned up so visitors do not see dead links.

## Common Mistakes

### Missing Home Page

The config must include:

```json
"path": "/"
```

### Duplicate Page Paths

Do not define both:

```json
"/services"
"/services/"
```

They normalize to the same route.

### Broken Block Reference

This fails if `defaultFAQ` is not the exact key:

```json
{ "use": "defaultFAQ" }
```

If the block key is `defaultFaq`, capitalization matters.

### Broken Anchor Link

This link requires a section with `id: "services"` on the home page:

```json
"/#services"
```

### Overlong Stat Values

Bad:

```json
{ "label": "Approach", "value": "Environmentally responsible exterior vehicle washing" }
```

Better:

```json
{ "label": "Method", "value": "Eco" }
```

### Empty Image Alt Text In Config

Avoid:

```json
"alt": ""
```

Use meaningful alt text in config. Component code may decide when an image should be decorative.

### Low Contrast Dark Themes

If text is hard to read, first check:

- `theme.colors.text`
- `theme.colors.muted`
- `theme.colors.primaryContrast`
- `theme.colors.accentContrast`
- section background overlays

## Validation Commands

Basic config validation:

```bash
npm run validate:config -- public/site.config.json
```

All preset configs:

```bash
npm run validate:presets
```

TypeScript:

```bash
npm run typecheck
```

Unit tests:

```bash
npm run test:unit -- --runInBand
```

Production build:

```bash
npm run build
```

Full recommended local check:

```bash
npm run validate:config -- public/site.config.json
npm run typecheck
npm run test:unit -- --runInBand
npm run build
```

## Launch Checklist

Before handing off or deploying:

- Confirm `site.url`.
- Confirm brand name spelling everywhere.
- Confirm header logo URL or asset path.
- Confirm Open Graph image exists.
- Confirm all navigation links point to real pages.
- Confirm all footer links point to real pages.
- Confirm contact form action is correct.
- Confirm social links are real.
- Confirm policy pages match actual site behavior.
- Confirm `/offline/` is disallowed if used only as a PWA fallback.
- Run config validation.
- Run typecheck.
- Run unit tests.
- Run production build.
- Run `runtime:prepare` if preparing an exported `out/` folder for upload.

## Editing Workflow

Use this workflow for safe config changes:

1. Edit only one concept at a time, such as theme, navigation, or one page.
2. Validate JSON immediately.
3. Search for old copy or removed paths.
4. Update tests if they intentionally assert exact client copy.
5. Build before handoff.

Useful searches:

```bash
rg -n "Old Copy Here" public/site.config.json
rg -n "/old-path/" public/site.config.json
rg -n "\"badges\"|\"stats\"|\"sections\"" public/site.config.json
```

## Mental Model

Think of the config as a small content database:

- `site` names the business.
- `seo` tells crawlers and social platforms what the site is.
- `theme` controls the visual system.
- `navigation` controls the header.
- `blocks` stores reusable sections.
- `pages` creates routes.
- `sections` create page layout.
- `footer` closes the site and repeats important links.

Clean config naming makes the site easier to modify than hardcoded pages. The goal is that a future editor can open `site.config.json`, understand the whole website, make a targeted change, validate it, and ship without touching React code.
