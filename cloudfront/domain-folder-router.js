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
    "atlantic-villa-tobago.syncpoly.com": { folder: "atlantic-villa-tobago", template: "real-estate" },
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

  var mappedPublicPaths = {
    "/site.config.json": "/site.config.json",
    "/public/site.config.json": "/site.config.json",
    "/llm.txt": "/llm.txt",
    "/llms.txt": "/llms.txt",
    "/sitemap.xml": "/sitemap.xml",
    "/robot.txt": "/robot.txt",
    "/robots.txt": "/robots.txt",
    "/favicon.ico": "/media/favicon.ico",
    "/favicon.png": "/media/favicon.png",
    "/favicon.svg": "/media/favicon.svg",
    "/public/favicon.ico": "/media/favicon.ico",
    "/public/favicon.png": "/media/favicon.png",
    "/public/favicon.svg": "/media/favicon.svg"
  };
  var mappedPublicPath = mappedPublicPaths[request.uri];
  if (mappedPublicPath) {
    request.uri = "/" + trimSlashes(site.folder) + mappedPublicPath;
    return request;
  }

  var mappedMediaPath = getMappedMediaPath(request.uri);
  if (mappedMediaPath) {
    request.uri = "/" + trimSlashes(site.folder) + mappedMediaPath;
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

function getMappedMediaPath(uri) {
  if (uri.indexOf("/assets/") === 0) {
    return uri;
  }

  if (uri.indexOf("/public/assets/") === 0) {
    return uri.substring("/public".length);
  }

  if (uri.indexOf("/media/") === 0) {
    return uri;
  }

  if (uri.indexOf("/public/media/") === 0) {
    return uri.substring("/public".length);
  }

  return null;
}
