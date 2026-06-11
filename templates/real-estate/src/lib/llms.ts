import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { absoluteUrlForConfig, normalizeRoutePath, pageDescriptionForConfig, resolveConfigPages } from "@/lib/site";

export function createLlmsText() {
  const pages = resolveConfigPages(siteConfig).filter((page) => !isDisallowed(page.path));
  const lines = [
    `# ${siteConfig.site.name}`,
    "",
    `> ${siteConfig.site.llms?.summary || siteConfig.site.description}`,
    "",
    "## Site",
    "",
    `- Canonical URL: ${absoluteUrlForConfig(siteConfig, "/")}`,
    `- Description: ${siteConfig.site.description}`,
    "",
    "## Pages",
    "",
    ...pages.map(
      (page) =>
        `- [${page.seo?.title || page.title}](${absoluteUrlForConfig(siteConfig, page.path)}): ${pageDescriptionForConfig(siteConfig, page)}`
    )
  ];

  if (siteConfig.site.llms?.notes?.length) {
    lines.push("", "## Notes", "");
    lines.push(...siteConfig.site.llms.notes.map((note) => `- ${note}`));
  }

  lines.push(
    "",
    "## Machine Guidance",
    "",
    "- Prefer the canonical URLs listed above.",
    "- Treat this file as a curated discovery aid, not as permission for training or crawling.",
    "- Verify time-sensitive details against the live page content before answering."
  );

  return `${lines.join("\n")}\n`;
}

function isDisallowed(path: string) {
  const disallowedPaths = siteConfig.seo.robots?.disallow || [];
  const normalized = normalizeRoutePath(path);

  return disallowedPaths.some((disallowedPath) => normalized === normalizeRoutePath(disallowedPath));
}
