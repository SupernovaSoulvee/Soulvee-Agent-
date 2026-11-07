// Soulvee OS service worker: lets the app open without a connection.
// Network first, so updates arrive as soon as you're online; the cache is the fallback.
const CACHE = 'soulvee-os-v2';
const SHELL = [
  '/',
  '/os-runtime.js',
  '/vendor/app.css',
  '/vendor/react.production.min.js',
  '/vendor/react-dom.production.min.js',
  '/vendor/htm.umd.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Every page load is the same app shell; store it under "/" so ?token=… URLs are never cached.
  const key = req.mode === 'navigate' ? '/' : url.pathname;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
