// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Direct Header Injection Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.url.includes('vibeplayer.site')) {
    const isManifest = event.request.url.includes('.m3u8');
    
    const headers = new Headers(event.request.headers);
    headers.set('Referer', 'https://vibeplayer.site/');
    headers.set('Origin', 'https://vibeplayer.site');

    const fetchOptions = {
      method: event.request.method,
      headers: headers,
      mode: isManifest ? 'cors' : 'no-cors'
    };

    const modifiedRequest = new Request(event.request.url, fetchOptions);
    event.respondWith(
      fetch(modifiedRequest).then(res => {
        if (res.type === 'opaque') {
          return res;
        }

        const responseHeaders = new Headers(res.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set(
          'Content-Type',
          isManifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
        );

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders
        });
      }).catch(err => {
        console.error('[SW Injection] Intercepted fetch failed:', err);
        return new Response('', { status: 200 });
      })
    );
  }
});
