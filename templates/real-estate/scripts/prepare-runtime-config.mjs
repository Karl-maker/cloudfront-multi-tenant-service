import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceArg = process.argv[2];
const outputArg = process.argv[3] || "out";

if (!sourceArg) {
  console.error("Usage: npm run runtime:prepare -- /path/to/site.config.json [out]");
  process.exit(1);
}

const sourcePath = resolve(projectRoot, sourceArg);
const outputDir = resolve(projectRoot, outputArg);
const config = JSON.parse(readFileSync(sourcePath, "utf8"));
const basePath = normalizeBasePath(config.deployment?.basePath);

mkdirSync(outputDir, { recursive: true });
copyFileSync(sourcePath, join(outputDir, "site.config.json"));
writeFileSync(join(outputDir, "sitemap.xml"), createSitemap(config, basePath));
writeFileSync(join(outputDir, "robots.txt"), createRobots(config, basePath));
writeFileSync(join(outputDir, "manifest.webmanifest"), `${JSON.stringify(createManifest(config, basePath), null, 2)}\n`);
writeFileSync(join(outputDir, "llms.txt"), createLlms(config, basePath));
writeFileSync(join(outputDir, "llm.txt"), createLlms(config, basePath));

console.log(`Prepared runtime config and discovery files in ${outputDir}.`);

function normalizeBasePath(path = "") {
  if (!path) return "";
  return `/${String(path).replace(/^\/+|\/+$/g, "")}`;
}

function routePath(path) {
  if (!path || path === "/") return "/";
  return `/${String(path).replace(/^\/+|\/+$/g, "")}/`;
}

function assetPath(path, basePathValue = basePath) {
  if (!path || /^(https?:|data:|mailto:|tel:|#)/.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePathValue}${normalized}`.replace(/\/{2,}/g, "/");
}

function absoluteUrl(configValue, path) {
  if (/^https?:/.test(path)) return path;
  return new URL(assetPath(path), configValue.site.url).toString();
}

function pageDescription(configValue, page) {
  return page.seo?.description || page.description || configValue.site.description;
}

function createSitemap(configValue) {
  const updated = configValue.site.updatedAt || new Date().toISOString();
  const urls = configValue.pages.filter((page) => !isDisallowed(configValue, page.path)).map((page) => {
    const priority = routePath(page.path) === "/" ? "1.0" : "0.8";
    const frequency = routePath(page.path) === "/" ? "weekly" : "monthly";

    return [
      "  <url>",
      `    <loc>${escapeXml(absoluteUrl(configValue, routePath(page.path)))}</loc>`,
      `    <lastmod>${escapeXml(updated)}</lastmod>`,
      `    <changefreq>${frequency}</changefreq>`,
      `    <priority>${priority}</priority>`,
      "  </url>"
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    ""
  ].join("\n");
}

function createRobots(configValue) {
  const rules = configValue.seo.robots || {};
  const allow = rules.allow?.length ? rules.allow : ["/"];
  const disallow = rules.disallow || [];

  return [
    "User-agent: *",
    ...allow.map((path) => `Allow: ${path}`),
    ...disallow.map((path) => `Disallow: ${path}`),
    `Sitemap: ${absoluteUrl(configValue, "/sitemap.xml")}`,
    `Host: ${absoluteUrl(configValue, "/")}`,
    ""
  ].join("\n");
}

function createManifest(configValue) {
  const manifest = configValue.site.manifest || {};
  const icon = manifest.icon || "/images/icon.svg";

  return {
    id: assetPath("/"),
    lang: configValue.site.locale.replace("_", "-"),
    name: configValue.site.name,
    short_name: configValue.site.shortName,
    description: configValue.site.description,
    start_url: assetPath("/"),
    scope: assetPath("/"),
    display: manifest.display || "standalone",
    orientation: manifest.orientation || "portrait",
    background_color: manifest.backgroundColor || configValue.theme.colors.background,
    theme_color: manifest.themeColor || configValue.theme.colors.primary,
    icons: [
      { src: assetPath(icon), sizes: "any", type: imageType(icon), purpose: "any" },
      { src: assetPath(icon), sizes: "any", type: imageType(icon), purpose: "maskable" }
    ],
    categories: manifest.categories,
    screenshots: manifest.screenshots?.map((screenshot) => ({
      src: assetPath(screenshot.src),
      sizes: screenshot.sizes,
      type: screenshot.type,
      form_factor: screenshot.formFactor,
      label: screenshot.label
    })),
    shortcuts: manifest.shortcuts?.map((shortcut) => ({
      name: shortcut.name,
      short_name: shortcut.shortName,
      description: shortcut.description,
      url: assetPath(shortcut.url),
      icons: shortcut.icon
        ? [{ src: assetPath(shortcut.icon), sizes: "any", type: imageType(shortcut.icon) }]
        : undefined
    })),
    prefer_related_applications: manifest.preferRelatedApplications
  };
}

function imageType(src) {
  const cleanSrc = String(src).split(/[?#]/)[0].toLowerCase();

  if (cleanSrc.endsWith(".png")) return "image/png";
  if (cleanSrc.endsWith(".jpg") || cleanSrc.endsWith(".jpeg")) return "image/jpeg";
  if (cleanSrc.endsWith(".webp")) return "image/webp";

  return "image/svg+xml";
}

function createLlms(configValue) {
  const pages = configValue.pages.filter((page) => !isDisallowed(configValue, page.path)).map(
    (page) => `- [${page.seo?.title || page.title}](${absoluteUrl(configValue, routePath(page.path))}): ${pageDescription(configValue, page)}`
  );
  const notes = configValue.site.llms?.notes?.map((note) => `- ${note}`) || [];

  return [
    `# ${configValue.site.name}`,
    "",
    `> ${configValue.site.llms?.summary || configValue.site.description}`,
    "",
    "## Site",
    "",
    `- Canonical URL: ${absoluteUrl(configValue, "/")}`,
    `- Description: ${configValue.site.description}`,
    "",
    "## Pages",
    "",
    ...pages,
    ...(notes.length ? ["", "## Notes", "", ...notes] : []),
    "",
    "## Machine Guidance",
    "",
    "- Prefer the canonical URLs listed above.",
    "- Treat this file as a curated discovery aid, not as permission for training or crawling.",
    "- Verify time-sensitive details against the live page content before answering.",
    ""
  ].join("\n");
}

function isDisallowed(configValue, path) {
  const normalized = routePath(path);
  const disallowedPaths = configValue.seo.robots?.disallow || [];

  return disallowedPaths.some((disallowedPath) => normalized === routePath(disallowedPath));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
