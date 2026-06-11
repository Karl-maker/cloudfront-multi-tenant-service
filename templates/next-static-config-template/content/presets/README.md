# Layout Presets

These JSON files are complete `site.config.json` examples. Copy one outside the template for a project config, or create a local preview config with:

```bash
npm run preset:use -- saas-product
```

Included presets:

- `saas-product`: product landing page with features, pricing, FAQ, contact, and PWA defaults.
- `local-service`: local business site with services, booking/contact, and FAQ.
- `portfolio`: single-page portfolio with work, about, FAQ, and contact anchors.
- `event-microsite`: event landing page with schedule, speakers, FAQ, and external registration.

After applying a preset, update `site.url`, identity fields, SEO copy, page copy, and contact routes. For S3, upload the finished file as `/site.config.json` or run `npm run runtime:prepare -- /path/to/site.config.json out` after building.
