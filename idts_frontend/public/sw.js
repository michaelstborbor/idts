/*
 * IDTS service worker: keeps the app itself (page, scripts, styles, fonts,
 * icons) on the device so it opens without a connection. Records and
 * queued entries live in IndexedDB (src/offline/), not here, and API
 * calls are never intercepted.
 */

// The build fills these in (see vite.config.js) with the hashed file names
// of this release, so the whole app is on the device after the first visit.
const BUILD_ID = "dev";
const BUILD_ASSETS = [];

const CACHE = `idts-app-${BUILD_ID}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", ...BUILD_ASSETS];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first so a new release shows up, cached page offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Built assets have content hashes in their names, so a cached copy is
  // always correct. Everything else: cached copy first, refreshed behind.
  event.respondWith(
    // ignoreVary: module scripts send an Origin header the precache request
    // did not, and a "Vary: Origin" response would otherwise never match.
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached && url.pathname.startsWith("/assets/")) return cached;
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      if (!cached) return network;
      network.catch(() => {});
      return cached;
    })
  );
});
