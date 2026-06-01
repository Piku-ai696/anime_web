// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Standard High-Stability Media Proxy Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] Installed. Skipping waiting phase.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated. Securely claiming clients.');
  // Wrap clients.claim inside waitUntil to completely avoid InvalidStateError crashes
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/client-proxy')) {
    const targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) return;

    const isManifest = targetUrlStr.includes('.m3u8');
    const isSubtitle = targetUrlStr.includes('.vtt');

    if (isManifest || isSubtitle) {
      const proxiedUrl = '/api/proxy?url=' + encodeURIComponent(targetUrlStr);
      
      event.respondWith(
        fetch(proxiedUrl)
          .then(async (response) => {
            if (!response.ok) return response;

            const newHeaders = new Headers(response.headers);
            newHeaders.set('Access-Control-Allow-Origin', '*');

            if (isManifest) {
              newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
              
              let body = await response.text();
              const baseUrl = targetUrlStr.substring(0, targetUrlStr.lastIndexOf('/') + 1);
              
              const lines = body.split('\n').map(line => {
                let trimmed = line.trim();
                
                // Unconditional codec injection on all streaming infrastructure indicators
                if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
                  if (trimmed.includes('CODECS=')) {
                    trimmed = trimmed.replace(/CODECS="[^"]*"/, 'CODECS="avc1.64001f,mp4a.40.2"');
                  } else {
                    trimmed = trimmed.replace('#EXT-X-STREAM-INF:', '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",');
                  }
                  return trimmed;
                }
                
                if (trimmed && !trimmed.startsWith('#')) {
                  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    return `/client-proxy?url=${encodeURIComponent(trimmed)}`;
                  }
                  const absoluteUrl = new URL(trimmed, baseUrl).href;
                  return `/client-proxy?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
              });

              return new Response(lines.join('\n'), {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            }

            if (isSubtitle) {
              newHeaders.set('Content-Type', 'text/vtt');
            }

            return response;
          })
          .catch(() => new Response('', { status: 200 }))
      );
    } else {
      // Direct pass-through routing for segment media payloads (.ts)
      const modifiedRequest = new Request(targetUrlStr, {
        method: 'GET',
        headers: { 'Referer': 'https://vibeplayer.site/' },
        mode: 'no-cors'
      });
      event.respondWith(
        fetch(modifiedRequest).then(res => {
          const streamHeaders = new Headers(res.headers);
          streamHeaders.set('Content-Type', 'video/mp2t');
          streamHeaders.set('Access-Control-Allow-Origin', '*');
          return new Response(res.body, { headers: streamHeaders });
        })
      );
    }
  }
});
