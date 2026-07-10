/* Service worker INNOVACOM ERP
 * Estrategia:
 *  - Navegación (index.html): SIEMPRE red primero — evita servir versiones viejas
 *    (mismo criterio que el Cache-Control: no-cache de Apache).
 *  - Assets con hash (/assets/*.js|css): cache primero — inmutables por nombre.
 *  - /api y /outputs: nunca se cachean ni interceptan.
 */
const CACHE = 'innovacom-v2';
const STATIC_PATHS = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/logo_innovacom.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API, PDFs generados y peticiones no-GET: directo a la red, sin tocar
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/outputs')) return;

  // Navegación: red primero, fallback al cache si no hay conexión
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Assets estáticos: cache primero, luego red (y se guarda copia)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || STATIC_PATHS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
