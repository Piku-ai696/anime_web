// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Transparent Redirector Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  const isManifest = url.pathname.includes('.m3u8');
  const isSubtitle = url.pathname.includes('.vtt');

  if (isManifest || isSubtitle) {
    // Prevent double proxy loop
    if (url.pathname.includes('/api/proxy') || url.pathname.includes('/proxy')) {
      return;
    }

    const targetUrl = event.request.url;
    const proxiedUrl = '/api/proxy?url=' + encodeURIComponent(targetUrl);
    event.respondWith(
      fetch(proxiedUrl)
    );
  }
});
