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

  it("rewrites site config to the mapped site folder", () => {
    const result = handler(eventFor("customco.com", "/public/site.config.json"));

    assert.equal(result.uri, "/customco-site/site.config.json");
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
