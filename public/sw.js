// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Hybrid-Secured Interceptor Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] Installed. skipping waiting phase.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated. Securely claiming clients.');
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
      // Manifests and subtitles route through our secure Vercel server proxy
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
                
                // Codec injection on all streaming infrastructure indicators
                if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
                  if (trimmed.includes('CODECS=')) {
                    trimmed = trimmed.replace(/CODECS="[^"]*"/, 'CODECS="avc1.64001f,mp4a.40.2"');
                  } else {
                    trimmed = trimmed.replace('#EXT-X-STREAM-INF:', '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",');
                  }
                  return trimmed;
                }
                
                // Deep Path Rewriting: rewrite relative/absolute paths to client-proxy
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
              const body = await response.text();
              return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            }

            return response;
          })
          .catch(() => new Response('', { status: 200 }))
      );
    } else {
      // Direct direct-fetch bypassing with no-cors and spoofed Referer for heavy video chunks (.ts)
      const modifiedRequest = new Request(targetUrlStr, {
        method: 'GET',
        headers: { 'Referer': 'https://vibeplayer.site/' },
        mode: 'no-cors'
      });
      event.respondWith(fetch(modifiedRequest));
    }
  }
});
