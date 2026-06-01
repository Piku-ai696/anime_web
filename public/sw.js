// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Client-Side Local Proxy Service Worker
// Intercepts and proxies stream segments and subtitles natively in the browser.
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installed.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activated and claiming control.');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept requests targeting our local client-proxy flag
  if (url.pathname.includes('/client-proxy')) {
    const targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) {
      return event.respondWith(new Response('Missing target URL parameter', { status: 400 }));
    }

    // Build the request headers bypassing origin security
    const headers = new Headers();
    headers.set('Referer', 'https://vibeplayer.site/');
    headers.set('Origin', 'https://vibeplayer.site');
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Include downstream range headers if present in VideoJS requests
    const rangeHeader = event.request.headers.get('range');
    if (rangeHeader) {
      headers.set('Range', rangeHeader);
    }

    const modifiedRequest = new Request(targetUrlStr, {
      method: 'GET',
      headers: headers,
      mode: 'cors',
      credentials: 'omit',
      referrer: 'https://vibeplayer.site/',
      referrerPolicy: 'unsafe-url',
      redirect: 'follow'
    });

    event.respondWith(
      fetch(modifiedRequest)
        .then(async (response) => {
          if (!response.ok) {
            console.warn('[SW Proxy] Upstream returned error:', response.status, targetUrlStr);
            return response;
          }

          const contentType = response.headers.get('content-type') || '';
          const isManifest = targetUrlStr.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL');

          // If the request targets an HLS manifest, rewrite all links locally
          if (isManifest) {
            const body = await response.text();
            const baseUrl = targetUrlStr.substring(0, targetUrlStr.lastIndexOf('/') + 1);
            const isMaster = body.includes('#EXT-X-STREAM-INF');

            const rewritten = body
              .split('\n')
              .map(line => {
                const trimmed = line.trim();

                // Inject CODECS into master manifest for Video.js VHS detection
                if (isMaster && trimmed.startsWith('#EXT-X-STREAM-INF') && !trimmed.includes('CODECS')) {
                  return trimmed.replace(
                    '#EXT-X-STREAM-INF:',
                    '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",'
                  );
                }

                // Skip comments and descriptors
                if (!trimmed || trimmed.startsWith('#')) {
                  return line;
                }

                // Absolute URLs
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                  return `/client-proxy?url=${encodeURIComponent(trimmed)}`;
                }

                // Relative URLs
                const absoluteUrl = new URL(trimmed, baseUrl).href;
                return `/client-proxy?url=${encodeURIComponent(absoluteUrl)}`;
              })
              .join('\n');

            return new Response(rewritten, {
              status: response.status,
              statusText: response.statusText,
              headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Origin, Accept'
              }
            });
          }

          // Read body as ArrayBuffer for binary stripping if segment
          let buffer = await response.arrayBuffer();
          let uint8 = new Uint8Array(buffer);

          // PNG magic: 89 50 4E 47
          if (uint8.length > 70 && uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47) {
            // Find IEND marker: 49 45 4E 44
            let iendIdx = -1;
            for (let i = 0; i < uint8.length - 4; i++) {
              if (uint8[i] === 0x49 && uint8[i+1] === 0x45 && uint8[i+2] === 0x4E && uint8[i+3] === 0x44) {
                iendIdx = i;
                break;
              }
            }
            if (iendIdx >= 0) {
              const tsStart = iendIdx + 8; // Skip past IEND chunk (4 marker + 4 CRC)
              const tsData = uint8.subarray(tsStart);
              buffer = tsData.buffer;
              console.log(`[SW Proxy] ⚡ Stripped PNG wrapper inside browser! TS size: ${tsData.byteLength}B`);
            }
          }

          // Generate response with fully opened access headers
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set('Access-Control-Allow-Origin', '*');
          responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
          responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Origin, Accept');

          // Force subtitle tracks content-type if matching VTT
          if (targetUrlStr.endsWith('.vtt') || targetUrlStr.endsWith('.srt') || contentType.includes('text/vtt')) {
            responseHeaders.set('Content-Type', 'text/vtt');
          }

          return new Response(buffer, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        })
        .catch((err) => {
          console.error('[SW Proxy] Intercept fetch failed:', targetUrlStr, err);
          return new Response('Local Proxy Intercept Failed: ' + err.message, { status: 502 });
        })
    );
  }
});
