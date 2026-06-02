// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Cloudflare Worker Streaming Engine & Database Proxy
// Feature Stack: M3U8 Manifest Rewriting · PNG Segment Stripping · GA4 Endpoint Routing
// ═══════════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Helper for OPTIONS request
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Helper to respond with JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Pure Uint8Array high-performance wrapper stripping magic PNG headers from upstream TS
function stripPngMagic(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer);
  // PNG Magic Signature: 0x89 0x50 0x4e 0x47
  if (uint8.length > 70 && uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4e && uint8[3] === 0x47) {
    // Find absolute position of IEND marker: 0x49 0x45 0x4e 0x44
    let iendIdx = -1;
    for (let i = 0; i < uint8.length - 4; i++) {
      if (uint8[i] === 0x49 && uint8[i+1] === 0x45 && uint8[i+2] === 0x4e && uint8[i+3] === 0x44) {
        iendIdx = i;
        break;
      }
    }
    if (iendIdx >= 0) {
      const tsStart = iendIdx + 8; // Skip IEND chunk (4B magic + 4B CRC)
      return uint8.subarray(tsStart);
    }
  }
  return uint8;
}

export default {
  async fetch(request, env, ctx) {
    // ── OPTIONS Preflight Handshake ──
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const urlParsed = new URL(request.url);
    const path = urlParsed.pathname;
    const searchParams = urlParsed.searchParams;

    // ── Health Check ──
    if (path === '/health' || path === '/api/health') {
      return jsonResponse({ status: 'ok', worker: true, timestamp: new Date().toISOString() });
    }

    // ── GET /proxy — High-Fidelity Media & Subtitle Pass-Through ──
    if (path === '/proxy') {
      const targetUrl = searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing "url" query parameter' }, 400);
      }

      // Enforce strict player-only resource validation (Playlists, Video segments, Subtitles, and Player posters)
      let isPlayerResource = false;
      try {
        const urlObj = new URL(targetUrl);
        const pathnameLower = urlObj.pathname.toLowerCase();
        isPlayerResource = pathnameLower.endsWith('.m3u8') || 
                           pathnameLower.endsWith('.ts') || 
                           pathnameLower.endsWith('.vtt') || 
                           pathnameLower.endsWith('.srt') ||
                           pathnameLower.endsWith('.jpg') ||
                           pathnameLower.endsWith('.jpeg') ||
                           pathnameLower.endsWith('.png') ||
                           pathnameLower.endsWith('.webp') ||
                           targetUrl.toLowerCase().includes('m3u8') ||
                           targetUrl.toLowerCase().includes('.ts') ||
                           targetUrl.toLowerCase().includes('.vtt') ||
                           targetUrl.toLowerCase().includes('.srt');
      } catch (e) {
        isPlayerResource = false;
      }

      if (!isPlayerResource) {
        return jsonResponse({ error: 'Forbidden: Worker proxy is strictly dedicated to video player streaming resources.' }, 403);
      }

      // Check if this request is for a video segment (ends in .ts) or a subtitle file (ends in .vtt)
      const targetUrlLower = targetUrl.toLowerCase();
      const isCacheableMedia = targetUrlLower.endsWith('.ts') || targetUrlLower.endsWith('.vtt') ||
                               targetUrlLower.split('?')[0].endsWith('.ts') || targetUrlLower.split('?')[0].endsWith('.vtt');

      const cache = caches.default;

      if (isCacheableMedia) {
        let cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse; // Zero worker request overhead
        }
      }

      try {
        const upstream = await fetch(targetUrl, {
          headers: {
            'Referer': 'https://vibeplayer.site/',
            'Origin': 'https://vibeplayer.site',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Ch-Ua': '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
          },
          redirect: 'follow',
        });

        if (!upstream.ok) {
          return new Response(`Upstream returned status ${upstream.status}`, {
            status: upstream.status,
            headers: corsHeaders,
          });
        }

        const contentType = upstream.headers.get('content-type') || '';
        
        // 1. M3U8 Manifest Rewriting Engine
        const isManifest = targetUrl.endsWith('.m3u8') || contentType.includes('mpegurl');
        if (isManifest) {
          const body = await upstream.text();
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          const isMaster = body.includes('#EXT-X-STREAM-INF');

          const rewritten = body
            .split('\n')
            .map(line => {
              const trimmed = line.trim();

              if (isMaster && trimmed.startsWith('#EXT-X-STREAM-INF') && !trimmed.includes('CODECS')) {
                return trimmed.replace(
                  '#EXT-X-STREAM-INF:',
                  '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",'
                );
              }

              if (!trimmed || trimmed.startsWith('#')) {
                return line;
              }

              // Absolute URL Bypass Protection
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                // Bypass proxy completely for ByteDance/TikTok assets to avoid IP blocks
                if (trimmed.includes('ibyteimg.com') || trimmed.includes('byteimg.com')) {
                  return trimmed;
                }
                // Proxy all other video/playlist references through our worker carrying stealth headers
                return `/proxy?url=${encodeURIComponent(trimmed)}`;
              }

              // Relative URL resolution
              const absoluteUrl = new URL(trimmed, baseUrl).href;
              if (absoluteUrl.includes('ibyteimg.com') || absoluteUrl.includes('byteimg.com')) {
                return absoluteUrl;
              }
              return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            })
            .join('\n');

          return new Response(rewritten, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/vnd.apple.mpegurl',
            },
          });
        }

        // 2. Subtitle Pass-Through
        const isSubtitle = targetUrl.endsWith('.vtt') || targetUrl.endsWith('.srt') ||
          contentType.includes('text/vtt') || contentType.includes('subrip');
        if (isSubtitle) {
          const body = await upstream.text();
          const newHeaders = new Headers({
            ...corsHeaders,
            'Content-Type': 'text/vtt',
          });

          if (isCacheableMedia) {
            newHeaders.set('Cache-Control', 'public, max-age=86400');
          }

          const response = new Response(body, {
            status: 200,
            headers: newHeaders,
          });

          if (isCacheableMedia) {
            ctx.waitUntil(cache.put(request, response.clone()));
          }

          return response;
        }

        // 3. Binary / TS Segment Stripping
        const arrayBuffer = await upstream.arrayBuffer();
        const strippedBuffer = stripPngMagic(arrayBuffer);

        const newHeaders = new Headers({
          ...corsHeaders,
          'Content-Type': 'video/mp2t',
        });

        if (isCacheableMedia) {
          newHeaders.set('Cache-Control', 'public, max-age=86400');
        }

        const response = new Response(strippedBuffer, {
          status: 200,
          headers: newHeaders,
        });

        if (isCacheableMedia) {
          ctx.waitUntil(cache.put(request, response.clone()));
        }

        return response;

      } catch (err) {
        return new Response(`Proxy error: ${err.message}`, {
          status: 502,
          headers: corsHeaders,
        });
      }
    }

    // ── Catch-All 404 Response ──
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
