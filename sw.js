// Service worker: offline cache + notification click handling.
const CACHE = 'prayer-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
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
const OPTIONAL = ['./audio/adhan.mp3', './audio/adhan-fajr.mp3'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS).then(() => Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})))))
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
    fetch(e.request, { cache: 'no-cache' })
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
