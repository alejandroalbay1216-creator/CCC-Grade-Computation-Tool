const OFFLINE_CACHE = 'ccc-grades-offline-v1';
const APP_BASE = self.registration.scope;
const APP_PATH = new URL(APP_BASE).pathname;
const OFFLINE_PAGE = new URL('offline.html', APP_BASE).toString();

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(cache => cache.add(OFFLINE_PAGE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('ccc-grades-') && key !== OFFLINE_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/backend/')) {
    return;
  }

  if (request.mode === 'navigate' && url.pathname.startsWith(APP_PATH)) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
  }
});
