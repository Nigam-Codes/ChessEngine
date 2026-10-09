/**
 * The service worker — what lets the installed app open with no signal.
 *
 * Not served as-is: the build fills in VERSION and PRECACHE (see the plugin in
 * vite.config.js) with the exact files that build produced. Asset names carry
 * content hashes, so a new build is a new cache, and the old one is deleted
 * once the new version takes over.
 *
 * Strategy:
 *   - the page itself: network first, so online you always get the latest
 *     app; offline, or on a connection too slow to wait for, the cached one.
 *   - everything else of ours: cache first — hashed files never change.
 *   - anything cross-origin (the matchmaking broker): straight to the
 *     network, never cached. Online play needs the network by definition.
 */

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `chess-lab-${VERSION}`;
// How long to wait for the network before showing the cached page instead.
const NAV_TIMEOUT_MS = 3000;

const scoped = (path) => new URL(path, self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scoped))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("chess-lab-") && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// The page asks for this when the person taps "Reload" on the update banner.
// Never automatic: swapping versions under a game in progress would be rude.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

// ignoreVary: a module script is fetched as a CORS request carrying an Origin
// header, while the copy in the cache was stored by a request without one. A
// server that answers with "Vary: Origin" would then make every lookup miss,
// and the installed app would open offline to a blank page. Entries here are
// keyed by content-hashed URL, so Vary has nothing to add.
const MATCH = { ignoreSearch: true, ignoreVary: true };

const cachedPage = () =>
  caches.match(scoped("./"), MATCH).then((r) => r || caches.match(scoped("index.html"), MATCH));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      new Promise((resolve) => {
        let settled = false;
        const fallback = () => {
          if (settled) return;
          settled = true;
          cachedPage().then((r) => resolve(r || fetch(req)));
        };
        const timer = setTimeout(fallback, NAV_TIMEOUT_MS);
        fetch(req)
          .then((res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(res);
          })
          .catch(() => {
            clearTimeout(timer);
            fallback();
          });
      })
    );
    return;
  }

  event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req)));
});
