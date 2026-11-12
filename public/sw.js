// Minimal service worker — sadece PWA kurulabilirliği için, cache yok (veriler her zaman canlı)
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  // Cache kullanma — her istek doğrudan ağa gitsin
  e.respondWith(fetch(e.request));
});
