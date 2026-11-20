const CACHE = 'exodus-3d-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=4',
  './app.js?v=4',
  './engine.js',
  './data.js?v=4',
  './diagrams.js?v=4',
  './manifest.webmanifest',
  './data/meta.json',
  './data/height.bin',
  './data/relief.jpg',
  './data/seamask.png',
  './icons/favicon.svg',
  './icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  const isCode =
    url.pathname.endsWith('/') ||
    /\.(html|css|js|json|webmanifest)$/i.test(url.pathname);

  if (isCode) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
