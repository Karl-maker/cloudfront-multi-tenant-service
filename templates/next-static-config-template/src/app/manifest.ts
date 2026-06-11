import type { MetadataRoute } from "next";
import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { assetPathForConfig } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  const icon = siteConfig.site.manifest?.icon || "/images/icon.svg";
  const manifestConfig = siteConfig.site.manifest;
  const display = siteConfig.site.manifest?.display as MetadataRoute.Manifest["display"] | undefined;
  const orientation = siteConfig.site.manifest?.orientation as MetadataRoute.Manifest["orientation"] | undefined;

  return {
    id: assetPathForConfig(siteConfig, "/"),
    lang: siteConfig.site.locale.replace("_", "-"),
    name: siteConfig.site.name,
    short_name: siteConfig.site.shortName,
    description: siteConfig.site.description,
    start_url: assetPathForConfig(siteConfig, "/"),
    scope: assetPathForConfig(siteConfig, "/"),
    display: display || "standalone",
    orientation: orientation || "portrait",
    background_color: siteConfig.site.manifest?.backgroundColor || siteConfig.theme.colors.background,
    theme_color: siteConfig.site.manifest?.themeColor || siteConfig.theme.colors.primary,
    icons: [
      {
        src: assetPathForConfig(siteConfig, icon),
        sizes: "any",
        type: imageType(icon),
        purpose: "any"
      },
      {
        src: assetPathForConfig(siteConfig, icon),
        sizes: "any",
        type: imageType(icon),
        purpose: "maskable"
      }
    ],
    categories: manifestConfig?.categories,
    screenshots: manifestConfig?.screenshots?.map((screenshot) => ({
      src: assetPathForConfig(siteConfig, screenshot.src),
      sizes: screenshot.sizes,
      type: screenshot.type,
      form_factor: screenshot.formFactor as "narrow" | "wide" | undefined,
      label: screenshot.label
    })),
    shortcuts: manifestConfig?.shortcuts?.map((shortcut) => ({
      name: shortcut.name,
      short_name: shortcut.shortName,
      description: shortcut.description,
      url: assetPathForConfig(siteConfig, shortcut.url),
      icons: shortcut.icon
        ? [
            {
              src: assetPathForConfig(siteConfig, shortcut.icon),
              sizes: "any",
              type: imageType(shortcut.icon)
            }
          ]
        : undefined
    })),
    prefer_related_applications: manifestConfig?.preferRelatedApplications
  };
}

function imageType(src: string) {
  const cleanSrc = src.split(/[?#]/)[0].toLowerCase();

  if (cleanSrc.endsWith(".png")) return "image/png";
  if (cleanSrc.endsWith(".jpg") || cleanSrc.endsWith(".jpeg")) return "image/jpeg";
  if (cleanSrc.endsWith(".webp")) return "image/webp";

  return "image/svg+xml";
}
