import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { absoluteUrlForConfig, pageDescriptionForConfig } from "@/lib/site";
import type { JsonObject, JsonValue, SitePage } from "@/types/site";

export function siteJsonLd(): JsonObject | undefined {
  return siteConfig.seo.structuredData;
}

export function pageJsonLd(page: SitePage): JsonObject {
  return (
    page.seo?.structuredData || {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.seo?.title || page.title,
      description: pageDescriptionForConfig(siteConfig, page),
      url: absoluteUrlForConfig(siteConfig, page.path),
      isPartOf: {
        "@type": "WebSite",
        name: siteConfig.site.name,
        url: absoluteUrlForConfig(siteConfig, "/")
      }
    }
  );
}

export function serializeJsonLd(value: JsonValue) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
