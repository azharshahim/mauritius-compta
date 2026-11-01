/*
 * COMPTAI service worker — installability shell only.
 *
 * Deliberately performs no caching: accounting data must always come from the
 * live API (or from the explicit browser demo), never from a stale HTTP cache
 * managed by this file. The fetch handler exists so Android/Windows can install
 * the manifest as an application; it lets every request go to the network.
 *
 * If a future mission adds offline support, bump CACHE_VERSION and delete only
 * caches with the COMPTAI prefix — never touch unrelated origins.
 */
const CACHE_VERSION = 'comptai-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('comptai-shell-') && name !== CACHE_VERSION)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', () => {
  // No respondWith(): the browser handles the request normally. This keeps the
  // real application online-only and avoids ever serving fictional demo data in
  // place of a failed API call.
});
