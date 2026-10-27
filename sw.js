/* Service worker EDO // COMMAND
   - Met en cache la coquille de l'app (HTML/CSS/JS/icônes) pour un démarrage instantané et l'installation sur mobile.
   - Les données (Firestore/Auth) ne sont JAMAIS mises en cache ici : elles passent toujours par le réseau.
   - Après un déploiement, incrémente CACHE_VERSION pour forcer la mise à jour chez tout le monde. */
const CACHE_VERSION = 'edo-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN, Firebase, polices : réseau direct
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});
