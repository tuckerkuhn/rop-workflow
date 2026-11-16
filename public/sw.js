/*
 * ROP Workflow's service worker: lets the app open without a connection. It keeps the app's own
 * code and the pages a person has opened, never project data: API answers and donor links are
 * always fetched fresh and never stored. Work saved offline waits in the page's own outbox.
 */
// Raising the version clears every copy stored under the old one when the new worker starts.
const CACHE = "rop-shell-v3";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const neverStore = (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/share/") || url.pathname.startsWith("/auth/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || neverStore(url)) return;
  // The app's code: a built file's name changes with its content, so the stored copy is always right.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Images and icons keep their names when replaced (a new logo is still /brand/rop-logo.svg), so
  // the network first, and the stored copy only without a connection.
  if (/\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }
  // Pages: the network first; without a connection, the copy from the last visit, or the offline page.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE))),
    );
  }
});
