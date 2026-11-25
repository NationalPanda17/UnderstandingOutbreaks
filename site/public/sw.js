/* Offline support for Understanding Outbreaks. Pages and data files this browser has already fetched are kept in the
   browser's own cache on this device, so they open again without a connection. Nothing is sent anywhere, nothing is
   fetched ahead of time, and only this site's own files are kept. When there is a connection the network copy always
   wins for pages and data, so a cached copy is never shown in place of newer figures. */
const VERSION = 'uo-v1';
const SHELL = VERSION + '-shell';   // pages and build files
const DATA = VERSION + '-data';     // data files, capped
const DATA_MAX = 400;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!name.startsWith(VERSION)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - DATA_MAX))) await cache.delete(req);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic' && !res.redirected) {
      await cache.put(request, res.clone());
      if (cacheName === DATA) trim(cache);
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.headers.has('range')) return;
  if (url.pathname.startsWith('/embed')) return;                      // embedded charts are served as usual
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req)); return; }   // file names change with every build
  if (url.pathname.startsWith('/data/')) { event.respondWith(networkFirst(req, DATA)); return; }
  if (req.mode === 'navigate') {
    // offline, a page never opened before falls back to the home page of its language, which the app then routes
    const home = '/' + (url.pathname.split('/')[1] || 'en') + '/';
    event.respondWith(networkFirst(req, SHELL, home));
    return;
  }
  if (/\.(js|css|svg|png|woff2|json)$/.test(url.pathname)) event.respondWith(networkFirst(req, SHELL));
});
