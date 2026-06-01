// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Codec-Injecting Stealth Media Proxy Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // If the request targets HLS master manifests or sub-playlists (.m3u8)
  if (event.request.url.includes('.m3u8')) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (!response.ok) return response;

          const newHeaders = new Headers(response.headers);
          newHeaders.set('Access-Control-Allow-Origin', '*');
          newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');

          let body = await response.text();
          const lines = body.split('\n').map(line => {
            let trimmed = line.trim();
            if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
              if (trimmed.includes('CODECS=')) {
                trimmed = trimmed.replace(/CODECS="[^"]*"/, 'CODECS="avc1.64001f,mp4a.40.2"');
              } else {
                trimmed = trimmed.replace('#EXT-X-STREAM-INF:', '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",');
              }
              return trimmed;
            }
            return line;
          });

          return new Response(lines.join('\n'), {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        })
        .catch(err => {
          console.error('[SW Manifest] Interceptor error:', err);
          return new Response('', { status: 200 });
        })
    );
    return;
  }

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
