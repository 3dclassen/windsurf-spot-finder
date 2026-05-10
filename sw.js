// Service Worker — SpotFinder PWA
// Cached beim Install: Shell-Dateien. Spot-Daten liegen im localStorage (app-seitig).

const CACHE = 'spotfinder-v1';

const SHELL = [
  'index.html',
  'spot.html',
  'css/style.css',
  'js/app.js',
  'js/weather.js',
  'js/firebase.js',
  'js/geo.js',
  'manifest.json',
  '_IN/icon-192.png',
  '_IN/icon-512.png',
];

// Install: Shell cachen
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: alte Caches löschen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Cache first für Shell, Network first für API-Calls
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Externe Requests (Leaflet CDN, Open-Meteo, Firebase) → immer Network
  if (url.origin !== location.origin) {
    return; // kein intercept → Browser holt direkt
  }

  // Shell-Dateien → Cache first, Fallback Network
  event.respondWith(
    caches.match(request).then(cached => cached ?? fetch(request))
  );
});
