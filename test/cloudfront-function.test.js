"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const handler = loadCloudFrontFunction();

describe("cloudfront domain-folder-router", () => {
  it("rewrites the configured domain root to its site-specific index", () => {
    const result = handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/index.html");
  });

  it("rewrites a configured domain page route to a site-specific index document", () => {
    const result = handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/faq"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/faq/index.html");
  });

  it("rewrites the Atlantic Villa syncpoly subdomain to its site-specific export", () => {
    const result = handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/location/"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/location/index.html");
  });

  it("rewrites Atlantic Villa extensionless pages to its site-specific export", () => {
    assert.equal(
      handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/amenities")).uri,
      "/atlantic-villa-tobago/_site/amenities/index.html"
    );
    assert.equal(
      handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/amenities/")).uri,
      "/atlantic-villa-tobago/_site/amenities/index.html"
    );
    assert.equal(
      handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/faq")).uri,
      "/atlantic-villa-tobago/_site/faq/index.html"
    );
  });

  it("rewrites non-tenant static files under the site-specific export", () => {
    const result = handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/logo.svg"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/logo.svg");
  });

  it("rewrites Next static files under the site-specific export", () => {
    const result = handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/_next/static/chunks/app.js"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/_next/static/chunks/app.js");
  });

  it("rewrites tenant-owned public files to the mapped site folder", () => {
    const cases = [
      ["/site.config.json", "/atlantic-villa-tobago/site.config.json"],
      ["/public/site.config.json", "/atlantic-villa-tobago/site.config.json"],
      ["/llm.txt", "/atlantic-villa-tobago/llm.txt"],
      ["/llms.txt", "/atlantic-villa-tobago/llms.txt"],
      ["/sitemap.xml", "/atlantic-villa-tobago/sitemap.xml"],
      ["/robot.txt", "/atlantic-villa-tobago/robot.txt"],
      ["/robots.txt", "/atlantic-villa-tobago/robots.txt"],
      ["/favicon.ico", "/atlantic-villa-tobago/media/favicon.ico"],
      ["/favicon.png", "/atlantic-villa-tobago/media/favicon.png"],
      ["/favicon.svg", "/atlantic-villa-tobago/media/favicon.svg"],
      ["/public/favicon.ico", "/atlantic-villa-tobago/media/favicon.ico"],
      ["/public/favicon.png", "/atlantic-villa-tobago/media/favicon.png"],
      ["/public/favicon.svg", "/atlantic-villa-tobago/media/favicon.svg"]
    ];

    for (const [requestUri, expectedUri] of cases) {
      assert.equal(handler(eventFor("atlantic-villa-tobago.syncpoly.com", requestUri)).uri, expectedUri);
    }
  });

  it("rewrites media and asset routes to the mapped site folder", () => {
    const cases = [
      ["/assets/syncpoly-icon.png", "/atlantic-villa-tobago/assets/syncpoly-icon.png"],
      ["/public/assets/syncpoly-icon.png", "/atlantic-villa-tobago/assets/syncpoly-icon.png"],
      ["/media/gallery/truck.jpg", "/atlantic-villa-tobago/media/gallery/truck.jpg"],
      ["/public/media/gallery/truck.jpg", "/atlantic-villa-tobago/media/gallery/truck.jpg"],
      ["/media/videos/walkthrough.mp4", "/atlantic-villa-tobago/media/videos/walkthrough.mp4"]
    ];

    for (const [requestUri, expectedUri] of cases) {
      assert.equal(handler(eventFor("atlantic-villa-tobago.syncpoly.com", requestUri)).uri, expectedUri);
    }
  });

  it("matches hosts case-insensitively", () => {
    const result = handler(eventFor("ATLANTIC-VILLA-TOBAGO.SYNCPOLY.COM", "/logo.svg"));

    assert.equal(result.uri, "/atlantic-villa-tobago/_site/logo.svg");
  });

  it("leaves global 404 assets at the bucket root", () => {
    assert.equal(handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/404.html")).uri, "/404.html");
    assert.equal(handler(eventFor("atlantic-villa-tobago.syncpoly.com", "/404.css")).uri, "/404.css");
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
