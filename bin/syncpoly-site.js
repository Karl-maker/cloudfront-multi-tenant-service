#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  parseArgs,
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
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  loadEnvFile(args.envFile || process.env.ENV_FILE || ".env");

  if (!command || args.help) {
    printHelp();
    return;
  }

  if (command === "upload-folder") {
    await uploadFolder(args);
  } else if (command === "upload-media") {
    await uploadMedia(args);
  } else if (command === "upload-seo") {
    await uploadSeo(args);
  } else if (command === "upload-config") {
    await uploadConfig(args);
  } else if (command === "validate-config") {
    await validateConfig(args);
  } else if (command === "add-cname") {
    await addCname(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

async function uploadFolder(args) {
  const source = requirePath(args.source || args.dir || process.env.SITE_UPLOAD_SOURCE, "source");
  const config = readOptionalConfig(args);
  const target = resolveTarget(args, config);
  const sourceRoot = fs.statSync(source).isDirectory() ? source : path.dirname(source);
  const uploads = uploadFiles({
    files: listFiles(source),
    sourceRoot,
    bucket: target.bucket,
    folder: target.folder,
    prefix: args.prefix || process.env.SITE_UPLOAD_PREFIX || "",
    dryRun: isDryRun(args),
    region: process.env.AWS_REGION
  });
  printUploads(uploads);
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
    region: process.env.AWS_REGION
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
    region: process.env.AWS_REGION
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
      region: process.env.AWS_REGION
    })
  ];
  printUploads(uploads);
}

async function validateConfig(args) {
  const file = requirePath(args.file || args.config || process.env.SITE_CONFIG, "file");
  validateAndReadConfig(file);
  console.log(`${file} validation passed.`);
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

function isDryRun(args) {
  return args.dryRun || process.env.DRY_RUN === "1";
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
  syncpoly-site upload-config --file ./site.config.json [--folder site-folder]
  syncpoly-site upload-media --source ./media --config ./site.config.json [--max-width 1920] [--quality 78] [--no-webp]
  syncpoly-site upload-seo --source ./seo --config ./site.config.json
  syncpoly-site upload-folder --source ./folder --prefix assets --folder site-folder
  syncpoly-site validate-config --file ./site.config.json
  syncpoly-site add-cname aurum-eco-power-wash --domain syncpoly.com --value d111111abcdef8.cloudfront.net
  syncpoly-site add-cname --config ./site.config.json --value d111111abcdef8.cloudfront.net

Environment:
  ENV_FILE                           Optional env file path. Defaults to .env in the current directory.
  CONTENT_BUCKET or S3_BUCKET        Target S3 bucket. Defaults to syncpoly-web-builder-sites.
  SITE_FOLDER                        Target tenant folder. Overrides config-derived folder.
  SITE_CONFIG                        Config file used to validate and derive folder.
  AWS_REGION                         Optional AWS CLI region.
  SITE_MEDIA_MAX_WIDTH               Max uploaded image width. Defaults to 1920.
  SITE_MEDIA_MAX_HEIGHT              Max uploaded image height. Defaults to 1920.
  SITE_MEDIA_QUALITY                 JPEG/WebP quality from 1-100. Defaults to 78.
  SITE_MEDIA_WEBP=0                  Disable generated .webp variants.
  GODADDY_API_KEY                    GoDaddy production API key.
  GODADDY_API_SECRET                 GoDaddy production API secret.
  GODADDY_DOMAIN                     Domain to modify, for example syncpoly.com.
  CNAME_NAME                         Optional default record name. CLI input or config-derived name wins.
  SITE_URL                           Optional URL used to derive the record name.
  CNAME_VALUE                        CNAME target, for example CloudFront domain name.
  DRY_RUN=1                          Print aws commands without uploading.
`);
}
