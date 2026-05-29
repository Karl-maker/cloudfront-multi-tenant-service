"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { deriveFolderFromConfig, normalizeFolderName, validateSiteConfig } = require("./site-config-schema");

const MEDIA_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp"
]);

const SEO_FILE_NAMES = new Set([
  "llm.txt",
  "llms.txt",
  "sitemap.xml",
  "robot.txt",
  "robots.txt",
  "favicon.ico",
  "favicon.png",
  "favicon.svg"
]);

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveBucket(env = process.env, args = {}, config) {
  return (
    args.bucket ||
    env.SITE_BUCKET ||
    env.CONTENT_BUCKET ||
    env.S3_BUCKET ||
    env.SYNCPOLY_S3_BUCKET ||
    config?.syncpoly?.bucket ||
    config?.deployment?.bucket ||
    "syncpoly-web-builder-sites"
  );
}

function resolveFolder({ env = process.env, args = {}, config } = {}) {
  const folder =
    args.folder ||
    env.SITE_FOLDER ||
    env.SYNCPOLY_SITE_FOLDER ||
    env.S3_SITE_FOLDER ||
    (config ? deriveFolderFromConfig(config) : "");

  if (!folder) {
    throw new Error("Site folder is required. Set SITE_FOLDER or provide a config with site.url.");
  }

  return normalizeFolderName(folder);
}

function normalizePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function listFiles(source) {
  const stat = fs.statSync(source);
  if (stat.isFile()) {
    return [source];
  }

  const files = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const fullPath = path.join(source, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".avif": "image/avif",
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".xml": "application/xml; charset=utf-8"
  };
  return types[ext] || "application/octet-stream";
}

function getCacheControl(filePath, kind = "general") {
  if (kind === "config" || path.basename(filePath) === "site.config.json") {
    return "no-cache, max-age=0";
  }

  if (kind === "seo" || SEO_FILE_NAMES.has(path.basename(filePath))) {
    return "no-cache, max-age=0";
  }

  return "public, max-age=31536000, immutable";
}

function s3Url(bucket, key) {
  return `s3://${bucket}/${key.replace(/^\/+/, "")}`;
}

function toS3Key({ folder, prefix = "", relativePath }) {
  const cleanPrefix = normalizePrefix(prefix);
  return [folder, cleanPrefix, relativePath.replace(/^\/+/, "")]
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/");
}

function runAwsS3Cp({ file, bucket, key, contentType, cacheControl, dryRun = false, region }) {
  const command = [
    "s3",
    "cp",
    file,
    s3Url(bucket, key),
    "--content-type",
    contentType,
    "--cache-control",
    cacheControl
  ];

  if (region) {
    command.push("--region", region);
  }

  if (dryRun) {
    return { dryRun: true, command: ["aws", ...command].map(shellQuote).join(" ") };
  }

  execFileSync("aws", command, { stdio: "inherit" });
  return { dryRun: false, command: ["aws", ...command].map(shellQuote).join(" ") };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function uploadFiles({ files, sourceRoot, bucket, folder, prefix = "", kind = "general", dryRun = false, region }) {
  const uploads = [];

  for (const file of files) {
    const relativePath = path.relative(sourceRoot, file).replace(/\\/g, "/");
    const key = toS3Key({ folder, prefix, relativePath });
    uploads.push(
      runAwsS3Cp({
        file,
        bucket,
        key,
        contentType: getContentType(file),
        cacheControl: getCacheControl(file, kind),
        dryRun,
        region
      })
    );
  }

  return uploads;
}

function minifySvg(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function compressMediaFile(source, destination, log = () => {}) {
  const ext = path.extname(source).toLowerCase();
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (ext === ".svg") {
    fs.writeFileSync(destination, minifySvg(fs.readFileSync(source, "utf8")));
    return { compressed: true, method: "svg-minify" };
  }

  let sharp = null;
  try {
    sharp = require("sharp");
  } catch {
    sharp = null;
  }

  if (!sharp) {
    fs.copyFileSync(source, destination);
    log(`sharp not installed; uploaded original ${path.basename(source)}`);
    return { compressed: false, method: "copy" };
  }

  const image = sharp(source, { failOn: "none" });
  if (ext === ".jpg" || ext === ".jpeg") {
    await image.jpeg({ quality: 82, mozjpeg: true }).toFile(destination);
  } else if (ext === ".png") {
    await image.png({ compressionLevel: 9, palette: true }).toFile(destination);
  } else if (ext === ".webp") {
    await image.webp({ quality: 82 }).toFile(destination);
  } else if (ext === ".avif") {
    await image.avif({ quality: 50 }).toFile(destination);
  } else {
    fs.copyFileSync(source, destination);
    return { compressed: false, method: "copy" };
  }

  return { compressed: true, method: "sharp" };
}

async function prepareCompressedMedia({ source, log = () => {} }) {
  const files = listFiles(source).filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-media-"));
  const prepared = [];
  const sourceRoot = fs.statSync(source).isDirectory() ? source : path.dirname(source);

  for (const file of files) {
    const relativePath = path.relative(sourceRoot, file);
    const destination = path.join(outputRoot, relativePath);
    await compressMediaFile(file, destination, log);
    prepared.push(destination);
  }

  return { files: prepared, outputRoot };
}

function selectSeoFiles(source) {
  if (!fs.existsSync(source)) {
    throw new Error(`SEO source does not exist: ${source}`);
  }

  return listFiles(source).filter((file) => SEO_FILE_NAMES.has(path.basename(file)));
}

function validateAndReadConfig(file) {
  const config = readJsonFile(file);
  const errors = validateSiteConfig(config);
  if (errors.length > 0) {
    const message = ["Site config validation failed:", ...errors.map((error) => `- ${error}`)].join("\n");
    throw new Error(message);
  }
  return config;
}

module.exports = {
  MEDIA_EXTENSIONS,
  SEO_FILE_NAMES,
  compressMediaFile,
  getCacheControl,
  getContentType,
  listFiles,
  minifySvg,
  parseArgs,
  prepareCompressedMedia,
  readJsonFile,
  resolveBucket,
  resolveFolder,
  runAwsS3Cp,
  selectSeoFiles,
  toS3Key,
  uploadFiles,
  validateAndReadConfig
};
