// Bump this string whenever index.html changes — the activate handler deletes every
// other cache, which is what forces an installed app to pick up the new version.
const CACHE_NAME = 'batch-planner-v3';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './privacy.html',
  './terms.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Never cache the TikTok endpoints. A cached "not connected" reply would be
  // impossible to clear, and auth responses must always hit the network.
  const path = new URL(event.request.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/auth/')) return;
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        // Not cached yet: fetch it, and stash a copy so it works offline next time.
        // This is what makes the Tailwind CDN file available with no internet.
        return fetch(event.request).then(netRes => {
          if (netRes && (netRes.ok || netRes.type === 'opaque')) {
            const copy = netRes.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return netRes;
        });
      })
      .catch(() => caches.match('./index.html'))
  );
});
