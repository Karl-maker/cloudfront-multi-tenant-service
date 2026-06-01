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
  buildSeoFiles,
  buildSiteConfig
} = require("../lib/site-config-builder");
const { listThemes, resolveThemeName } = require("../lib/site-themes");
const {
  minifySvg,
  parseArgs,
  parseMediaCompressionOptions,
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

  it("accepts the template mediaGallery section type", () => {
    const config = validConfig();
    config.pages[0].sections.push({
      id: "featured-gallery",
      type: "mediaGallery",
      mediaItems: [
        {
          src: "/media/property-exterior.jpg",
          alt: "Property exterior"
        }
      ]
    });

    assert.deepEqual(validateSiteConfig(config), []);
  });

  it("derives folder names from explicit fields or site URL", () => {
    assert.equal(deriveFolderFromConfig({ site: { slug: "Aurum Eco Power Wash" } }), "aurum-eco-power-wash");
    assert.equal(
      deriveFolderFromConfig({ site: { url: "https://aurum-eco-power-wash.syncpoly.com" } }),
      "aurum-eco-power-wash"
    );
  });

  it("builds a themed site config from lightweight content input", () => {
    const config = buildSiteConfig({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays with polished guest service.",
        keywords: ["luxury villa", "waterfront rental"]
      },
      business: {
        industry: "Luxury villa rental"
      },
      contact: {
        phone: "+1 (868) 555-0100",
        whatsapp: "+1 (868) 555-0100"
      },
      booking: {
        href: "https://example.com/book",
        label: "Book a stay"
      },
      media: {
        hero: "/media/harbor-house.jpg",
        logo: "/media/logo.svg",
        gallery: [
          { src: "/media/harbor-house.jpg", alt: "Harbor House exterior" },
          { src: "/media/pool.jpg", alt: "Pool view" }
        ]
      },
      copy: {
        headline: "Waterfront stays with a private, polished feel."
      },
      services: [
        {
          title: "Private stays",
          body: "A calm base for groups that want privacy and comfort."
        }
      ],
      pricing: [
        {
          title: "Weekend stay",
          price: "From $300",
          features: ["Pool access", "Private rooms"]
        }
      ],
      map: {
        query: "Bacolet Tobago"
      }
    }, { site: "harbor-house", theme: "luxury", updatedAt: "2026-05-31" });

    assert.deepEqual(validateSiteConfig(config), []);
    assert.equal(config.syncpoly.folder, "harbor-house");
    assert.equal(config.theme.colors.primary, "#2563eb");
    assert.match(config.theme.customCss, /site-header/);
    assert.match(config.theme.customCss, /\.contact-method\{padding:18px 20px/);
    assert.match(config.theme.customCss, /\.map-layout\{padding:28px/);
    assert.equal(config.seo.defaultImage, "/media/harbor-house.jpg");
    assert.equal(config.pages[0].sections[0].actions[0].href, "https://example.com/book");
    assert.equal(config.pages[0].sections[0].actions[1].href, "https://wa.me/18685550100");
    assert(config.footer.socialLinks.some((link) => link.platform === "whatsapp" && link.href === "https://wa.me/18685550100"));
    assert(config.footer.socialLinks.some((link) => link.platform === "phone" && link.href === "tel:+18685550100"));
    assert(config.pages[0].sections.some((section) => section.type === "mediaGallery"));
    assert(config.pages[0].sections.some((section) => section.type === "pricing"));
    assert(config.pages[0].sections.some((section) => section.type === "map"));
  });

  it("omits pricing navigation when pricing is not configured", () => {
    const config = buildSiteConfig({
      site: {
        name: "Clean Cuts",
        description: "Local barber services."
      },
      contact: {
        whatsapp: "+1 (868) 555-0100"
      },
      media: {
        hero: "/media/hero.jpg"
      },
      services: [
        {
          title: "Fades",
          body: "Sharp fades and clean lineups."
        }
      ]
    }, { site: "clean-cuts", theme: "luxury", updatedAt: "2026-05-31" });

    assert(!config.navigation.links.some((link) => link.href === "#pricing"));
    assert(!config.footer.links.some((link) => link.href === "#pricing"));
    assert(!config.pages[0].sections.some((section) => section.type === "pricing"));
  });

  it("merges per-site theme overrides into the generated config", () => {
    const config = buildSiteConfig({
      site: {
        name: "Night Cut",
        description: "Dark barber website."
      },
      theme: {
        mode: "dark",
        colors: {
          background: "#08090c",
          surface: "#15171d",
          text: "#f8fafc",
          primary: "#d4af37"
        }
      },
      media: {
        hero: "/media/hero.jpg"
      }
    }, { site: "night-cut", theme: "luxury", updatedAt: "2026-05-31" });

    assert.equal(config.theme.mode, "dark");
    assert.equal(config.theme.colors.background, "#08090c");
    assert.equal(config.theme.colors.surface, "#15171d");
    assert.equal(config.theme.colors.text, "#f8fafc");
    assert.equal(config.theme.colors.primary, "#d4af37");
    assert.equal(config.site.manifest.backgroundColor, "#08090c");
    assert.equal(config.site.manifest.themeColor, "#d4af37");
  });

  it("selects a default theme preset from the template", () => {
    const baseInput = {
      site: {
        name: "Template Match",
        description: "Template-specific theme selection."
      },
      media: {
        hero: "/media/hero.jpg"
      }
    };
    const serviceConfig = buildSiteConfig(baseInput, {
      site: "template-match-service",
      template: "service",
      updatedAt: "2026-05-31"
    });
    const realEstateConfig = buildSiteConfig(baseInput, {
      site: "template-match-real-estate",
      template: "real-estate",
      updatedAt: "2026-05-31"
    });

    assert.equal(resolveThemeName({ template: "service" }), "service");
    assert.equal(resolveThemeName({ template: "real-estate" }), "real-estate");
    assert.equal(resolveThemeName({ theme: "luxury", template: "real-estate" }), "luxury");
    assert.equal(serviceConfig.theme.colors.primary, "#2563eb");
    assert.equal(realEstateConfig.theme.colors.primary, "#0f766e");
    assert.equal(realEstateConfig.theme.fonts.heading, "Playfair Display, Georgia, serif");
  });

  it("builds deterministic SEO files from a site config", () => {
    const config = buildSiteConfig({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays."
      },
      media: {
        hero: "/media/hero.jpg"
      }
    }, { site: "harbor-house", updatedAt: "2026-05-31" });
    const files = buildSeoFiles(config);

    assert.match(files["robots.txt"], /Sitemap: https:\/\/harbor-house\.syncpoly\.com\/sitemap\.xml/);
    assert.match(files["sitemap.xml"], /<loc>https:\/\/harbor-house\.syncpoly\.com\/<\/loc>/);
    assert.match(files["llms.txt"], /Harbor House is represented by https:\/\/harbor-house\.syncpoly\.com/);
  });

  it("lists the built-in template theme presets", () => {
    assert(listThemes().some((theme) => theme.name === "service"));
    assert(listThemes().some((theme) => theme.name === "real-estate"));
    assert(listThemes().some((theme) => theme.name === "luxury"));
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
    fs.mkdirSync(path.join(dir, "media"));
    fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *");
    fs.writeFileSync(path.join(dir, "media", "favicon.svg"), "<svg></svg>");
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

  it("creates WebP variants for raster media", async () => {
    const sharp = require("sharp");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-media-webp-test-"));
    fs.mkdirSync(path.join(dir, "gallery"));
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: "#146ef5"
      }
    }).png().toFile(path.join(dir, "gallery", "photo.png"));

    const prepared = await prepareCompressedMedia({
      source: dir,
      compression: { includeWebp: true, maxWidth: 24, maxHeight: 24, quality: 70 }
    });
    const relativeFiles = prepared.files.map((file) => path.relative(prepared.outputRoot, file)).sort();

    assert.deepEqual(relativeFiles, ["gallery/photo.png", "gallery/photo.webp"]);
  });

  it("parses media compression CLI options", () => {
    const args = parseArgs(["--max-width", "1600", "--max-height=1200", "--quality", "72", "--no-webp"]);

    assert.deepEqual(parseMediaCompressionOptions(args, {}), {
      includeWebp: false,
      maxWidth: 1600,
      maxHeight: 1200,
      quality: 72
    });
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

  it("rejects upload-folder image uploads outside the media prefix", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-upload-folder-test-"));
    fs.writeFileSync(path.join(dir, "logo.svg"), "<svg></svg>");

    let error;
    try {
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "../bin/syncpoly-site.js"),
          "upload-folder",
          "--source",
          dir,
          "--prefix",
          "assets",
          "--folder",
          "example"
        ],
        {
          env: {
            PATH: process.env.PATH,
            CONTENT_BUCKET: "test-bucket",
            DRY_RUN: "1"
          },
          encoding: "utf8"
        }
      );
    } catch (caught) {
      error = caught;
    }

    assert(error);
    assert.match(String(error.stderr), /Tenant image files must be uploaded under \/media/);
  });

  it("prepares a localhost preview from template output and tenant media", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-preview-test-"));
    const siteDir = path.join(dir, "sites", "example");
    const templateDir = path.join(dir, "template");
    const previewDir = path.join(dir, "preview");
    fs.mkdirSync(path.join(siteDir, "media"), { recursive: true });
    fs.mkdirSync(path.join(templateDir, "out"), { recursive: true });
    fs.writeFileSync(path.join(templateDir, "out", "index.html"), "<html>preview</html>");
    fs.writeFileSync(path.join(templateDir, "out", "site.config.json"), "{}");
    fs.writeFileSync(path.join(siteDir, "site.config.json"), JSON.stringify(validConfig()));
    fs.writeFileSync(path.join(siteDir, "robots.txt"), "User-agent: *");
    fs.writeFileSync(path.join(siteDir, "media", "logo.svg"), "<svg></svg>");

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "preview",
        "--site",
        siteDir,
        "--template",
        templateDir,
        "--out",
        previewDir,
        "--no-serve"
      ],
      {
        env: {
          PATH: process.env.PATH
        },
        encoding: "utf8"
      }
    );

    assert.match(output, /Prepared local preview/);
    assert(fs.existsSync(path.join(previewDir, "out", "index.html")));
    assert(fs.existsSync(path.join(previewDir, "out", "site.config.json")));
    assert(fs.existsSync(path.join(previewDir, "out", "robots.txt")));
    assert(fs.existsSync(path.join(previewDir, "out", "media", "logo.svg")));
  });

  it("creates site config and SEO files through the CLI", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-make-site-test-"));
    const inputPath = path.join(dir, "site.input.json");
    const siteDir = path.join(dir, "sites", "harbor-house");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays."
      },
      media: {
        hero: "/media/hero.jpg"
      },
      services: [
        {
          title: "Guest-ready presentation",
          body: "Clear details for people comparing premium stays."
        }
      ],
      pricing: [
        {
          title: "Starter",
          price: "From $99",
          body: "A simple entry package."
        }
      ],
      map: {
        query: "Port of Spain Trinidad"
      }
    }));

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "make-site",
        "--input",
        inputPath,
        "--site",
        "harbor-house",
        "--dir",
        siteDir,
        "--updated-at",
        "2026-05-31"
      ],
      {
        env: {
          PATH: process.env.PATH
        },
        encoding: "utf8"
      }
    );

    assert.match(output, /Theme: luxury/);
    assert(fs.existsSync(path.join(siteDir, "site.config.json")));
    assert(fs.existsSync(path.join(siteDir, "robots.txt")));
    assert(fs.existsSync(path.join(siteDir, "sitemap.xml")));
    assert(fs.existsSync(path.join(siteDir, "llms.txt")));
    assert.deepEqual(validateSiteConfig(JSON.parse(fs.readFileSync(path.join(siteDir, "site.config.json"), "utf8"))), []);
    const generatedConfig = JSON.parse(fs.readFileSync(path.join(siteDir, "site.config.json"), "utf8"));
    assert(generatedConfig.pages[0].sections.some((section) => section.type === "pricing"));
    assert(generatedConfig.pages[0].sections.some((section) => section.type === "map"));
  });

  it("lets the CLI choose a theme preset from --template", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-template-theme-test-"));
    const inputPath = path.join(dir, "site.input.json");
    const siteDir = path.join(dir, "sites", "harbor-house");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays."
      },
      media: {
        hero: "/media/hero.jpg"
      }
    }));

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "make-site",
        "--input",
        inputPath,
        "--site",
        "harbor-house",
        "--dir",
        siteDir,
        "--template",
        "real-estate",
        "--updated-at",
        "2026-05-31"
      ],
      {
        env: {
          PATH: process.env.PATH
        },
        encoding: "utf8"
      }
    );
    const generatedConfig = JSON.parse(fs.readFileSync(path.join(siteDir, "site.config.json"), "utf8"));

    assert.match(output, /Theme: real-estate/);
    assert.equal(generatedConfig.theme.colors.primary, "#0f766e");
  });

  it("creates normalized site input and reports a media manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-input-test-"));
    const mediaDir = path.join(dir, "sites", "harbor-house", "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "hero-pool.jpg"), "jpg");
    fs.writeFileSync(path.join(mediaDir, "logo.svg"), "<svg></svg>");

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "make-input",
        "--site",
        "harbor-house",
        "--name",
        "Harbor House",
        "--industry",
        "Luxury villa rental",
        "--phone",
        "+1 (868) 555-0100",
        "--booking-url",
        "https://example.com/book",
        "--whatsapp",
        "+1 (868) 555-0100",
        "--pricing",
        "Weekday Stay:From $299:Monday to Thursday:Pool access,Concierge|Weekend Stay:From $499:Friday to Sunday",
        "--map",
        "Port of Spain, Trinidad",
        "--dir",
        path.join(dir, "sites", "harbor-house"),
        "--media-source",
        mediaDir
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH
        },
        encoding: "utf8"
      }
    );
    const input = JSON.parse(fs.readFileSync(path.join(dir, "sites", "harbor-house", "site.input.json"), "utf8"));
    const manifest = execFileSync(
      process.execPath,
      [path.join(__dirname, "../bin/syncpoly-site.js"), "media-manifest", "--source", mediaDir],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );

    assert.match(output, /Wrote/);
    assert.equal(input.site.name, "Harbor House");
    assert.equal(input.media.hero, "/media/hero-pool.jpg");
    assert.equal(input.booking.href, "https://example.com/book");
    assert.equal(input.contact.whatsapp, "+1 (868) 555-0100");
    assert.equal(input.pricing[0].price, "From $299");
    assert.deepEqual(input.pricing[0].features, ["Pool access", "Concierge"]);
    assert.equal(input.map.query, "Port of Spain, Trinidad");
    assert.match(manifest, /hero-pool\.jpg/);
  });

  it("audits a generated site and creates a route entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-audit-route-test-"));
    const siteDir = path.join(dir, "sites", "harbor-house");
    const mediaDir = path.join(siteDir, "media");
    const routerPath = path.join(dir, "domain-folder-router.js");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "hero.jpg"), "jpg");
    fs.writeFileSync(path.join(mediaDir, "favicon.svg"), "<svg></svg>");
    fs.writeFileSync(path.join(siteDir, "site.input.json"), JSON.stringify({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays."
      },
      media: {
        hero: "/media/hero.jpg",
        favicon: "/media/favicon.svg"
      },
      services: [
        {
          title: "Private stays",
          body: "A calm base for groups that want privacy and comfort."
        }
      ]
    }));
    fs.writeFileSync(routerPath, [
      "function handler(event) {",
      "  var sitesByHost = {",
      "    // real",
      "  };",
      "  return sitesByHost;",
      "}"
    ].join("\n"));

    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "make-site",
        "--input",
        path.join(siteDir, "site.input.json"),
        "--site",
        "harbor-house",
        "--dir",
        siteDir,
        "--updated-at",
        "2026-05-31"
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );
    const routeOutput = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "add-route",
        "--site",
        "harbor-house",
        "--router",
        routerPath
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );
    const auditOutput = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "audit-site",
        "--site",
        siteDir,
        "--router",
        routerPath
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );

    assert.match(routeOutput, /Added route harbor-house\.syncpoly\.com/);
    assert.match(fs.readFileSync(routerPath, "utf8"), /"harbor-house\.syncpoly\.com": \{ folder: "harbor-house", template: "real-estate" \}/);
    assert.match(auditOutput, /PASS site\.config\.json validates/);
    assert.match(auditOutput, /PASS route exists for harbor-house\.syncpoly\.com/);
  });

  it("prints template upload commands through the CLI", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-template-upload-test-"));
    const outDir = path.join(dir, "out");
    fs.mkdirSync(path.join(outDir, "_next", "static"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html>");
    fs.writeFileSync(path.join(outDir, "_next", "static", "app.js"), "console.log('ok');");

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "upload-template",
        "--template-name",
        "service",
        "--source",
        outDir,
        "--profile",
        "prod",
        "--dry-run"
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );

    assert.match(output, /aws --profile prod s3 cp/);
    assert.match(output, /s3:\/\/syncpoly-web-builder-sites\/syncpoly\/templates\/service\/index\.html/);
    assert.match(output, /no-cache, max-age=0/);
    assert.match(output, /public, max-age=31536000, immutable/);
    assert.match(output, /Template uploaded: syncpoly\/templates\/service\/ \(2 file\(s\)\)/);
  });

  it("generates outreach text from site input", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoly-outreach-test-"));
    const siteDir = path.join(dir, "sites", "harbor-house");
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, "site.input.json"), JSON.stringify({
      site: {
        name: "Harbor House",
        description: "Private waterfront stays."
      }
    }));

    const output = execFileSync(
      process.execPath,
      [
        path.join(__dirname, "../bin/syncpoly-site.js"),
        "make-outreach",
        "--site",
        siteDir,
        "--benefit",
        "real-estate"
      ],
      { cwd: dir, env: { PATH: process.env.PATH }, encoding: "utf8" }
    );

    assert.match(output, /Hi Harbor House,/);
    assert.match(output, /property, location, amenities, and inquiry details/);
    assert.doesNotMatch(output, /https:\/\/harbor-house/);
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
