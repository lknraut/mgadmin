/* Maa Gayatri POS — service worker
 * Makes index.html open and bill with NO internet.
 * - index.html: tries the network first (so updates arrive automatically), falls back to the
 *   saved copy instantly when offline or if the network takes more than 3 seconds.
 * - icons / manifest / Firebase scripts: saved once, then served from the device.
 * manage.html is NOT touched by this worker.
 */
const CACHE = 'mghr-pos-v1';          // change this only if you rename/add shell files
const SCOPE = self.registration.scope;
const INDEX_URL = new URL('./index.html', SCOPE).href;
const SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png']
  .map(p => new URL(p, SCOPE).href);
const CDN = [
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    for (const u of CDN) {                       // best effort; also filled at runtime
      try { await cache.put(u, await fetch(u, { mode: 'no-cors' })); } catch (e) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function networkFirstIndex(req) {
  return new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(INDEX_URL).then(r => r || Response.error());
    const timer = setTimeout(() => { if (!done) { done = true; fromCache().then(resolve); } }, 3000);
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(INDEX_URL, copy));
      }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => {
      if (!done) { done = true; clearTimeout(timer); fromCache().then(resolve); }
    });
  });
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  try { const c = await caches.open(CACHE); await c.put(req, res.clone()); } catch (e) {}
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isRoot = url.href === SCOPE;
    const isIndex = url.href.split('?')[0] === INDEX_URL;
    if (req.mode === 'navigate' && (isRoot || isIndex)) {
      event.respondWith(networkFirstIndex(req));
      return;
    }
    if (SHELL.includes(url.href.split('?')[0])) {
      event.respondWith(cacheFirst(req));
      return;
    }
    return;                                     // manage.html etc. → normal network
  }

  if (CDN.includes(req.url)) event.respondWith(cacheFirst(req));
});
