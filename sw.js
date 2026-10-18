/* Paprastas service worker: leidžia įdiegti programėlę ir greitai atidaryti svetainės apvalkalą.
   Duomenys (/api/*) niekada nekešuojami – jie visada imami iš serverio. */
const CACHE = 'lankomumas-v5';
const SHELL = ['./', 'index.html', 'styles.css', 'ui.js', 'auth.js', 'sync.js', 'log.js', 'activities.js', 'tools.js', 'app.js', 'favicon.svg', 'manifest.json', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  /* Pirmiausia tinklas (kad visada būtų naujausia versija), be ryšio – iš atminties. */
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
