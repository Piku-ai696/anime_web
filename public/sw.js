// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Transparent Header Spoof Media Proxy Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept any request where the URL targets vibeplayer.site
  if (url.origin.includes('vibeplayer.site') || url.hostname.includes('vibeplayer.site')) {
    const isManifest = url.pathname.includes('.m3u8');
    const isSegment  = url.pathname.includes('.ts');

    const headers = new Headers(event.request.headers);
    headers.set('Referer', 'https://vibeplayer.site/');
    headers.set('Origin', 'https://vibeplayer.site');

    const fetchOptions = {
      method: event.request.method,
      headers: headers,
    };

    if (isManifest) {
      fetchOptions.mode = 'cors';
    } else if (isSegment) {
      fetchOptions.mode = 'no-cors';
    }

    const modifiedRequest = new Request(event.request.url, fetchOptions);
    event.respondWith(
      fetch(modifiedRequest).then(res => {
        if (res.type === 'opaque') {
          return res;
        }

        // Enforce CORS headers for local reading compatibility
        const responseHeaders = new Headers(res.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        
        if (isManifest) {
          responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (isSegment) {
          responseHeaders.set('Content-Type', 'video/mp2t');
        }

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders
        });
      }).catch(err => {
        console.error('[SW Spoof] Intercepted fetch failed:', err);
        return new Response('', { status: 200 });
      })
    );
  }
});
