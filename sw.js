// Service worker: offline cache + notification click handling.
const CACHE = 'prayer-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  './audio/catalog.json',
  './js/adhan.js',
  './js/app.js',
  './js/astro.js',
  './js/content.js',
  './js/core.js',
  './js/ics.js',
  './js/location.js',
  './js/media.js',
  './js/notify.js',
  './js/qibla.js',
  './js/store.js',
  './js/traditions.js',
  './js/tz.js',
  './js/views/checklist.js',
  './js/views/dhikr.js',
  './js/views/reflect.js',
  './js/views/settings.js',
  './js/views/timer.js',
  './js/views/today.js',
];

// Optional adhan recordings — cached for offline use when present.
const OPTIONAL = ['./audio/adhan.mp3', './audio/adhan-fajr.mp3', './audio/adhan-makkah.mp3', './audio/adhan-madinah.mp3'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // `reload` bypasses the browser's HTTP cache so the offline copy is the new version.
      .then((c) =>
        c
          .addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))
          .then(() => Promise.all(OPTIONAL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for our own files (so updates arrive), cache fallback offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // `no-cache` revalidates with the server so a new version is picked up right away.
    // (Page loads are "navigate" requests, which can't be re-created with options,
    // so they are fetched by URL.)
    fetch(e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' }))
      .then((res) => {
        // Only cache complete responses (audio range requests return 206).
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./index.html#today');
    }),
  );
});
