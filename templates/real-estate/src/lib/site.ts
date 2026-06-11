import { defaultSiteConfig } from "@/lib/default-site-config";
import type {
  BackgroundConfig,
  FooterSocialLink,
  SiteAction,
  SiteConfig,
  SiteLink,
  SitePage,
  SiteSection,
  SiteSectionInput
} from "@/types/site";

export const siteConfig = defaultSiteConfig;
export type ResolvedSitePage = Omit<SitePage, "sections"> & { sections: SiteSection[] };

export const basePath = normalizeBasePath(siteConfig.deployment?.basePath);

export const allPages: ResolvedSitePage[] = resolveConfigPages(siteConfig);

const generatedStaticPaths = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/manifest.webmanifest",
  "/llms.txt",
  "/llm.txt",
  "/icon.svg"
]);

export function normalizeBasePath(path?: string) {
  if (!path) return "";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

export function normalizeRoutePath(path: string) {
  if (!path || path === "/") return "/";
  return `/${path.replace(/^\/+|\/+$/g, "")}/`;
}

export function routePathFromSegments(segments?: string[]) {
  if (!segments || segments.length === 0) return "/";
  return normalizeRoutePath(segments.join("/"));
}

export function segmentsFromRoutePath(path: string) {
  const normalized = normalizeRoutePath(path);
  if (normalized === "/") return [];
  return normalized.replace(/^\/|\/$/g, "").split("/");
}

export function getPageByPath(path: string): ResolvedSitePage | undefined {
  return getPageByPathFromConfig(siteConfig, path);
}

export function getPageByPathFromConfig(config: SiteConfig, path: string): ResolvedSitePage | undefined {
  const normalized = normalizeRoutePath(path);
  return resolveConfigPages(config).find((page) => page.path === normalized);
}

export function isExternalHref(href: string) {
  return /^(https?:|mailto:|tel:)/.test(href);
}

export function isHashHref(href: string) {
  return href.startsWith("#");
}

export function isGeneratedStaticHref(href: string) {
  const { pathname } = parseInternalHref(href);
  return generatedStaticPaths.has(pathname);
}

export function normalizeInternalHref(href: string) {
  if (!href || isExternalHref(href) || isHashHref(href)) return href;
  if (isGeneratedStaticHref(href)) return assetPath(parseInternalHref(href).pathname);

  const { pathname, search, hash } = parseInternalHref(href);
  return `${normalizeRoutePath(pathname)}${search}${hash}`;
}

export function isConfiguredHref(href: string) {
  return isConfiguredHrefForConfig(siteConfig, href);
}

export function isConfiguredHrefForConfig(config: SiteConfig, href: string) {
  if (!href || isExternalHref(href)) return true;
  if (isGeneratedStaticHref(href)) return true;

  const { pathname, hash } = parseInternalHref(href);
  const targetPath = pathname || "/";
  const page = getPageByPathFromConfig(config, targetPath);

  if (!page) return false;
  if (!hash) return true;

  return page.sections.some((section) => section.id === hash.slice(1));
}

export function getNavigationLinks(): SiteLink[] {
  return getNavigationLinksForConfig(siteConfig);
}

export function getNavigationLinksForConfig(config: SiteConfig): SiteLink[] {
  return config.navigation.links.filter((link) => isConfiguredHrefForConfig(config, link.href));
}

export function getNavigationCta(): SiteAction | undefined {
  return getNavigationCtaForConfig(siteConfig);
}

export function getNavigationCtaForConfig(config: SiteConfig): SiteAction | undefined {
  const cta = config.navigation.cta;
  return cta && isConfiguredHrefForConfig(config, cta.href) ? cta : undefined;
}

export function getFooterLinks(): SiteLink[] {
  return getFooterLinksForConfig(siteConfig);
}

export function getFooterLinksForConfig(config: SiteConfig): SiteLink[] {
  return (config.footer.links || []).filter((link) => isConfiguredHrefForConfig(config, link.href));
}

export function getFooterSocialLinks(): FooterSocialLink[] {
  return getFooterSocialLinksForConfig(siteConfig);
}

export function getFooterSocialLinksForConfig(config: SiteConfig): FooterSocialLink[] {
  return (config.footer.socialLinks || []).filter((link) => isConfiguredHrefForConfig(config, link.href));
}

export function assetPath(src: string) {
  return assetPathForConfig(siteConfig, src);
}

export function assetPathForConfig(config: SiteConfig, src: string) {
  if (!src || /^(https?:|data:|mailto:|tel:|#)/.test(src)) return src;
  const normalized = src.startsWith("/") ? src : `/${src}`;
  return `${normalizeBasePath(config.deployment?.basePath)}${normalized}`;
}

export function absoluteUrl(path = "/") {
  return absoluteUrlForConfig(siteConfig, path);
}

export function absoluteUrlForConfig(config: SiteConfig, path = "/") {
  if (/^https?:/.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const joined = `${normalizeBasePath(config.deployment?.basePath)}${normalized}`.replace(/\/{2,}/g, "/");
  return new URL(joined, config.site.url).toString();
}

export function backgroundStyleValue(background?: BackgroundConfig) {
  if (!background) return undefined;

  if (background.type === "image") {
    const image = `url("${assetPath(background.value)}")`;
    return background.overlay ? `${background.overlay}, ${image}` : image;
  }

  return background.value;
}

export function pageDescription(page: SitePage) {
  return page.seo?.description || page.description || siteConfig.site.description;
}

export function pageDescriptionForConfig(config: SiteConfig, page: SitePage) {
  return page.seo?.description || page.description || config.site.description;
}

export function resolveConfigPages(config: SiteConfig): ResolvedSitePage[] {
  return config.pages.map((page) => resolvePageForConfig(config, page));
}

export function resolvePage(page: SitePage): ResolvedSitePage {
  return resolvePageForConfig(siteConfig, page);
}

export function resolvePageForConfig(config: SiteConfig, page: SitePage): ResolvedSitePage {
  return {
    ...page,
    path: normalizeRoutePath(page.path),
    sections: page.sections.map((section) => resolveSectionForConfig(config, section))
  };
}

export function resolveSection(section: SiteSectionInput): SiteSection {
  return resolveSectionForConfig(siteConfig, section);
}

export function resolveSectionForConfig(config: SiteConfig, section: SiteSectionInput): SiteSection {
  if ("use" in section) {
    const { use, ...overrides } = section;
    const block = config.blocks?.[use];

    if (!block) {
      throw new Error(`Section references missing block "${use}".`);
    }

    return {
      ...block,
      ...overrides,
      id: overrides.id || block.id
    };
  }

  return section;
}

function parseInternalHref(href: string) {
  const url = new URL(href || "/", "https://static-template.local");

  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
}
