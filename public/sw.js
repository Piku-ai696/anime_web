// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Traffic Stealth Controller Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // If the URL is a video segment (.ts), direct fetch with spoofed Referer in no-cors mode
  if (event.request.url.includes('.ts')) {
    const modifiedRequest = new Request(event.request.url, {
      method: 'GET',
      headers: {
        'Referer': 'https://vibeplayer.site/'
      },
      mode: 'no-cors'
    });
    event.respondWith(fetch(modifiedRequest));
  }
});
