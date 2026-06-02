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

const SUPABASE_API_URL = 'https://ucgxzganknweqfucjqqw.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxOTk3MzcsImV4cCI6MjA5NDc3NTczN30.S1oOUCz6bhXGcULeZPA3Uc7w33_Q-UGAjRH_FEPuCjo';

async function supabaseFetch(path, env) {
  const url = `${env.SUPABASE_URL || SUPABASE_API_URL}${path}`;
  const key = env.SUPABASE_ANON_KEY || SUPABASE_KEY;
  const res = await fetch(url, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.json();
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

    // ── Trending Spotlight Endpoint ──
    if (path === '/api/trending/spotlight') {
      try {
        const trendData = await supabaseFetch('/anime_list_trending?spot=not.is.null&order=spot.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        const animeData = await supabaseFetch(`/anime_list?select=id,title,description,poster,s_eps,d_eps,type,status,studios,producers,genre,mal_score,duration,premiered,aired,jp_titles,s_m3u8_url,d_m3u8_url&id=in.(${ids.join(',')})`, env);
        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, spot: t.spot } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ error: true, message: err.message }, 500);
      }
    }

    // ── Trending Now Endpoint ──
    if (path === '/api/trending/now') {
      try {
        const trendData = await supabaseFetch('/anime_list_trending?no=not.is.null&order=no.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        const animeData = await supabaseFetch(`/anime_list?select=id,title,description,poster,s_eps,d_eps,type,status,studios,producers,genre,mal_score,duration,premiered,aired,jp_titles,s_m3u8_url,d_m3u8_url&id=in.(${ids.join(',')})`, env);
        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, no: t.no } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ error: true, message: err.message }, 500);
      }
    }

    // ── Top 10 Global Endpoint ──
    if (path === '/api/trending/top10') {
      try {
        const trendData = await supabaseFetch('/anime_list_trending?T10=not.is.null&order=T10.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        const animeData = await supabaseFetch(`/anime_list?select=id,title,description,poster,s_eps,d_eps,type,status,studios,producers,genre,mal_score,duration,premiered,aired,jp_titles,s_m3u8_url,d_m3u8_url&id=in.(${ids.join(',')})`, env);
        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, T10: t.T10 } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ error: true, message: err.message }, 500);
      }
    }

    // ── GET /proxy — High-Fidelity Media Pass-Through ──
    if (path === '/proxy') {
      const targetUrl = searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing "url" query parameter' }, 400);
      }

      // Keep the worker active only for manifest files (.m3u8), subtitle tracks (.vtt), and poster images
      let isManifest = false;
      let isAllowed = false;
      try {
        const urlObj = new URL(targetUrl);
        const pathnameLower = urlObj.pathname.toLowerCase();
        isManifest = pathnameLower.endsWith('.m3u8') || 
                     targetUrl.toLowerCase().includes('m3u8') || 
                     targetUrl.toLowerCase().includes('mpegurl');
        
        isAllowed = isManifest ||
                    pathnameLower.endsWith('.vtt') ||
                    pathnameLower.endsWith('.webp') ||
                    pathnameLower.endsWith('.png') ||
                    pathnameLower.endsWith('.jpg') ||
                    pathnameLower.endsWith('.jpeg') ||
                    targetUrl.toLowerCase().includes('.vtt');
      } catch (e) {
        isAllowed = false;
      }

      if (!isAllowed) {
        return jsonResponse({ error: 'Forbidden: Worker proxy is strictly dedicated to manifests, subtitles, and images.' }, 403);
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

        // If it's not a manifest, pass the response directly through with original content-type
        if (!isManifest) {
          const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
          const bodyBuffer = await upstream.arrayBuffer();
          return new Response(bodyBuffer, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': contentType,
            }
          });
        }

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

            // Split-traffic logic: proxy all sub-playlists (.m3u8) and bypass proxy for video segments
            const isPlaylist = trimmed.endsWith('.m3u8') || trimmed.includes('.m3u8?') || trimmed.includes('.m3u8&');

            let absoluteUrl = trimmed;
            if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
              absoluteUrl = new URL(trimmed, baseUrl).href;
            }

            if (isPlaylist) {
              return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            } else {
              return absoluteUrl;
            }
          })
          .join('\n');

        return new Response(rewritten, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/vnd.apple.mpegurl',
          },
        });

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
