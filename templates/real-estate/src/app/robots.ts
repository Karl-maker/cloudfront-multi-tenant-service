import type { MetadataRoute } from "next";
import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { absoluteUrlForConfig } from "@/lib/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const rules = siteConfig.seo.robots;

  return {
    rules: {
      userAgent: "*",
      allow: rules?.allow?.length ? rules.allow : "/",
      disallow: rules?.disallow
    },
    sitemap: absoluteUrlForConfig(siteConfig, "/sitemap.xml"),
    host: absoluteUrlForConfig(siteConfig, "/")
  };
}
