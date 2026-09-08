/**
 * sw.js — DigiPoke service worker.
 *
 * Caching strategy
 * ----------------
 *  • App shell (HTML/CSS/JS/icons): pre-cached on install, served cache-first
 *    so the app opens instantly and works with no network at all.
 *  • Same-origin static assets: stale-while-revalidate (instant + fresh next time).
 *  • /v1/* (sync API): network-only. Encrypted vault blobs must never be served
 *    from cache; offline, the call fails and the client falls back to local data.
 *  • Navigations: network-first, falling back to the cached shell (offline SPA).
 *
 * Updating: bump CACHE_VERSION. The new worker installs alongside the old one
 * and activates once every client using the old version is closed (skipWaiting
 * is intentionally NOT called, so we never swap assets out from under a running
 * battle).
 */

const CACHE_VERSION = 'digipoke-v1.0.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/** Files that must exist offline for the app to boot. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './styles/tokens.css',
  './styles/app.css',
  './src/main.js',
  './src/core/bus.js',
  './src/core/crypto.js',
  './src/core/db.js',
  './src/core/rng.js',
  './src/core/router.js',
  './src/core/sfx.js',
  './src/core/state.js',
  './src/domain/battle.js',
  './src/domain/capture.js',
  './src/domain/creature.js',
  './src/domain/moves.js',
  './src/domain/progression.js',
  './src/domain/species.js',
  './src/domain/types.js',
  './src/domain/zones.js',
  './src/ui/dom.js',
  './src/ui/sprite.js',
  './src/ui/tamerAvatar.js',
  './src/ui/components.js',
  './src/ui/screens/onboarding.js',
  './src/ui/screens/dashboard.js',
  './src/ui/screens/ranch.js',
  './src/ui/screens/explore.js',
  './src/ui/screens/battle.js',
  './src/ui/screens/lab.js',
  './src/ui/screens/settings.js',
  './src/sync/syncClient.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => null)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache the sync API.
  if (url.pathname.includes('/v1/')) return;

  // Cross-origin: let it through untouched.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/** Navigation: prefer network, fall back to the cached shell. */
async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    cache.put('./index.html', fresh.clone());
    return fresh;
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

/** Static assets: serve cache immediately, refresh in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const shell = await caches.open(SHELL_CACHE);
  const fromShell = await shell.match(request);
  if (fromShell) return fromShell;

  return (await network) || new Response('Offline and not cached.', { status: 504, statusText: 'Offline' });
}
