"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const handler = loadCloudFrontFunction();

describe("cloudfront domain-folder-router", () => {
  it("rewrites a custom domain root to its S3 folder index", () => {
    const result = handler(eventFor("hello.com", "/"));

    assert.equal(result.uri, "/hello-site/index.html");
  });

  it("rewrites a custom domain page route to a folder index document", () => {
    const result = handler(eventFor("www.hello.com", "/about"));

    assert.equal(result.uri, "/hello-site/about/index.html");
  });

  it("rewrites syncpoly subdomains to the configured folder", () => {
    const result = handler(eventFor("acme.syncpoly.com", "/dashboard/"));

    assert.equal(result.uri, "/acme-site/dashboard/index.html");
  });

  it("keeps asset file names intact under the matched folder", () => {
    const result = handler(eventFor("customco.com", "/assets/app.css"));

    assert.equal(result.uri, "/customco-site/assets/app.css");
  });

  it("matches hosts case-insensitively", () => {
    const result = handler(eventFor("WWW.CUSTOMCO.COM", "/logo.svg"));

    assert.equal(result.uri, "/customco-site/logo.svg");
  });

  it("returns 404 for unknown hosts", () => {
    const result = handler(eventFor("unknown.com", "/"));

    assert.equal(result.statusCode, 404);
    assert.equal(result.body, "Domain not configured");
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
