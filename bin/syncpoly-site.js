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
  const prepared = await prepareCompressedMedia({
    source,
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
  const domain = args.domain || process.env.GODADDY_DOMAIN;
  const name = args.name || process.env.CNAME_NAME || process.env.DNS_RECORD_NAME;
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

function printHelp() {
  console.log(`Usage:
  syncpoly-site upload-config --file ./site.config.json [--folder site-folder]
  syncpoly-site upload-media --source ./media --config ./site.config.json
  syncpoly-site upload-seo --source ./seo --config ./site.config.json
  syncpoly-site upload-folder --source ./folder --prefix assets --folder site-folder
  syncpoly-site validate-config --file ./site.config.json
  syncpoly-site add-cname --domain syncpoly.com --name aurum-eco-power-wash --value d111111abcdef8.cloudfront.net

Environment:
  CONTENT_BUCKET or S3_BUCKET        Target S3 bucket. Defaults to syncpoly-web-builder-sites.
  SITE_FOLDER                        Target tenant folder. Overrides config-derived folder.
  SITE_CONFIG                        Config file used to validate and derive folder.
  AWS_REGION                         Optional AWS CLI region.
  GODADDY_API_KEY                    GoDaddy production API key.
  GODADDY_API_SECRET                 GoDaddy production API secret.
  GODADDY_DOMAIN                     Domain to modify, for example syncpoly.com.
  CNAME_NAME                         CNAME record name, for example aurum-eco-power-wash.
  CNAME_VALUE                        CNAME target, for example CloudFront domain name.
  DRY_RUN=1                          Print aws commands without uploading.
`);
}
