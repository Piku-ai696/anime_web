// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Force-Activating Media Proxy Service Worker
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] Installed. Forcing skipWaiting.');
  self.skipWaiting(); // Instantly kill the old worker
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated. Claiming clients immediately.');
  event.waitUntil(
    self.registration.unregister().then(() => self.clients.claim()).then(() => {
      // Force all open tabs to update immediately
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => client.navigate(client.url));
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/client-proxy')) {
    const targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) return;

    const isManifest = targetUrlStr.includes('.m3u8');
    const isSubtitle = targetUrlStr.includes('.vtt');

    if (isManifest || isSubtitle) {
      // Route manifests and subtitles through Vercel server proxy to bypass Referer blocks safely
      const proxiedUrl = '/api/proxy?url=' + encodeURIComponent(targetUrlStr);
      
      event.respondWith(
        fetch(proxiedUrl)
          .then(async (response) => {
            if (!response.ok) return response;

            const newHeaders = new Headers(response.headers);
            newHeaders.set('Access-Control-Allow-Origin', '*');

            if (isManifest) {
              // FORCE HLS Content-Type so Video.js recognizes it
              newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
              
              let body = await response.text();
              const baseUrl = targetUrlStr.substring(0, targetUrlStr.lastIndexOf('/') + 1);
              
              // BULLETPROOF CODEC INJECTION: Enforce strict video profiles on every playlist descriptor
              const lines = body.split('\n').map(line => {
                let trimmed = line.trim();
                
                if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
                  // If it has a custom codec or lacks one, clear it and force standard AVC/AAC compatibility strings
                  if (trimmed.includes('CODECS=')) {
                    trimmed = trimmed.replace(/CODECS="[^"]*"/, 'CODECS="avc1.64001f,mp4a.40.2"').replace(/CODECS=[^,\s]*/, 'CODECS="avc1.64001f,mp4a.40.2"');
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

            return new Response(response.body, { headers: newHeaders });
          })
          .catch(() => new Response('', { status: 200 }))
      );
    } else {
      // Direct stream binary video chunks (.ts)
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
