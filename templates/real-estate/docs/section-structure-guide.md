# Section Structure Guide

This template is driven by `public/site.config.json` at runtime. A page is an object in `pages`; each page has a unique `path`, SEO fields, and an ordered `sections` array.

All feature sections are optional. The site only renders the pages listed in `pages` and only renders the sections listed on each page. To remove rates, amenities, location, testimonials, FAQ, contact, or any other feature, remove that section or page from the config and remove any navigation/footer links that point to it. Header, footer, card, and CTA links are filtered so unconfigured internal targets do not render.

## Page Shape

```json
{
  "path": "/rates/",
  "title": "Rates",
  "layout": "content",
  "description": "Short fallback page description.",
  "seo": {
    "title": "Rates & Packages",
    "description": "Search result and social preview description.",
    "image": "/images/og-rates.jpg",
    "keywords": ["rates", "packages"],
    "structuredData": {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Rates & Packages"
    }
  },
  "sections": []
}
```

Use page-level `seo.structuredData` for specialized pages such as `OfferCatalog`, `FAQPage`, `RealEstateAgent`, `LocalBusiness`, `LodgingBusiness`, or `Service`.

## Optional Pages

Add any number of pages by appending objects to `pages`. A page can contain one section or many. It can also be omitted entirely.

Common optional page patterns:

- Landing page: `hero`, `mediaGallery`, `featureGrid`, `testimonials`, `cta`.
- Rates page: `hero`, `rates`, `faq`, `cta`.
- Amenities page: `hero`, `amenities`, `mediaGallery`.
- Location page: `hero`, `location`.
- FAQ page: `hero`, `faq`.
- About page: `hero`, `richText`, `timeline`, `testimonials`.

## Shared Section Fields

Every section supports:

- `id`: anchor target and stable DOM id.
- `type`: renderer type.
- `kicker`, `title`, `body`: section intro copy.
- `variant`: layout modifier such as `centered`, `split`, `mediaLeft`, or custom CSS variants.
- `className`: optional custom CSS hook.
- `background`: solid, gradient, or image background.
- `actions`: buttons or links.
- `media`: single image, video, or embed.
- `mediaItems`: carousel/gallery items.
- `carousel`: carousel behavior.

## Media

Media works in heroes, split sections, cards, and media galleries.

```json
{
  "type": "video",
  "src": "/videos/walkthrough.mp4",
  "poster": "/images/walkthrough-poster.jpg",
  "alt": "Property walkthrough video",
  "caption": "A short guided walkthrough.",
  "controls": true,
  "autoplay": false,
  "muted": true,
  "loop": false
}
```

Use `type: "image"` for images, `type: "video"` for local or CDN video files, and `type: "embed"` for iframe embeds such as YouTube or Vimeo.

## Hero

Hero sections support different layouts through `variant`:

- `centered`: centered copy, good for simple landing or content pages.
- `split`: copy plus media.
- `mediaLeft`: media first, copy second.
- `fullBleed` or custom names: use with `theme.customCss` or `className`.

Hero background images use:

```json
"background": {
  "type": "image",
  "value": "/images/hero.jpg",
  "overlay": "linear-gradient(90deg, rgba(0,0,0,.72), rgba(0,0,0,.2))"
}
```

## Media Gallery

Use `mediaGallery` when the carousel should live outside the hero.

```json
{
  "id": "gallery",
  "type": "mediaGallery",
  "title": "Featured views",
  "carousel": {
    "enabled": true,
    "autoPlay": false,
    "intervalMs": 6500,
    "label": "Featured media"
  },
  "mediaItems": []
}
```

## Rates

Use `rates` for service packages, room rates, booking tiers, or quote ranges. This section is optional; include it only on pages that need pricing or package comparison.

```json
{
  "id": "rates-list",
  "type": "rates",
  "title": "Choose a package",
  "items": [
    {
      "label": "Popular",
      "title": "Property Marketing",
      "price": "Custom",
      "period": "per listing",
      "featured": true,
      "body": "Listing presentation and campaign support.",
      "amenities": ["Visual direction", "Listing copy", "Lead handoff"],
      "href": "/contact/"
    }
  ]
}
```

## Amenities

Use `amenities` for property features, venue services, room benefits, service inclusions, or neighborhood highlights. This section is optional.

```json
{
  "id": "amenities",
  "type": "amenities",
  "columns": 4,
  "items": [
    {
      "icon": "01",
      "title": "Parking",
      "body": "Private and visitor parking options."
    }
  ]
}
```

## Location

Use `location` for Google Maps, office details, service areas, hours, directions, and appointment notes. This section is optional and can be replaced with `richText` or `contact` if a map is not needed.

```json
{
  "id": "location-map",
  "type": "location",
  "title": "Visit us",
  "map": {
    "title": "Office map",
    "address": "4 De Verteuil St, Woodbrook, Port of Spain",
    "query": "4 De Verteuil St, Woodbrook, Port of Spain"
  },
  "methods": [
    { "label": "Hours", "value": "Mon - Fri, 7:00am - 3:00pm" }
  ]
}
```

Use `map.embedUrl` when you have a verified Google Maps embed URL. Otherwise `map.query` generates a Google Maps iframe.

## Nested FAQ

FAQ sections are optional. FAQ items can contain `children`.

```json
{
  "id": "faq",
  "type": "faq",
  "items": [
    {
      "question": "Do you support rentals?",
      "answer": "Yes.",
      "children": [
        {
          "question": "Can rentals have rates?",
          "answer": "Yes. Add a rates page or rates section."
        }
      ]
    }
  ]
}
```

For best SEO, add page-level `seo.structuredData` with `@type: "FAQPage"` when FAQ content is the primary page content.

## Testimonials

Testimonials are optional. Add a `testimonials` section wherever reviews, client notes, ratings, or social proof are useful.

```json
{
  "id": "testimonials",
  "type": "testimonials",
  "title": "What clients say",
  "columns": 3,
  "items": [
    {
      "rating": 5,
      "body": "Clear communication from search to closing.",
      "name": "Client Name",
      "role": "Buyer",
      "location": "Port of Spain"
    }
  ]
}
```
