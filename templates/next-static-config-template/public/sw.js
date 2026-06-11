const serviceWorkerParams = new URL(self.location.href).searchParams;
const CACHE_VERSION = serviceWorkerParams.get("cache") || "next-static-config-template-v1";
const OFFLINE_PATH = serviceWorkerParams.get("offline") || "/offline/";
const basePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const withBase = (path) => `${basePath}${path.startsWith("/") ? path : `/${path}`}` || "/";

const coreAssets = [
  withBase("/"),
  withBase(OFFLINE_PATH),
  withBase("/manifest.webmanifest"),
  withBase("/images/icon.svg"),
  withBase("/images/og-default.svg")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(coreAssets))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === withBase("/site.config.json")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(withBase(OFFLINE_PATH)).then((response) => response || caches.match(withBase("/"))))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }

        return response;
      });
    })
  );
});
