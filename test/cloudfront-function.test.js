"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const handler = loadCloudFrontFunction();

describe("cloudfront domain-folder-router", () => {
  it("rewrites a custom domain root to its template index", () => {
    const result = handler(eventFor("hello.com", "/"));

    assert.equal(result.uri, "/syncpoly/templates/pressure-washer/index.html");
  });

  it("rewrites a custom domain page route to a template index document", () => {
    const result = handler(eventFor("www.hello.com", "/about"));

    assert.equal(result.uri, "/syncpoly/templates/pressure-washer/about/index.html");
  });

  it("rewrites syncpoly subdomains to the configured template", () => {
    const result = handler(eventFor("acme.syncpoly.com", "/dashboard/"));

    assert.equal(result.uri, "/syncpoly/templates/pressure-washer/dashboard/index.html");
  });

  it("keeps asset file names intact under the matched template", () => {
    const result = handler(eventFor("customco.com", "/assets/app.css"));

    assert.equal(result.uri, "/syncpoly/templates/pressure-washer/assets/app.css");
  });

  it("rewrites tenant-owned public files to the mapped site folder", () => {
    const cases = [
      ["/public/site.config.json", "/customco-site/site.config.json"],
      ["/llm.txt", "/customco-site/llm.txt"],
      ["/llms.txt", "/customco-site/llms.txt"],
      ["/sitemap.xml", "/customco-site/sitemap.xml"],
      ["/robot.txt", "/customco-site/robot.txt"],
      ["/robots.txt", "/customco-site/robots.txt"],
      ["/public/favicon.ico", "/customco-site/favicon.ico"],
      ["/public/favicon.png", "/customco-site/favicon.png"],
      ["/public/favicon.svg", "/customco-site/favicon.svg"]
    ];

    for (const [requestUri, expectedUri] of cases) {
      assert.equal(handler(eventFor("customco.com", requestUri)).uri, expectedUri);
    }
  });

  it("rewrites media routes to the mapped site folder", () => {
    const cases = [
      ["/media/gallery/truck.jpg", "/customco-site/media/gallery/truck.jpg"],
      ["/public/media/gallery/truck.jpg", "/customco-site/media/gallery/truck.jpg"],
      ["/media/videos/walkthrough.mp4", "/customco-site/media/videos/walkthrough.mp4"]
    ];

    for (const [requestUri, expectedUri] of cases) {
      assert.equal(handler(eventFor("customco.com", requestUri)).uri, expectedUri);
    }
  });

  it("matches hosts case-insensitively", () => {
    const result = handler(eventFor("WWW.CUSTOMCO.COM", "/logo.svg"));

    assert.equal(result.uri, "/syncpoly/templates/pressure-washer/logo.svg");
  });

  it("leaves global 404 assets at the bucket root", () => {
    assert.equal(handler(eventFor("hello.com", "/404.html")).uri, "/404.html");
    assert.equal(handler(eventFor("hello.com", "/404.css")).uri, "/404.css");
  });

  it("returns 404 for unknown hosts", () => {
    const result = handler(eventFor("unknown.com", "/"));

    assert.equal(result.statusCode, 404);
    assert.equal(result.body, "Domain not configured");
  });
});

describe("global 404 assets", () => {
  it("ships a standalone HTML page with its stylesheet", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "site", "404.html"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "..", "site", "404.css"), "utf8");

    assert.match(html, /<link rel="stylesheet" href="\/404\.css">/);
    assert.match(html, /This page is not available\./);
    assert.match(css, /\.not-found/);
    assert.doesNotMatch(html, /https?:\/\//);
  });
});

function eventFor(host, uri) {
  return {
    request: {
      uri,
      headers: {
        host: { value: host }
      }
    }
  };
}

function loadCloudFrontFunction() {
  const functionPath = path.join(__dirname, "..", "cloudfront", "domain-folder-router.js");
  const source = fs.readFileSync(functionPath, "utf8");
  return vm.runInNewContext(source + "\nhandler;", {});
}
