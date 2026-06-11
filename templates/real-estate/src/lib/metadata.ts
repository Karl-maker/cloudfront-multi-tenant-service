import type { Metadata, Viewport } from "next";
import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { absoluteUrlForConfig, assetPathForConfig, pageDescriptionForConfig } from "@/lib/site";
import type { SitePage } from "@/types/site";

const defaultOgImage = siteConfig.seo.defaultImage;
const robots = siteConfig.seo.robots;
const twitterHandle = siteConfig.site.social?.twitterHandle;

export const rootViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: siteConfig.site.manifest?.themeColor || siteConfig.theme.colors.primary,
  colorScheme: siteConfig.theme.mode || "light"
};

export const rootMetadata: Metadata = {
  metadataBase: new URL(siteConfig.site.url),
  title: {
    default: siteConfig.seo.defaultTitle,
    template: siteConfig.seo.titleTemplate || `%s | ${siteConfig.site.name}`
  },
  description: siteConfig.site.description,
  applicationName: siteConfig.site.name,
  authors: siteConfig.site.author?.name
    ? [{ name: siteConfig.site.author.name, url: siteConfig.site.author.url }]
    : undefined,
  creator: siteConfig.site.author?.name,
  publisher: siteConfig.site.author?.name,
  generator: "Next.js static export",
  keywords: siteConfig.site.keywords,
  manifest: assetPathForConfig(siteConfig, "/manifest.webmanifest"),
  appleWebApp: {
    capable: true,
    title: siteConfig.site.shortName,
    statusBarStyle: "default"
  },
  formatDetection: {
    telephone: true,
    email: true,
    address: true
  },
  icons: {
    icon: [{ url: assetPathForConfig(siteConfig, siteConfig.site.manifest?.icon || "/images/icon.svg") }],
    apple: [{ url: assetPathForConfig(siteConfig, siteConfig.site.manifest?.icon || "/images/icon.svg") }]
  },
  alternates: {
    canonical: absoluteUrlForConfig(siteConfig, "/")
  },
  openGraph: {
    type: "website",
    url: absoluteUrlForConfig(siteConfig, "/"),
    siteName: siteConfig.site.name,
    title: siteConfig.seo.defaultTitle,
    description: siteConfig.site.description,
    locale: siteConfig.site.locale,
    images: [
      {
        url: absoluteUrlForConfig(siteConfig, defaultOgImage),
        alt: `${siteConfig.site.name} preview`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    site: twitterHandle,
    creator: twitterHandle,
    title: siteConfig.seo.defaultTitle,
    description: siteConfig.site.description,
    images: [absoluteUrlForConfig(siteConfig, defaultOgImage)]
  },
  robots: {
    index: robots?.index ?? true,
    follow: robots?.follow ?? true
  }
};

export function metadataForPage(page: SitePage): Metadata {
  const title = page.seo?.title || page.title;
  const description = pageDescriptionForConfig(siteConfig, page);
  const image = page.seo?.image || defaultOgImage;
  const url = absoluteUrlForConfig(siteConfig, page.path);

  return {
    title,
    description,
    keywords: page.seo?.keywords,
    alternates: {
      canonical: url
    },
    openGraph: {
      type: "website",
      url,
      siteName: siteConfig.site.name,
      title,
      description,
      locale: siteConfig.site.locale,
      images: [
        {
          url: absoluteUrlForConfig(siteConfig, image),
          alt: `${title} preview`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      site: twitterHandle,
      creator: twitterHandle,
      title,
      description,
      images: [absoluteUrlForConfig(siteConfig, image)]
    }
  };
}
