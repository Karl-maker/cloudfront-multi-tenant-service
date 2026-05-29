"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  deriveFolderFromConfig,
  validateSiteConfig
} = require("../lib/site-config-schema");
const {
  minifySvg,
  prepareCompressedMedia,
  resolveBucket,
  resolveFolder,
  selectSeoFiles,
  toS3Key
} = require("../lib/site-upload");
const {
  buildCnameRecord,
  buildGoDaddyPatchRequest,
  describeCname
} = require("../lib/godaddy-dns");

describe("site config schema", () => {
  it("validates a minimal template-compatible site config", () => {
    assert.deepEqual(validateSiteConfig(validConfig()), []);
  });

  it("reports missing home page and invalid section types", () => {
    const config = validConfig();
    config.pages[0].path = "/about";
    config.pages[0].sections[0].type = "unknown";

    const errors = validateSiteConfig(config);

    assert(errors.some((error) => error.includes("type must be one of")));
    assert(errors.includes('pages must include a page with path "/"'));
  });

  it("derives folder names from explicit fields or site URL", () => {
    assert.equal(deriveFolderFromConfig({ site: { slug: "Aurum Eco Power Wash" } }), "aurum-eco-power-wash");
    assert.equal(
      deriveFolderFromConfig({ site: { url: "https://aurum-eco-power-wash.syncpoly.com" } }),
      "aurum-eco-power-wash"
    );
  });
});

describe("site upload helpers", () => {
  it("resolves bucket and folder from env, args, or config", () => {
    assert.equal(resolveBucket({ CONTENT_BUCKET: "bucket-from-env" }, {}), "bucket-from-env");
    assert.equal(resolveBucket({}, { bucket: "bucket-from-args" }), "bucket-from-args");
    assert.equal(resolveBucket({}, {}, { syncpoly: { bucket: "bucket-from-config" } }), "bucket-from-config");
    assert.equal(resolveFolder({ env: {}, args: { folder: "My Site" } }), "my-site");
    assert.equal(resolveFolder({ env: {}, args: {}, config: validConfig() }), "example");
  });

  it("builds S3 keys with folder, prefix, and relative paths", () => {
    assert.equal(
      toS3Key({ folder: "aurum", prefix: "media", relativePath: "gallery/truck.jpg" }),
      "aurum/media/gallery/truck.jpg"
    );
  });

  it("minifies SVG content", () => {
    const source = `<svg>
      <!-- remove me -->
      <path d="M0 0" />
    </svg>`;

    assert.equal(minifySvg(source), '<svg><path d="M0 0" /></svg>');
  });

  it("selects SEO files and ignores unrelated files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-seo-test-"));
    fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *");
    fs.writeFileSync(path.join(dir, "notes.md"), "ignore");

    assert.deepEqual(selectSeoFiles(dir).map((file) => path.basename(file)), ["robots.txt"]);
  });

  it("prepares SVG media into a compressed temp folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-media-test-"));
    fs.mkdirSync(path.join(dir, "icons"));
    fs.writeFileSync(path.join(dir, "icons", "logo.svg"), "<svg>  <title>Logo</title>  </svg>");

    const prepared = await prepareCompressedMedia({ source: dir });

    assert.equal(prepared.files.length, 1);
    assert.equal(path.relative(prepared.outputRoot, prepared.files[0]), "icons/logo.svg");
    assert.equal(fs.readFileSync(prepared.files[0], "utf8"), "<svg><title>Logo</title></svg>");
  });

  it("loads CLI defaults from .env when shell env does not provide them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-cli-env-test-"));
    const mediaDir = path.join(dir, "media");
    fs.mkdirSync(mediaDir);
    fs.writeFileSync(path.join(mediaDir, "logo.svg"), "<svg>  <title>Logo</title>  </svg>");
    fs.writeFileSync(
      path.join(dir, ".env"),
      [
        "CONTENT_BUCKET=env-bucket",
        "SITE_FOLDER=Env Site",
        "AWS_REGION=us-west-2",
        "DRY_RUN=1"
      ].join("\n")
    );

    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, "../bin/syncpoly-site.js"), "upload-media", "--source", mediaDir],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH
        },
        encoding: "utf8"
      }
    );

    assert.match(output, /aws s3 cp .+ s3:\/\/env-bucket\/env-site\/media\/logo\.svg /);
    assert.match(output, /--region us-west-2/);
  });
});

describe("godaddy dns helpers", () => {
  it("builds a GoDaddy CNAME patch request", () => {
    const record = buildCnameRecord({
      name: "aurum-eco-power-wash",
      value: "d1mp8fjhswh27j.cloudfront.net.",
      ttl: 600
    });
    const request = buildGoDaddyPatchRequest({
      domain: "syncpoly.com",
      apiKey: "key",
      apiSecret: "secret",
      record
    });

    assert.equal(record.data, "d1mp8fjhswh27j.cloudfront.net");
    assert.equal(request.method, "PATCH");
    assert.equal(request.path, "/v1/domains/syncpoly.com/records");
    assert.deepEqual(JSON.parse(request.body), [record]);
    assert.equal(
      describeCname({ domain: "syncpoly.com", record }),
      "aurum-eco-power-wash.syncpoly.com CNAME d1mp8fjhswh27j.cloudfront.net TTL 600"
    );
  });

  it("derives the GoDaddy CNAME record name from positional input or config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-cname-test-"));
    const configPath = path.join(dir, "site.config.json");
    fs.writeFileSync(configPath, JSON.stringify(validConfig()));

    const env = {
      PATH: process.env.PATH,
      GODADDY_DOMAIN: "syncpoly.com",
      CNAME_VALUE: "d1mp8fjhswh27j.cloudfront.net",
      DRY_RUN: "1"
    };

    const positionalOutput = execFileSync(
      process.execPath,
      [path.join(__dirname, "../bin/syncpoly-site.js"), "add-cname", "aurum-eco-power-wash"],
      { cwd: dir, env, encoding: "utf8" }
    );

    const configOutput = execFileSync(
      process.execPath,
      [path.join(__dirname, "../bin/syncpoly-site.js"), "add-cname", "--config", configPath],
      { cwd: dir, env, encoding: "utf8" }
    );

    assert.match(
      positionalOutput,
      /DRY RUN: aurum-eco-power-wash\.syncpoly\.com CNAME d1mp8fjhswh27j\.cloudfront\.net TTL 600/
    );
    assert.match(
      configOutput,
      /DRY RUN: example\.syncpoly\.com CNAME d1mp8fjhswh27j\.cloudfront\.net TTL 600/
    );
  });
});

function validConfig() {
  return {
    site: {
      name: "Example",
      shortName: "Example",
      url: "https://example.syncpoly.com",
      locale: "en_US",
      description: "Example site"
    },
    seo: {
      defaultTitle: "Example",
      defaultImage: "/media/og.jpg"
    },
    theme: {
      colors: { background: "#fff", text: "#111" },
      fonts: { heading: "Inter", body: "Inter" },
      radius: "8px",
      maxWidth: "1200px"
    },
    navigation: {
      logoText: "Example",
      links: []
    },
    pages: [
      {
        path: "/",
        title: "Home",
        description: "Home page",
        sections: [
          {
            id: "hero",
            type: "hero"
          }
        ]
      }
    ],
    footer: {}
  };
}
