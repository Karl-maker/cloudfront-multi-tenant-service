import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const validateAll = process.argv.includes("--all");

const sectionTypes = new Set([
  "hero",
  "mediaGallery",
  "rates",
  "amenities",
  "location",
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

const activeConfig = join(projectRoot, "public/site.config.json");
const configFiles = validateAll
  ? [
      ...(existsSync(activeConfig) ? [activeConfig] : []),
      ...readdirSync(join(projectRoot, "content/presets"))
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(projectRoot, "content/presets", file))
    ]
  : [activeConfig];

if (!validateAll && !existsSync(activeConfig)) {
  console.log("No public/site.config.json found. Add one beside the static build to validate runtime website data.");
  process.exit(0);
}

let hasFailures = false;

for (const file of configFiles) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateConfig(config);

  if (errors.length > 0) {
    hasFailures = true;
    console.error(`${basename(file)} validation failed:`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
  } else {
    console.log(`${basename(file)} validation passed.`);
  }
}

if (hasFailures) {
  process.exit(1);
}

function validateConfig(config) {
  const errors = [];

  function requireString(value, path) {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${path} must be a non-empty string`);
    }
  }

  function normalizePath(path) {
    if (path === "/") return "/";
    return `/${String(path || "").replace(/^\/+|\/+$/g, "")}`;
  }

  function validateSection(section, path) {
    if (!sectionTypes.has(section.type)) {
      errors.push(`${path}.type must be one of ${[...sectionTypes].join(", ")}`);
    }
    requireString(section.id, `${path}.id`);
  }

  requireString(config.site?.name, "site.name");
  requireString(config.site?.url, "site.url");
  requireString(config.site?.description, "site.description");

  try {
    new URL(config.site?.url);
  } catch {
    errors.push("site.url must be an absolute URL, for example https://example.com");
  }

  const blocks = config.blocks || {};
  for (const [blockName, block] of Object.entries(blocks)) {
    validateSection(block, `blocks.${blockName}`);
  }

  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    errors.push("pages must contain at least one page");
  } else {
    const paths = new Set();
    let hasHome = false;

    for (const [pageIndex, page] of config.pages.entries()) {
      const pagePath = normalizePath(page.path);
      hasHome ||= pagePath === "/";

      if (paths.has(pagePath)) {
        errors.push(`pages[${pageIndex}].path duplicates ${pagePath}`);
      }
      paths.add(pagePath);

      requireString(page.title, `pages[${pageIndex}].title`);
      if (!Array.isArray(page.sections)) {
        errors.push(`pages[${pageIndex}].sections must be an array`);
        continue;
      }

      for (const [sectionIndex, section] of page.sections.entries()) {
        const path = `pages[${pageIndex}].sections[${sectionIndex}]`;

        if (section.use) {
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
