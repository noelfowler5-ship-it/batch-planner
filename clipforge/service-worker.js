/* ClipForge AI service worker.

   BUMP CACHE_NAME whenever any file in clipforge/ changes. The activate handler
   deletes every other cache, which is what forces an installed app to pick up
   the new version instead of serving the old one forever. */

const CACHE_NAME = 'clipforge-v7';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/util.js',
  './js/db.js',
  './js/video-engine.js',
  './js/project.js',
  './js/ai-schema.js',
  './js/ai-client.js',
  './js/editor.js',
  './js/export.js',
  './js/ui.js',
  './js/screens.js',
  './js/studio.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.map((name) => (name === CACHE_NAME ? null : caches.delete(name)))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache the AI proxy. A cached failure or a stale analysis would be
  // impossible to clear, and these calls must always reach the network.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/.netlify/functions/')) return;

  event.respondWith(
    caches.match(event.request)
      .then((hit) => {
        if (hit) return hit;
        return fetch(event.request).then((res) => {
          // Stash a copy so anything fetched once works offline afterwards.
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
          }
          return res;
        });
      })
      .catch(() => caches.match('./index.html'))
  );
});
