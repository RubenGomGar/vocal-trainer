// Resonar · service worker
// Cambia VERSION en cada despliegue (coincide con APP_VER del index.html) para limpiar la caché vieja.
const VERSION = '2026.11.04';
const CORE = `resonar-core-${VERSION}`;
const RUNTIME = `resonar-rt-${VERSION}`;
const CORE_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('resonar-') && k !== CORE && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fuentes de Google: caché primero (funcionan sin conexión tras la primera visita)
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Todo lo demás de fuera (YouTube, analítica) y la API: sin tocar
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas (index.html): red primero para recibir actualizaciones; si no hay red, la copia guardada
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith((async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (res.ok) (await caches.open(CORE)).put(url.pathname.endsWith('.html') ? req : 'index.html', res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Iconos, manifest y demás estáticos: caché primero, y se refresca en segundo plano
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(async res => {
      if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
