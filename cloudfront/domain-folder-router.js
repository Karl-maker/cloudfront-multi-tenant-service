function handler(event) {
  var request = event.request;
  var host = request.headers.host.value.toLowerCase();

  if (request.uri === "/404.html" || request.uri === "/404.css") {
    return request;
  }

  var sitesByHost = {
    "hello.com": { folder: "hello-site", template: "pressure-washer" },
    "www.hello.com": { folder: "hello-site", template: "pressure-washer" },
    "acme.syncpoly.com": { folder: "acme-site", template: "pressure-washer" },
    "customco.com": { folder: "customco-site", template: "pressure-washer" },
    "www.customco.com": { folder: "customco-site", template: "pressure-washer" },
    // real
    "d1mp8fjhswh27j.cloudfront.net": { folder: "syncpoly", template: "pressure-washer" }

  };

  var site = sitesByHost[host];
  if (!site) {
    return {
      statusCode: 404,
      statusDescription: "Not Found",
      headers: {
        "content-type": { value: "text/plain; charset=utf-8" },
        "cache-control": { value: "no-store" }
      },
      body: "Domain not configured"
    };
  }

  if (request.uri === "/public/site.config.json") {
    request.uri = "/" + trimSlashes(site.folder) + "/site.config.json";
    return request;
  }

  request.uri =
    "/syncpoly/templates/" +
    trimSlashes(site.template || "pressure-washer") +
    normalizeStaticSiteUri(request.uri);
  return request;
}

function normalizeStaticSiteUri(uri) {
  if (!uri || uri === "/") {
    return "/index.html";
  }

  if (uri.charAt(0) !== "/") {
    uri = "/" + uri;
  }

  if (uri.charAt(uri.length - 1) === "/") {
    return uri + "index.html";
  }

  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") === -1) {
    return uri + "/index.html";
  }

  return uri;
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}
