const CACHE = 'mvpo-v1';

const ASSETS = [
  '/',
  '/app.html',
  '/promocion.html',
  '/perfil.html',
  '/admin.html',
  '/js/api.js',
  '/manifest.json'
];

// ── Install: pre-cachear assets estáticos ─────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: limpiar cachés antiguas ─────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: API → network first; resto → cache first ───────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Ignorar peticiones cross-origin (CDN, Mapbox, etc.) — dejar pasar sin interceptar
  if (url.origin !== self.location.origin) return;

  // API: siempre red, sin caché
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Assets estáticos: cache first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((response) => {
          // Cachear solo respuestas válidas del mismo origen
          if (
            response.ok &&
            url.origin === self.location.origin &&
            e.request.method === 'GET'
          ) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: devolver index.html para navegación SPA
          if (e.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
    })
  );
});
