"use strict";

const SECTION_TYPES = new Set([
  "hero",
  "featureGrid",
  "split",
  "cardGrid",
  "stats",
  "timeline",
  "faq",
  "testimonials",
  "cta",
  "richText",
  "logoCloud",
  "contact"
]);

function validateSiteConfig(config) {
  const errors = [];

  function requireString(value, path) {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${path} must be a non-empty string`);
    }
  }

  function requireObject(value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return false;
    }
    return true;
  }

  function normalizePath(path) {
    if (path === "/") return "/";
    return `/${String(path || "").replace(/^\/+|\/+$/g, "")}`;
  }

  function validateSection(section, path) {
    if (!requireObject(section, path)) return;
    if (!SECTION_TYPES.has(section.type)) {
      errors.push(`${path}.type must be one of ${[...SECTION_TYPES].join(", ")}`);
    }
    requireString(section.id, `${path}.id`);
  }

  if (!requireObject(config, "config")) {
    return errors;
  }

  requireString(config.site?.name, "site.name");
  requireString(config.site?.url, "site.url");
  requireString(config.site?.description, "site.description");

  if (config.site?.url) {
    try {
      new URL(config.site.url);
    } catch {
      errors.push("site.url must be an absolute URL, for example https://example.com");
    }
  }

  if (config.seo !== undefined && requireObject(config.seo, "seo")) {
    requireString(config.seo.defaultTitle, "seo.defaultTitle");
    requireString(config.seo.defaultImage, "seo.defaultImage");
  }

  if (config.theme !== undefined && requireObject(config.theme, "theme")) {
    if (!config.theme.colors || typeof config.theme.colors !== "object") {
      errors.push("theme.colors must be an object");
    }
    if (!config.theme.fonts || typeof config.theme.fonts !== "object") {
      errors.push("theme.fonts must be an object");
    }
    requireString(config.theme.radius, "theme.radius");
    requireString(config.theme.maxWidth, "theme.maxWidth");
  }

  if (config.navigation !== undefined && requireObject(config.navigation, "navigation")) {
    requireString(config.navigation.logoText, "navigation.logoText");
    if (!Array.isArray(config.navigation.links)) {
      errors.push("navigation.links must be an array");
    }
  }

  const blocks = config.blocks || {};
  if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
    for (const [blockName, block] of Object.entries(blocks)) {
      validateSection(block, `blocks.${blockName}`);
    }
  } else {
    errors.push("blocks must be an object when provided");
  }

  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    errors.push("pages must contain at least one page");
  } else {
    const paths = new Set();
    let hasHome = false;

    for (const [pageIndex, page] of config.pages.entries()) {
      if (!requireObject(page, `pages[${pageIndex}]`)) continue;

      const pagePath = normalizePath(page.path);
      hasHome ||= pagePath === "/";

      if (paths.has(pagePath)) {
        errors.push(`pages[${pageIndex}].path duplicates ${pagePath}`);
      }
      paths.add(pagePath);

      requireString(page.title, `pages[${pageIndex}].title`);
      requireString(page.description, `pages[${pageIndex}].description`);
      if (!Array.isArray(page.sections)) {
        errors.push(`pages[${pageIndex}].sections must be an array`);
        continue;
      }

      for (const [sectionIndex, section] of page.sections.entries()) {
        const path = `pages[${pageIndex}].sections[${sectionIndex}]`;

        if (section?.use) {
          if (!blocks[section.use]) {
            errors.push(`${path}.use references missing block "${section.use}"`);
          }
          if (!section.id && !blocks[section.use]?.id) {
            errors.push(`${path} must provide id or reference a block with id`);
          }
          continue;
        }

        validateSection(section, path);
      }
    }

    if (!hasHome) {
      errors.push('pages must include a page with path "/"');
    }
  }

  return errors;
}

function deriveFolderFromConfig(config) {
  const explicitFolder =
    config?.syncpoly?.folder ||
    config?.deployment?.folder ||
    config?.site?.folder ||
    config?.site?.slug;

  if (explicitFolder) {
    return normalizeFolderName(explicitFolder);
  }

  const url = config?.site?.url;
  if (!url) return "";

  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".syncpoly.com")) {
      return normalizeFolderName(host.slice(0, -".syncpoly.com".length));
    }
    return normalizeFolderName(host.replace(/^www\./, "").split(".")[0]);
  } catch {
    return "";
  }
}

function normalizeFolderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = {
  SECTION_TYPES,
  deriveFolderFromConfig,
  normalizeFolderName,
  validateSiteConfig
};
