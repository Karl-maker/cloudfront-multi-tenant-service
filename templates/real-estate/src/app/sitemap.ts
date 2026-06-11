import type { MetadataRoute } from "next";
import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { absoluteUrlForConfig, normalizeRoutePath, resolveConfigPages } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(siteConfig.site.updatedAt || new Date().toISOString());

  return resolveConfigPages(siteConfig)
    .filter((page) => !isDisallowed(page.path))
    .map((page) => ({
      url: absoluteUrlForConfig(siteConfig, page.path),
      lastModified,
      changeFrequency: page.path === "/" ? "weekly" : "monthly",
      priority: page.path === "/" ? 1 : 0.8
    }));
}

function isDisallowed(path: string) {
  const disallowedPaths = siteConfig.seo.robots?.disallow || [];
  const normalized = normalizeRoutePath(path);

  return disallowedPaths.some((disallowedPath) => normalized === normalizeRoutePath(disallowedPath));
}
