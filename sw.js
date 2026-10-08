// Offline shell: serve cached files instantly, refresh them in the background.
// Bump VERSION on every release (and APP_VERSION in app.js) so the new files are installed as one consistent set.
const VERSION = 55;
const CACHE = "fitness-v" + VERSION;
const SHELL = ["./", "index.html", "boot.js", "library.js", "tips.js", "app.js", "insights.js", "photos.js", "cardio.js", "style.css", "manifest.webmanifest", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  // cache: "reload" bypasses the HTTP cache (GitHub Pages sends max-age=600),
  // otherwise a new index.html could be paired with a stale app.js
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});


// the page asks which version this worker serves (shown in Ayarlar and in the update message)
self.addEventListener("message", (e) => {
  if (e.data?.type === "version") e.ports[0]?.postMessage(VERSION);
});
