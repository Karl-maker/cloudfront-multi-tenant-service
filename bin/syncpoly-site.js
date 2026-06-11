#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildSiteInput,
  buildSiteConfig,
  writeSeoFiles,
  writeSiteInput,
  writeSiteConfig
} = require("../lib/site-config-builder");
const { listThemes, resolveThemeName } = require("../lib/site-themes");
const { normalizeFolderName } = require("../lib/site-config-schema");
const {
  MEDIA_EXTENSIONS,
  SEO_FILE_NAMES,
  parseArgs,
  assertTenantImagesUseMediaPrefix,
  prepareCompressedMedia,
  listFiles,
  getCacheControl,
  getContentType,
  parseMediaCompressionOptions,
  resolveBucket,
  resolveFolder,
  runAwsS3Cp,
  selectSeoFiles,
  uploadFiles,
  validateAndReadConfig
} = require("../lib/site-upload");
const {
  addGoDaddyRecord,
  buildCnameRecord,
  describeCname
} = require("../lib/godaddy-dns");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const argv = process.argv.slice(2);
  if (
    argv.length === 0 ||
    argv[0] === "--help" ||
    argv[0] === "-h" ||
    argv[0] === "help"
  ) {
    printHelp();
    return;
  }

  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  loadEnvFile(args.envFile || process.env.ENV_FILE || ".env");

  if (args.help) {
    printHelp();
    return;
  }

  if (command === "upload-folder") {
    await uploadFolder(args);
  } else if (command === "upload-template") {
    await uploadTemplate(args);
  } else if (command === "upload-templates") {
    await uploadTemplates(args);
  } else if (command === "upload-media") {
    await uploadMedia(args);
  } else if (command === "upload-seo") {
    await uploadSeo(args);
  } else if (command === "upload-config") {
    await uploadConfig(args);
  } else if (command === "validate-config") {
    await validateConfig(args);
  } else if (command === "make-siteconfig") {
    await makeSiteConfig(args);
  } else if (command === "make-input") {
    await makeInput(args);
  } else if (command === "make-seo") {
    await makeSeo(args);
  } else if (command === "make-site") {
    await makeSite(args);
  } else if (command === "media-manifest") {
    mediaManifest(args);
  } else if (command === "audit-site") {
    auditSite(args);
  } else if (command === "add-route") {
    addRoute(args);
  } else if (command === "launch-check") {
    launchCheck(args);
  } else if (command === "make-outreach") {
    makeOutreach(args);
  } else if (command === "screenshot-audit") {
    screenshotAudit(args);
  } else if (command === "publish") {
    await publishSite(args);
  } else if (command === "list-themes") {
    listAvailableThemes();
  } else if (command === "add-cname") {
    await addCname(args);
  } else if (command === "preview") {
    await previewSite(args);
  } else if (command === "screenshot") {
    await screenshotSite(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

async function uploadFolder(args) {
  const source = requirePath(args.source || args.dir || process.env.SITE_UPLOAD_SOURCE, "source");
  const config = readOptionalConfig(args);
  const target = resolveTarget(args, config);
  const sourceRoot = fs.statSync(source).isDirectory() ? source : path.dirname(source);
  const files = listFiles(source);
  const prefix = args.prefix || process.env.SITE_UPLOAD_PREFIX || "";
  assertTenantImagesUseMediaPrefix({ files, prefix, commandName: "upload-folder" });
  const uploads = uploadFiles({
    files,
    sourceRoot,
    bucket: target.bucket,
    folder: target.folder,
    prefix,
    dryRun: isDryRun(args),
    region: process.env.AWS_REGION,
    profile: awsProfile(args)
  });
  printUploads(uploads);
}

async function uploadTemplate(args) {
  const templateName = normalizeFolderName(args.templateName || args.template || args.name || args._[0] || "");
  if (!templateName) {
    throw new Error("Missing --template-name for upload-template.");
  }

  const source = requirePath(resolveTemplateOut(args, templateName), "source");
  const files = listFiles(source);
  if (files.length === 0) {
    throw new Error(`No template files found in ${source}`);
  }

  const uploads = uploadFiles({
    files,
    sourceRoot: fs.statSync(source).isDirectory() ? source : path.dirname(source),
    bucket: resolveBucket(process.env, args),
    folder: "syncpoly/templates",
    prefix: templateName,
    kind: "template",
    dryRun: isDryRun(args),
    region: process.env.AWS_REGION,
    profile: awsProfile(args)
  });
  printUploads(uploads);
  console.log(`Template uploaded: syncpoly/templates/${templateName}/ (${files.length} file(s))`);
}

async function uploadTemplates(args) {
  const registry = readTemplateRegistry(args);
  const names = parseTemplateNames(args.templates || args.templateNames || args._.join(",") || Object.keys(registry.templates || {}).join(","));
  if (names.length === 0) {
    throw new Error("No templates registered for upload.");
  }

  for (const templateName of names) {
    await uploadTemplate({ ...args, templateName });
  }
}

async function uploadMedia(args) {
  const source = requirePath(args.source || args.dir || process.env.SITE_MEDIA_SOURCE, "source");
  const config = readOptionalConfig(args);
  const target = resolveTarget(args, config);
  const compression = parseMediaCompressionOptions(args);
  const prepared = await prepareCompressedMedia({
    source,
    compression,
    log: (message) => console.warn(message)
  });

  if (prepared.files.length === 0) {
    throw new Error(`No media files found in ${source}`);
  }

  const uploads = uploadFiles({
    files: prepared.files,
    sourceRoot: prepared.outputRoot,
    bucket: target.bucket,
    folder: target.folder,
    prefix: args.prefix || "media",
    kind: "media",
    dryRun: isDryRun(args),
    region: process.env.AWS_REGION,
    profile: awsProfile(args)
  });
  printUploads(uploads);
}

async function uploadSeo(args) {
  const source = requirePath(args.source || args.dir || process.env.SITE_SEO_SOURCE, "source");
  const config = readOptionalConfig(args);
  const target = resolveTarget(args, config);
  const files = selectSeoFiles(source);

  if (files.length === 0) {
    throw new Error(`No SEO files found in ${source}`);
  }

  const uploads = uploadFiles({
    files,
    sourceRoot: fs.statSync(source).isDirectory() ? source : path.dirname(source),
    bucket: target.bucket,
    folder: target.folder,
    kind: "seo",
    dryRun: isDryRun(args),
    region: process.env.AWS_REGION,
    profile: awsProfile(args)
  });
  printUploads(uploads);
}

async function uploadConfig(args) {
  const file = requirePath(args.file || args.config || process.env.SITE_CONFIG, "file");
  const config = validateAndReadConfig(file);
  const target = resolveTarget(args, config);
  const key = `${target.folder}/site.config.json`;
  const uploads = [
    runAwsS3Cp({
      file,
      bucket: target.bucket,
      key,
      contentType: getContentType(file),
      cacheControl: getCacheControl("site.config.json", "config"),
      dryRun: isDryRun(args),
      region: process.env.AWS_REGION,
      profile: awsProfile(args)
    })
  ];
  printUploads(uploads);
}

async function validateConfig(args) {
  const file = requirePath(args.file || args.config || process.env.SITE_CONFIG, "file");
  validateAndReadConfig(file);
  console.log(`${file} validation passed.`);
}

async function makeInput(args) {
  const input = readSiteInput(args);
  const siteName = args.site || args.folder || args._[0];
  const siteDir = resolveMakeInputDir(args, input);
  const output = path.resolve(args.out || args.file || path.join(siteDir, "site.input.json"));
  const mediaSource = args.mediaSource || args.media;
  const siteMediaDir = path.join(siteDir, "media");
  const enrichedInput = maybeApplyMediaManifest(input, mediaSource || (fs.existsSync(siteMediaDir) ? siteMediaDir : ""));
  const siteInput = writeSiteInput({
    input: enrichedInput,
    output,
    site: siteName
  });

  console.log(`Wrote ${output}`);
  console.log(`Site input for: ${siteInput.site.name}`);
}

async function makeSiteConfig(args) {
  const input = readSiteInput(args);
  const siteName = args.site || args.folder || args._[0];
  const siteDir = resolveMakeSiteDir(args, input);
  const output = path.resolve(args.out || args.file || args.config || path.join(siteDir, "site.config.json"));
  const template = args.template || process.env.SITE_TEMPLATE;
  const theme = resolveThemeName({
    theme: args.theme || process.env.SITE_THEME,
    inputTheme: input.themePreset || input.theme?.preset,
    template
  });
  const config = writeSiteConfig({
    input,
    output,
    site: siteName,
    theme,
    template,
    updatedAt: args.updatedAt
  });

  console.log(`Wrote ${output}`);
  console.log(`Site folder: ${config.syncpoly.folder}`);
  console.log(`Theme: ${theme}`);
}

async function makeSeo(args) {
  const siteDir = resolveExistingOrNamedSiteDir(args);
  const configPath = path.resolve(args.config || args.file || path.join(siteDir, "site.config.json"));
  const config = validateAndReadConfig(configPath);
  const files = writeSeoFiles({ config, siteDir });
  for (const file of files) {
    console.log(`Wrote ${file}`);
  }
}

async function makeSite(args) {
  const input = readSiteInput(args);
  const siteName = args.site || args.folder || args._[0];
  const siteDir = resolveMakeSiteDir(args, input);
  const configPath = path.resolve(args.out || args.file || args.config || path.join(siteDir, "site.config.json"));
  const template = args.template || process.env.SITE_TEMPLATE;
  const theme = resolveThemeName({
    theme: args.theme || process.env.SITE_THEME,
    inputTheme: input.themePreset || input.theme?.preset,
    template
  });
  const config = writeSiteConfig({
    input,
    output: configPath,
    site: siteName,
    theme,
    template,
    updatedAt: args.updatedAt
  });
  const files = writeSeoFiles({ config, siteDir });

  console.log(`Wrote ${configPath}`);
  for (const file of files) {
    console.log(`Wrote ${file}`);
  }
  console.log(`Site folder: ${config.syncpoly.folder}`);
  console.log(`Theme: ${theme}`);
}

function listAvailableThemes() {
  for (const theme of listThemes()) {
    console.log(`${theme.name}: ${theme.description}`);
  }
}

function mediaManifest(args) {
  const source = resolveMediaSource(args);
  const manifest = buildMediaManifest(source);
  if (args.text) {
    printMediaManifest(manifest);
    return;
  }
  console.log(JSON.stringify(manifest, null, 2));
}

function auditSite(args) {
  const report = auditSiteDir(resolveExistingOrNamedSiteDir(args), args);
  printGateReport(report);
  if (report.errors.length > 0) {
    throw new Error(`Site audit failed with ${report.errors.length} error(s).`);
  }
}

function addRoute(args) {
  const route = resolveRouteArgs(args);
  const result = ensureRoute(route);
  console.log(result.message);
}

function launchCheck(args) {
  const siteDir = resolveExistingOrNamedSiteDir(args);
  const config = validateAndReadConfig(path.join(siteDir, "site.config.json"));
  const folder = resolveFolder({ env: {}, args: { folder: args.folder }, config });
  const report = auditSiteDir(siteDir, args);
  const router = args.router || path.join("cloudfront", "domain-folder-router.js");
  const route = readRoute(router, args.host || `${folder}.syncpoly.com`);
  const checks = [
    { ok: report.errors.length === 0, label: "site audit" },
    { ok: Boolean(route), label: "CloudFront route exists" },
    { ok: commandExists("aws"), label: "aws CLI available" },
    { ok: commandExists("npx"), label: "npx available for screenshot fallback" }
  ];

  if (args.runChecks) {
    checks.push(runProofCommand("npm run build", ["npm", ["run", "build"]]));
    checks.push(runProofCommand("npm test", ["npm", ["test"]]));
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
  }

  printGateReport(report);
  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0 || report.errors.length > 0) {
    throw new Error(`Launch check failed with ${failures.length + report.errors.length} issue(s).`);
  }
}

function makeOutreach(args) {
  const data = readOutreachData(args);
  const message = buildOutreachMessage(data, args.benefit || args.reason || "findability");
  if (args.out) {
    const output = path.resolve(args.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, message);
    console.log(`Wrote ${output}`);
  } else {
    console.log(message);
  }
}

function screenshotAudit(args) {
  const siteDir = resolveExistingOrNamedSiteDir(args);
  const screenshotDir = path.resolve(args.source || args.dir || args.screenshots || path.join(siteDir, "screenshots"));
  const report = auditScreenshots(screenshotDir, args);
  printGateReport(report);
  if (report.errors.length > 0) {
    throw new Error(`Screenshot audit failed with ${report.errors.length} error(s).`);
  }
}

async function publishSite(args) {
  const siteDir = resolvePublishSiteDir(args);
  const inputPath = args.input || path.join(siteDir, "site.input.json");
  const template = args.template || "real-estate";
  if (fs.existsSync(path.resolve(inputPath))) {
    await makeSite({ ...args, input: inputPath, dir: siteDir, template });
  }

  const configPath = path.join(siteDir, "site.config.json");
  const config = validateAndReadConfig(configPath);
  const folder = resolveFolder({ env: {}, args: { folder: args.folder }, config });

  const auditReport = auditSiteDir(siteDir, args);
  printGateReport(auditReport);
  if (auditReport.errors.length > 0) {
    throw new Error("Publish stopped because site audit failed.");
  }

  ensureRoute({
    router: args.router || path.join("cloudfront", "domain-folder-router.js"),
    host: args.host || `${folder}.syncpoly.com`,
    folder,
    template
  });

  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
  execFileSync("npm", ["test"], { stdio: "inherit" });

  if (!args.skipUpload) {
    if (!args.skipTemplate && !args.skipTemplateUpload) {
      await uploadTemplate({
        ...args,
        templateName: template,
        source: args.templateSource || args.templateOut
      });
    } else {
      console.log("Skipped template upload because --skip-template-upload was set.");
    }
    await uploadConfig({ ...args, file: configPath, folder });
    const mediaDir = path.join(siteDir, "media");
    if (fs.existsSync(mediaDir)) {
      await uploadMedia({ ...args, source: mediaDir, folder });
    }
    await uploadSeo({ ...args, source: siteDir, folder });
  } else {
    console.log("Skipped uploads because --skip-upload was set.");
  }

  if (!args.skipDns) {
    await addCname({ ...args, name: folder });
  } else {
    console.log("Skipped DNS because --skip-dns was set.");
  }
}

async function addCname(args) {
  const config = readOptionalConfig(args);
  const domain = args.domain || process.env.GODADDY_DOMAIN;
  const name = resolveCnameName(args, config);
  const value =
    args.value ||
    args.target ||
    process.env.CNAME_VALUE ||
    process.env.CNAME_TARGET ||
    process.env.CLOUDFRONT_DOMAIN_NAME;
  const ttl = args.ttl || process.env.CNAME_TTL || 600;
  const record = buildCnameRecord({ name, value, ttl });

  if (isDryRun(args)) {
    console.log(`DRY RUN: ${describeCname({ domain, record })}`);
    return;
  }

  await addGoDaddyRecord({
    domain,
    apiKey: process.env.GODADDY_API_KEY,
    apiSecret: process.env.GODADDY_API_SECRET,
    record
  });
  console.log(`Added ${describeCname({ domain, record })}`);
}

async function previewSite(args) {
  const siteDir = resolveSiteDir(args);
  const configPath = path.join(siteDir, "site.config.json");
  const config = validateAndReadConfig(configPath);
  const folder = resolveFolder({
    env: {},
    args: { folder: args.folder || args._[0] },
    config
  });
  const templateRoot = resolveTemplateRoot(args, args.templateName || process.env.SITE_TEMPLATE || "service", args.template);
  const templateOut = path.join(templateRoot, "out");

  if (!fs.existsSync(templateOut)) {
    throw new Error(`Template static output does not exist: ${templateOut}`);
  }

  const previewRoot = path.resolve(args.out || args.previewRoot || path.join("tmp", "site-preview", folder));
  const previewOut = path.join(previewRoot, "out");
  fs.rmSync(previewOut, { recursive: true, force: true });
  fs.mkdirSync(previewRoot, { recursive: true });
  fs.cpSync(templateOut, previewOut, { recursive: true });
  copySitePreviewFiles(siteDir, previewOut);

  const host = args.host || process.env.HOST || "127.0.0.1";
  const port = parsePreviewPort(args.port || process.env.PORT || 4173);
  const url = `http://${host}:${port}`;
  console.log(`Prepared local preview in ${previewOut}`);

  if (args.noServe) {
    console.log(`Run without --no-serve to serve ${url}`);
    return;
  }

  const server = createPreviewServer(previewOut);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Serving local preview at ${url}`);
}

async function screenshotSite(args) {
  const siteDir = resolveExistingOrNamedSiteDir(args);
  const configPath = path.join(siteDir, "site.config.json");
  if (fs.existsSync(configPath)) {
    validateAndReadConfig(configPath);
  }

  const url = args.url || args._[0] || process.env.SITE_PREVIEW_URL || "http://127.0.0.1:4173/";
  const outDir = path.resolve(args.out || args.screenshots || path.join(siteDir, "screenshots"));
  fs.mkdirSync(outDir, { recursive: true });

  const viewports = [
    { name: "desktop", width: parseViewportNumber(args.desktopWidth, 1440), height: parseViewportNumber(args.desktopHeight, 1100) },
    { name: "mobile", width: parseViewportNumber(args.mobileWidth, 390), height: parseViewportNumber(args.mobileHeight, 1100) }
  ];

  const browserType = loadPlaywrightChromium();
  if (!browserType) {
    runPlaywrightCliScreenshots({ args, url, outDir, viewports });
    return;
  }

  const browser = await browserType.launch();
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.name === "mobile" ? 2 : 1,
        isMobile: viewport.name === "mobile"
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: parseViewportNumber(args.timeout, 30000) });
      await page.screenshot({
        path: path.join(outDir, `${viewport.name}.png`),
        fullPage: args.fullPage !== false
      });
      await page.close();
      console.log(`Wrote ${path.join(outDir, `${viewport.name}.png`)}`);
    }
  } finally {
    await browser.close();
  }
}

function resolveSiteDir(args) {
  const explicit = args.site || args.source || args.dir;
  if (explicit) {
    return requirePath(explicit, "site");
  }

  const folder = args.folder || args._[0];
  if (folder) {
    return requirePath(path.join("sites", folder), "site");
  }

  throw new Error("Missing --site. Pass ./sites/<unique-name>.");
}

function readSiteInput(args) {
  const inputFile = args.input || args.source || process.env.SITE_INPUT;
  if (!inputFile) {
    return buildInputFromArgs(args);
  }

  const resolved = requirePath(inputFile, "input");
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function buildInputFromArgs(args) {
  const name = args.name || args.businessName || args.site || args.folder || args._[0];
  if (!name) {
    throw new Error("Missing --input or --site/--name for make-siteconfig.");
  }

  return {
    site: {
      name,
      description: args.description || `${name} website.`
    },
    business: {
      industry: args.industry || "Business"
    },
    contact: {
      phone: args.phone,
      email: args.email,
      whatsapp: args.whatsapp,
      bookingHref: args.bookingUrl || args.bookingHref
    },
    booking: {
      label: args.bookingLabel || "Book now",
      href: args.bookingUrl || args.bookingHref
    },
    media: {
      hero: args.hero || args.image,
      logo: args.logo,
      favicon: args.favicon
    },
    copy: {
      headline: args.headline,
      subheadline: args.subheadline,
      ctaLabel: args.ctaLabel
    },
    services: args.service ? String(args.service).split("|").map((title) => ({ title, body: args.description || `${title} from ${name}.` })) : undefined,
    pricing: parsePricingEntries(args.pricing),
    map: args.map || args.address ? { query: args.map || args.address } : undefined,
    keywords: args.keywords ? String(args.keywords).split(",").map((keyword) => keyword.trim()).filter(Boolean) : undefined
  };
}

function parsePricingEntries(pricing) {
  if (!pricing) {
    return undefined;
  }

  return String(pricing)
    .split("|")
    .map((entry) => {
      const [title, price, body, features] = entry.split(":");
      return {
        title,
        price,
        body,
        features: features ? features.split(",").map((feature) => feature.trim()).filter(Boolean) : undefined
      };
    })
    .filter((item) => item.title);
}

function resolveMakeSiteDir(args, input) {
  if (args.dir || args.siteDir) {
    return path.resolve(args.dir || args.siteDir);
  }

  const folder = normalizeMakeSiteName(args, input);
  return path.resolve("sites", folder);
}

function resolveExistingOrNamedSiteDir(args) {
  const explicit = args.site || args.source || args.dir;
  if (explicit && fs.existsSync(path.resolve(explicit))) {
    return requirePath(explicit, "site");
  }

  const folder = args.folder || args.site || args._[0];
  if (folder) {
    return requirePath(path.join("sites", folder), "site");
  }

  throw new Error("Missing --site or --folder.");
}

function normalizeMakeSiteName(args, input) {
  const config = buildSiteConfig(input, {
    site: args.site || args.folder || args._[0],
    theme: args.theme || process.env.SITE_THEME,
    updatedAt: args.updatedAt
  });
  return config.syncpoly.folder;
}

function resolveMakeInputDir(args, input) {
  if (args.dir || args.siteDir) {
    return path.resolve(args.dir || args.siteDir);
  }

  const siteName =
    args.site ||
    args.folder ||
    args._[0] ||
    input.syncpoly?.folder ||
    input.site?.slug ||
    input.site?.folder ||
    input.slug ||
    input.name ||
    input.business?.name ||
    input.site?.name;
  const folder = normalizeFolderName(siteName);
  if (!folder) {
    throw new Error("Missing --site, --folder, or site.name for make-input.");
  }
  return path.resolve("sites", folder);
}

function resolvePublishSiteDir(args) {
  if (args.site || args.source || args.dir) {
    return resolveSiteDir(args);
  }

  const folder = args.folder || args._[0];
  if (folder) {
    return path.resolve("sites", normalizeFolderName(folder));
  }

  throw new Error("Missing --site or --folder for publish.");
}

function maybeApplyMediaManifest(input, mediaSource) {
  if (!mediaSource || !fs.existsSync(path.resolve(mediaSource))) {
    return input;
  }

  const manifest = buildMediaManifest(path.resolve(mediaSource));
  return {
    ...input,
    media: {
      ...manifest.suggested,
      ...stripEmptyObject(input.media || {})
    }
  };
}

function stripEmptyObject(value) {
  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue === undefined || nestedValue === null || nestedValue === "") {
      continue;
    }
    output[key] = nestedValue;
  }
  return output;
}

function resolveMediaSource(args) {
  const explicit = args.source || args.media;
  if (explicit) {
    return requirePath(explicit, "source");
  }

  const siteDir = resolveExistingOrNamedSiteDir(args);
  return requirePath(path.join(siteDir, "media"), "source");
}

function buildMediaManifest(source) {
  const sourceRoot = fs.statSync(source).isDirectory() ? source : path.dirname(source);
  const files = listFiles(source)
    .filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => {
      const relativePath = path.relative(sourceRoot, file).replace(/\\/g, "/");
      const mediaPath = `/media/${relativePath}`;
      return {
        file,
        relativePath,
        mediaPath,
        role: guessMediaRole(relativePath),
        bytes: fs.statSync(file).size
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const logo = firstRole(files, "logo");
  const favicon = firstRole(files, "favicon");
  const ogImage = firstRole(files, "og");
  const hero = firstRole(files, "hero") || firstGalleryCandidate(files);
  const gallery = files
    .filter((file) => file.role !== "logo" && file.role !== "favicon" && file.role !== "og")
    .map((file) => ({ src: file.mediaPath, alt: titleFromFileName(file.relativePath) }));

  return {
    source: path.resolve(sourceRoot),
    files,
    suggested: {
      ...(hero ? { hero: hero.mediaPath, heroAlt: titleFromFileName(hero.relativePath) } : {}),
      ...(logo ? { logo: logo.mediaPath } : {}),
      ...(favicon ? { favicon: favicon.mediaPath } : {}),
      ...(ogImage ? { ogImage: ogImage.mediaPath } : {}),
      ...(gallery.length > 0 ? { gallery } : {})
    }
  };
}

function printMediaManifest(manifest) {
  console.log(`Media source: ${manifest.source}`);
  for (const file of manifest.files) {
    console.log(`${file.role.padEnd(8)} ${file.mediaPath} (${file.bytes} bytes)`);
  }
  console.log("Suggested:");
  console.log(JSON.stringify(manifest.suggested, null, 2));
}

function guessMediaRole(relativePath) {
  const name = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
  if (name.includes("favicon") || name === "icon") return "favicon";
  if (name.includes("logo") || name.includes("brand")) return "logo";
  if (name.includes("og") || name.includes("social")) return "og";
  if (name.includes("hero") || name.includes("cover") || name.includes("main")) return "hero";
  return "gallery";
}

function firstRole(files, role) {
  return files.find((file) => file.role === role);
}

function firstGalleryCandidate(files) {
  return files.find((file) => file.role === "gallery" && path.extname(file.relativePath).toLowerCase() !== ".svg") ||
    files.find((file) => file.role === "gallery");
}

function titleFromFileName(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function auditSiteDir(siteDir, args = {}) {
  const report = { errors: [], warnings: [], passes: [] };
  const configPath = path.join(siteDir, "site.config.json");
  const requiredFiles = ["site.config.json", "robots.txt", "sitemap.xml", "llms.txt"];

  for (const fileName of requiredFiles) {
    const exists = fs.existsSync(path.join(siteDir, fileName));
    report[exists ? "passes" : "errors"].push(`${fileName} ${exists ? "exists" : "is missing"}`);
  }

  if (!fs.existsSync(configPath)) {
    return report;
  }

  let config;
  try {
    config = validateAndReadConfig(configPath);
    report.passes.push("site.config.json validates");
  } catch (error) {
    report.errors.push(error.message);
    return report;
  }

  const refs = collectConfigRefs(config);
  const mediaRefs = refs.filter((ref) => ref.startsWith("/media/"));
  const assetImageRefs = refs.filter((ref) => ref.startsWith("/assets/") && MEDIA_EXTENSIONS.has(path.extname(ref).toLowerCase()));
  for (const ref of assetImageRefs) {
    report.errors.push(`Tenant image reference must use /media, not ${ref}`);
  }

  for (const ref of mediaRefs) {
    const filePath = path.join(siteDir, ref.replace(/^\/media\//, "media/"));
    if (fs.existsSync(filePath)) {
      report.passes.push(`${ref} exists`);
    } else {
      report.errors.push(`${ref} is referenced but missing`);
    }
  }

  const mediaDir = path.join(siteDir, "media");
  const mediaFiles = fs.existsSync(mediaDir)
    ? listFiles(mediaDir)
        .filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()))
        .map((file) => `/media/${path.relative(mediaDir, file).replace(/\\/g, "/")}`)
    : [];
  if (mediaFiles.length === 0) {
    report.warnings.push("media directory has no image files");
  }

  const mediaRefSet = new Set(mediaRefs);
  for (const mediaFile of mediaFiles) {
    if (!mediaRefSet.has(mediaFile)) {
      report.warnings.push(`${mediaFile} exists but is not referenced in site.config.json`);
    }
  }

  const seoImage = config.seo?.defaultImage;
  if (seoImage?.startsWith("/media/") && !fs.existsSync(path.join(siteDir, seoImage.replace(/^\/media\//, "media/")))) {
    report.errors.push(`seo.defaultImage ${seoImage} is missing`);
  }

  const home = config.pages?.find((page) => normalizePagePathForAudit(page.path) === "/");
  const firstSection = home?.sections?.[0]?.use ? config.blocks?.[home.sections[0].use] : home?.sections?.[0];
  if (!firstSection || firstSection.type !== "hero") {
    report.errors.push("home page first section must be a hero");
  } else if (!hasHeroMedia(firstSection)) {
    report.errors.push("home page hero must include background, media, or mediaItems");
  } else {
    report.passes.push("home hero has visible media");
  }

  const routeHost = args.host || `${resolveFolder({ env: {}, args: { folder: args.folder }, config })}.syncpoly.com`;
  if (readRoute(args.router || path.join("cloudfront", "domain-folder-router.js"), routeHost)) {
    report.passes.push(`route exists for ${routeHost}`);
  } else {
    report.warnings.push(`route is missing for ${routeHost}`);
  }

  return report;
}

function collectConfigRefs(value, refs = []) {
  if (typeof value === "string") {
    if (value.startsWith("/media/") || value.startsWith("/assets/")) {
      refs.push(value);
    }
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConfigRefs(item, refs);
    return refs;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectConfigRefs(item, refs);
  }
  return refs;
}

function hasHeroMedia(section) {
  return Boolean(
    section.background?.value ||
      section.media?.src ||
      section.media?.url ||
      (Array.isArray(section.mediaItems) && section.mediaItems.length > 0)
  );
}

function normalizePagePathForAudit(pagePath) {
  if (!pagePath || pagePath === "/") return "/";
  return `/${String(pagePath).replace(/^\/+|\/+$/g, "")}/`;
}

function printGateReport(report) {
  for (const pass of report.passes) console.log(`PASS ${pass}`);
  for (const warning of report.warnings) console.log(`WARN ${warning}`);
  for (const error of report.errors) console.log(`FAIL ${error}`);
}

function resolveRouteArgs(args) {
  const config = args.config && fs.existsSync(path.resolve(args.config)) ? validateAndReadConfig(path.resolve(args.config)) : undefined;
  const folder = normalizeFolderName(args.folder || args.site || args._[0] || (config ? resolveFolder({ env: {}, args: {}, config }) : ""));
  if (!folder) {
    throw new Error("Missing --site or --folder for add-route.");
  }
  return {
    router: args.router || path.join("cloudfront", "domain-folder-router.js"),
    host: args.host || `${folder}.syncpoly.com`,
    folder,
    template: args.template || "real-estate"
  };
}

function ensureRoute({ router, host, folder, template }) {
  const routerPath = path.resolve(router);
  const source = fs.readFileSync(routerPath, "utf8");
  const existing = readRoute(routerPath, host);
  if (existing) {
    if (existing.folder === folder && existing.template === template) {
      return { changed: false, message: `Route already exists for ${host}` };
    }
    throw new Error(`Route for ${host} already exists with folder "${existing.folder}" and template "${existing.template}".`);
  }

  const entry = `    "${host}": { folder: "${folder}", template: "${template}" },`;
  let updated;
  if (source.includes("    // real\n")) {
    updated = source.replace("    // real\n", `    // real\n${entry}\n`);
  } else {
    updated = source.replace(/\n\s*};\n\n\s*var site = sitesByHost\[host\];/, `\n${entry}\n  };\n\n  var site = sitesByHost[host];`);
  }
  if (updated === source) {
    throw new Error("Could not find sitesByHost insertion point.");
  }
  fs.writeFileSync(routerPath, updated);
  return { changed: true, message: `Added route ${host} -> ${folder} (${template})` };
}

function readRoute(router, host) {
  const routerPath = path.resolve(router);
  if (!fs.existsSync(routerPath)) return null;
  const source = fs.readFileSync(routerPath, "utf8");
  const escapedHost = escapeRegExp(host);
  const pattern = new RegExp(`"${escapedHost}"\\s*:\\s*\\{\\s*folder:\\s*"([^"]+)"\\s*,\\s*template:\\s*"([^"]+)"\\s*\\}`);
  const match = source.match(pattern);
  return match ? { folder: match[1], template: match[2] } : null;
}

function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runProofCommand(label, [command, commandArgs]) {
  try {
    execFileSync(command, commandArgs, { stdio: "inherit" });
    return { ok: true, label };
  } catch (error) {
    return { ok: false, label, detail: `exit ${error.status || 1}` };
  }
}

function readOutreachData(args) {
  if (args.input) {
    return { input: JSON.parse(fs.readFileSync(requirePath(args.input, "input"), "utf8")) };
  }

  const siteDir = args.site || args.dir || args.folder || args._[0] ? resolveExistingOrNamedSiteDir(args) : "";
  if (siteDir) {
    const inputPath = path.join(siteDir, "site.input.json");
    if (fs.existsSync(inputPath)) {
      return { input: JSON.parse(fs.readFileSync(inputPath, "utf8")) };
    }
    const configPath = path.join(siteDir, "site.config.json");
    if (fs.existsSync(configPath)) {
      return { config: validateAndReadConfig(configPath) };
    }
  }

  return {
    input: buildInputFromArgs(args)
  };
}

function buildOutreachMessage(data, benefit) {
  const input = data.input || {};
  const config = data.config || {};
  const businessName = input.site?.name || input.business?.name || input.name || config.site?.name || "your business";
  const clientName = input.contact?.name || input.clientName || businessName;
  const benefitSentence = benefitSentenceFor(benefit);

  return [
    `Hi ${clientName},`,
    "",
    "My name is Karl-Johan Bailey. I am a software developer who creates websites and develops complex software systems for a living.",
    "",
    `I noticed ${benefitSentence}, so I went ahead and built a simple starter website for ${businessName}. I attached a few screenshots so you can see the idea.`,
    "",
    "There is no pressure or commitment at all. If you are interested, just message me and we can deploy this for you, then still adjust it based on your needs.",
    "",
    "For a website like this, it would have no upfront cost and would be $39.99 USD a month. You can request changes to the wording, images, content, theme, personalized domain, sections, colors, or anything else.",
    "",
    "If you want something more customized or specialized, we can schedule a quick discussion.",
    ""
  ].join("\n");
}

function benefitSentenceFor(benefit) {
  const benefits = {
    findability: "you did not have a website where people can find you on Google Search or tools like ChatGPT",
    professionalism: "you did not have a website to make the business look more professional and easier to trust",
    bookings: "you did not have a website where people can quickly understand your services and contact you",
    services: "you did not have a website where people can quickly understand your services and contact you",
    "real-estate": "you did not have a website where people can see the property, location, amenities, and inquiry details",
    restaurant: "you did not have a website where people can quickly see your menu, hours, photos, and contact details",
    creative: "you did not have a website where people can see your style, portfolio, and booking details",
    retail: "you did not have a website where people can find your products, hours, location, and updates"
  };
  return benefits[benefit] || benefits.findability;
}

function auditScreenshots(screenshotDir, args = {}) {
  const report = { errors: [], warnings: [], passes: [] };
  const expected = args.files ? String(args.files).split(",") : ["desktop.png", "mobile.png"];
  for (const fileName of expected) {
    const filePath = path.join(screenshotDir, fileName.trim());
    if (!fs.existsSync(filePath)) {
      report.errors.push(`${fileName} is missing`);
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      report.errors.push(`${fileName} is empty`);
      continue;
    }
    const png = readPngHeader(filePath);
    if (!png) {
      report.warnings.push(`${fileName} is not a PNG with a readable header`);
    } else {
      report.passes.push(`${fileName} is ${png.width}x${png.height} and ${stat.size} bytes`);
    }
    const blank = isLikelyBlankImage(filePath);
    if (blank === true) {
      report.errors.push(`${fileName} appears blank or nearly uniform`);
    } else if (blank === null) {
      report.warnings.push(`${fileName} blank-image check skipped because sharp is unavailable`);
    } else {
      report.passes.push(`${fileName} has visible pixel variation`);
    }
  }
  return report;
}

function readPngHeader(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function isLikelyBlankImage(filePath) {
  try {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        [
          "const sharp=require('sharp');",
          "sharp(process.argv[1]).stats().then((stats)=>{",
          "const max=Math.max(...stats.channels.map((channel)=>channel.stdev||0));",
          "console.log(max < 1.5 ? 'blank' : 'visible');",
          "}).catch(()=>process.exit(2));"
        ].join(""),
        filePath
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return output === "blank";
  } catch {
    return null;
  }
}

function copySitePreviewFiles(siteDir, previewOut) {
  for (const fileName of ["site.config.json", "robots.txt", "robot.txt", "sitemap.xml", "llms.txt", "llm.txt"]) {
    const source = path.join(siteDir, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(previewOut, fileName));
    }
  }

  const mediaDir = path.join(siteDir, "media");
  if (fs.existsSync(mediaDir)) {
    fs.rmSync(path.join(previewOut, "media"), { recursive: true, force: true });
    fs.cpSync(mediaDir, path.join(previewOut, "media"), { recursive: true });
  }
}

function parsePreviewPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("preview port must be between 1 and 65535.");
  }
  return port;
}

function parseViewportNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("viewport and timeout values must be positive integers.");
  }
  return number;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadPlaywrightChromium() {
  try {
    return require("playwright").chromium;
  } catch {
    return null;
  }
}

function runPlaywrightCliScreenshots({ args, url, outDir, viewports }) {
  for (const viewport of viewports) {
    const output = path.join(outDir, `${viewport.name}.png`);
    const command = [
      "playwright",
      "screenshot",
      "--browser",
      "chromium",
      "--viewport-size",
      `${viewport.width},${viewport.height}`,
      "--timeout",
      String(parseViewportNumber(args.timeout, 30000))
    ];
    if (args.fullPage !== false) {
      command.push("--full-page");
    }
    command.push(url, output);
    execFileSync("npx", command, { stdio: "inherit" });
    console.log(`Wrote ${output}`);
  }
}

function createPreviewServer(root) {
  const contentTypes = {
    ".avif": "image/avif",
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".webp": "image/webp",
    ".xml": "application/xml; charset=utf-8"
  };

  return http.createServer((request, response) => {
    const file = resolvePreviewPath(root, request.url || "/") || path.join(root, "404.html");
    const statusCode = file.endsWith(`${path.sep}404.html`) ? 404 : 200;
    response.writeHead(statusCode, {
      "content-type": contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream"
    });
    fs.createReadStream(file).pipe(response);
  });
}

function resolvePreviewPath(root, url) {
  const requested = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const clean = path.normalize(requested).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const candidates = [
    path.join(root, clean),
    path.join(root, clean, "index.html"),
    path.join(root, `${clean}.html`),
    path.join(root, "index.html")
  ];

  return candidates.find((candidate) => {
    if (!candidate.startsWith(root)) {
      return false;
    }
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
}

function resolveCnameName(args, config) {
  const name =
    args.name ||
    args.record ||
    args._[0] ||
    args.site ||
    process.env.CNAME_NAME ||
    process.env.DNS_RECORD_NAME ||
    process.env.SITE_SUBDOMAIN;

  if (name) {
    return name;
  }

  const siteUrl = args.siteUrl || args.url || process.env.SITE_URL || config?.site?.url;
  if (siteUrl) {
    return cnameNameFromUrl(siteUrl);
  }

  throw new Error("CNAME record name is required. Pass --name, a positional name, --site-url, or --config.");
}

function cnameNameFromUrl(siteUrl) {
  let host = "";
  try {
    host = new URL(siteUrl).hostname;
  } catch {
    host = String(siteUrl);
  }

  const cleanHost = host.trim().toLowerCase().replace(/^www\./, "");
  const domain = (process.env.GODADDY_DOMAIN || "").trim().toLowerCase().replace(/^www\./, "");

  if (domain && cleanHost.endsWith(`.${domain}`)) {
    return cleanHost.slice(0, -(domain.length + 1));
  }

  return cleanHost.split(".")[0];
}

function resolveTarget(args, config) {
  return {
    bucket: resolveBucket(process.env, args, config),
    folder: resolveFolder({ env: process.env, args, config })
  };
}

function readOptionalConfig(args) {
  const configPath = args.config || process.env.SITE_CONFIG;
  return configPath ? validateAndReadConfig(configPath) : undefined;
}

function requirePath(value, label) {
  if (!value) {
    throw new Error(`Missing --${label}.`);
  }

  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  return resolved;
}

function parseTemplateNames(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => normalizeFolderName(item))
    .filter(Boolean);
}

function readTemplateRegistry(args = {}) {
  const registryPath = path.resolve(args.templateRegistry || process.env.SITE_TEMPLATE_REGISTRY || path.join("templates", "templates.json"));
  if (!fs.existsSync(registryPath)) {
    return {
      templates: {
        service: { source: "next-static-config-template" },
        "real-estate": { source: "next-static-config-template" },
        "pressure-washer": { source: "next-static-config-template" }
      }
    };
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!registry || typeof registry !== "object" || !registry.templates || typeof registry.templates !== "object") {
    throw new Error(`Template registry must contain a templates object: ${registryPath}`);
  }
  return registry;
}

function resolveTemplateEntry(args = {}, templateName = "") {
  const registry = readTemplateRegistry(args);
  return registry.templates?.[templateName] || { source: templateName || "next-static-config-template" };
}

function resolveTemplateRoot(args = {}, templateName = "", explicitRoot) {
  if (explicitRoot && fs.existsSync(path.resolve(explicitRoot))) {
    return path.resolve(explicitRoot);
  }

  if (args.templateRoot || process.env.SITE_TEMPLATE_DIR || process.env.TEMPLATE_DIR) {
    return path.resolve(args.templateRoot || process.env.SITE_TEMPLATE_DIR || process.env.TEMPLATE_DIR);
  }

  const entry = resolveTemplateEntry(args, templateName);
  const source = entry.source || "next-static-config-template";
  const localRoot = path.resolve("templates", source);
  if (fs.existsSync(localRoot)) {
    return localRoot;
  }

  return path.resolve("/workspace/templates", source);
}

function resolveTemplateOut(args = {}, templateName = "") {
  if (args.source || args.dir || process.env.SITE_TEMPLATE_OUT) {
    return args.source || args.dir || process.env.SITE_TEMPLATE_OUT;
  }

  return path.join(resolveTemplateRoot(args, templateName), "out");
}

function isDryRun(args) {
  return args.dryRun || process.env.DRY_RUN === "1";
}

function awsProfile(args) {
  return args.profile || process.env.AWS_PROFILE;
}

function printUploads(uploads) {
  for (const upload of uploads) {
    console.log(upload.command);
  }
}

function loadEnvFile(envFile) {
  if (!envFile) {
    return;
  }

  const envPath = path.resolve(envFile);
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = parseEnvValue(match[2] || "");
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];

  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  const hashIndex = value.indexOf("#");
  return (hashIndex === -1 ? value : value.slice(0, hashIndex)).trim();
}

function printHelp() {
  console.log(`Usage:
  syncpoly-site make-input --site example --name "Example Co" --industry "Villa rental" --phone "+1 555 0100" --booking-url "https://example.com/book" --whatsapp "+1 555 0100" --pricing "Consultation:Free:Quick scope call|Standard:From $199:Most service visits" --map "Port of Spain, Trinidad"
  syncpoly-site make-site --input ./sites/example/site.input.json --site example --template service [--theme service]
  syncpoly-site make-siteconfig --input ./sites/example/site.input.json --site example --template real-estate [--theme real-estate]
  syncpoly-site make-seo --site ./sites/example
  syncpoly-site media-manifest --site ./sites/example
  syncpoly-site audit-site --site ./sites/example
  syncpoly-site add-route --site example --template real-estate
  syncpoly-site launch-check --site ./sites/example [--run-checks]
  syncpoly-site make-outreach --site ./sites/example --benefit findability
  syncpoly-site list-themes
  syncpoly-site upload-template --template-name service --source /workspace/templates/next-static-config-template/out [--profile prod]
  syncpoly-site upload-templates [--templates service,real-estate]
  syncpoly-site upload-config --file ./site.config.json [--folder site-folder]
  syncpoly-site upload-media --source ./media --config ./site.config.json [--max-width 1920] [--quality 78] [--no-webp]
  syncpoly-site upload-seo --source ./seo --config ./site.config.json
  syncpoly-site upload-folder --source ./folder --prefix files --folder site-folder
  syncpoly-site validate-config --file ./site.config.json
  syncpoly-site add-cname aurum-eco-power-wash --domain syncpoly.com --value d111111abcdef8.cloudfront.net
  syncpoly-site add-cname --config ./site.config.json --value d111111abcdef8.cloudfront.net
  syncpoly-site preview --site ./sites/example --template /workspace/templates/next-static-config-template --port 4173
  syncpoly-site screenshot --site ./sites/example --url http://127.0.0.1:4173/ --out ./sites/example/screenshots
  syncpoly-site screenshot-audit --site ./sites/example
  syncpoly-site publish --site ./sites/example --template real-estate [--skip-upload] [--skip-dns]

Environment:
  ENV_FILE                           Optional env file path. Defaults to .env in the current directory.
  SITE_INPUT                         Optional input JSON for make-site/make-siteconfig.
  SITE_THEME                         Explicit theme preset for make-site/make-siteconfig. Overrides template defaults.
  SITE_TEMPLATE                      Template name used to pick the default theme preset. service -> service, real-estate -> real-estate.
  Service input flags                make-input/make-siteconfig support --booking-url, --booking-label, --whatsapp, --pricing, and --map.
                                      Pricing format: "Title:Price:Body:Feature one,Feature two|Next:From $99:Details".
  CONTENT_BUCKET or S3_BUCKET        Target S3 bucket. Defaults to syncpoly-web-builder-sites.
  SITE_FOLDER                        Target tenant folder. Overrides config-derived folder.
  SITE_CONFIG                        Config file used to validate and derive folder.
  SITE_PREVIEW_URL                   Preview URL for screenshot. Defaults to http://127.0.0.1:4173/.
  AWS_REGION                         Optional AWS CLI region.
  SITE_MEDIA_MAX_WIDTH               Max uploaded image width. Defaults to 1920.
  SITE_MEDIA_MAX_HEIGHT              Max uploaded image height. Defaults to 1920.
  SITE_MEDIA_QUALITY                 JPEG/WebP quality from 1-100. Defaults to 78.
  SITE_MEDIA_WEBP=0                  Disable generated .webp variants.
  SITE_UPLOAD_PREFIX                 Prefix for upload-folder. Image files are rejected unless the target prefix is media.
  SITE_TEMPLATE_OUT                  Static template export used by upload-template. Defaults to <template>/out.
  SITE_TEMPLATE_REGISTRY             JSON registry of template types. Defaults to templates/templates.json.
  GODADDY_API_KEY                    GoDaddy production API key.
  GODADDY_API_SECRET                 GoDaddy production API secret.
  GODADDY_DOMAIN                     Domain to modify, for example syncpoly.com.
  CNAME_NAME                         Optional default record name. CLI input or config-derived name wins.
  SITE_URL                           Optional URL used to derive the record name.
  CNAME_VALUE                        CNAME target, for example CloudFront domain name.
  SITE_TEMPLATE_DIR                  Template directory used by preview.
  DRY_RUN=1                          Print aws commands without uploading.
`);
}
