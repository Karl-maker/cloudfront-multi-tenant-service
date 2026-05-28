function handler(event) {
  var request = event.request;
  var host = request.headers.host.value.toLowerCase();

  if (request.uri === "/404.html" || request.uri === "/404.css") {
    return request;
  }

  var foldersByHost = {
    "hello.com": "hello-site",
    "www.hello.com": "hello-site",
    "acme.syncpoly.com": "acme-site",
    "customco.com": "customco-site",
    "www.customco.com": "customco-site",
    // real
    "d1mp8fjhswh27j.cloudfront.net": "syncpoly"

  };

  var folder = foldersByHost[host];
  if (!folder) {
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

  request.uri = "/" + trimSlashes(folder) + normalizeStaticSiteUri(request.uri);
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
