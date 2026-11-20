// Offline shell for Oxtopus. Only this site's own files are cached.
// Requests to other origins (the Octopus API, including any that carry an API key) are never
// intercepted or stored: the browser handles them directly.
const CACHE = 'oxtopus-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.json', 'icon.svg',
  'js/theme.js', 'js/app.js', 'js/api.js', 'js/core.js', 'js/tariffs.js', 'js/charts.js',
  'js/view-now.js', 'js/view-tariffs.js', 'js/view-compare.js', 'js/view-usage.js', 'js/view-settings.js', 'js/install.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so a new release shows up on the next visit; the cache is the offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
