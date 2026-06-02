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

// Helper to query Supabase REST API
async function supabaseFetch(path, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase URL or ANON Key is missing from Worker environment variables.');
  }
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase API responded with status ${res.status}: ${errorText}`);
  }
  return await res.json();
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
    // ── Global Environment Safety check ──
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return jsonResponse({
        error: 'Configuration Error',
        message: 'Supabase URL or ANON Key is missing from the Worker environment variables. Please configure SUPABASE_URL and SUPABASE_ANON_KEY in your Cloudflare dashboard.'
      }, 500);
    }

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

              // Inject HLS codecs if required
              if (isMaster && trimmed.startsWith('#EXT-X-STREAM-INF') && !trimmed.includes('CODECS')) {
                return trimmed.replace(
                  '#EXT-X-STREAM-INF:',
                  '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",'
                );
              }

              // Skip comments or empty lines
              if (!trimmed || trimmed.startsWith('#')) {
                return line;
              }

              // Absolute URL
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                return `/proxy?url=${encodeURIComponent(trimmed)}`;
              }

              // Relative URL resolution
              const absoluteUrl = new URL(trimmed, baseUrl).href;
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

    // ── GET /api/catalog ──
    if (path === '/api/catalog') {
      try {
        const data = await supabaseFetch('anime_list?select=id,title,poster,s_eps,s_m3u8_url,d_m3u8_url,description&order=title.asc', env);
        return jsonResponse(data || []);
      } catch (err) {
        return jsonResponse({ error: 'Failed to load catalog', message: err.message }, 500);
      }
    }

    // ── GET /api/search ──
    if (path === '/api/search') {
      const query = searchParams.get('q');
      if (!query) {
        return jsonResponse({ error: 'Missing query parameter "q"' }, 400);
      }
      try {
        const data = await supabaseFetch(`anime_list?select=id,title,poster,s_eps,s_m3u8_url,d_m3u8_url,description&title=ilike.*${encodeURIComponent(query)}*&limit=24`, env);
        return jsonResponse(data || []);
      } catch (err) {
        return jsonResponse({ error: 'Failed to search catalog', message: err.message }, 500);
      }
    }

    // ── GET /api/trending/spotlight ──
    if (path === '/api/trending/spotlight') {
      try {
        const trendData = await supabaseFetch('anime_list_trending?select=id,spot&spot=not.is.null&order=spot.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        // Build the clean postgrest IN array query parameters
        const idQueryString = ids.join(',');
        const animeData = await supabaseFetch(`anime_list?select=id,title,description,poster,s_eps,s_m3u8_url,d_m3u8_url&id=in.(${idQueryString})`, env);

        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, spot: t.spot } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ 
          error: true, 
          endpoint: "spotlight", 
          details: err.message, 
          stack: err.stack 
        }, 500);
      }
    }

    // ── GET /api/trending/now ──
    if (path === '/api/trending/now') {
      try {
        const trendData = await supabaseFetch('anime_list_trending?select=id,no&no=not.is.null&order=no.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        // Build the clean postgrest IN array query parameters
        const idQueryString = ids.join(',');
        const animeData = await supabaseFetch(`anime_list?select=id,title,description,poster,s_eps,s_m3u8_url,d_m3u8_url&id=in.(${idQueryString})`, env);

        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, no: t.no } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ 
          error: true, 
          endpoint: "trending", 
          details: err.message, 
          stack: err.stack 
        }, 500);
      }
    }

    // ── GET /api/trending/top10 ──
    if (path === '/api/trending/top10') {
      try {
        const trendData = await supabaseFetch('anime_list_trending?select=id,T10&T10=not.is.null&order=T10.asc', env);
        if (!trendData || trendData.length === 0) return jsonResponse([]);
        const ids = trendData.map(item => item.id).filter(Boolean);
        if (ids.length === 0) return jsonResponse([]);

        // Build the clean postgrest IN array query parameters
        const idQueryString = ids.join(',');
        const animeData = await supabaseFetch(`anime_list?select=id,title,description,poster,s_eps,s_m3u8_url,d_m3u8_url&id=in.(${idQueryString})`, env);

        const mapped = trendData.map(t => {
          const anime = animeData.find(a => a.id === t.id);
          return anime ? { ...anime, T10: t.T10 } : null;
        }).filter(Boolean);

        return jsonResponse(mapped);
      } catch (err) {
        return jsonResponse({ 
          error: true, 
          endpoint: "top10", 
          details: err.message, 
          stack: err.stack 
        }, 500);
      }
    }

    // ── GET /api/anime/:id ──
    const animeMatch = path.match(/^\/api\/anime\/([^/]+)$/);
    if (animeMatch) {
      const id = animeMatch[1];
      try {
        const list = await supabaseFetch(`anime_list?select=id,title,description,poster,s_eps,s_m3u8_url,d_m3u8_url&id=eq.${encodeURIComponent(id)}`, env);
        const item = list[0];
        if (!item) {
          return jsonResponse({ error: 'Anime not found', id }, 404);
        }
        return jsonResponse(item);
      } catch (err) {
        return jsonResponse({ error: 'Failed to query anime', message: err.message }, 500);
      }
    }

    // ── GET /api/anime/:id/recommendations ──
    const recMatch = path.match(/^\/api\/anime\/([^/]+)\/recommendations$/);
    if (recMatch) {
      const id = recMatch[1];
      try {
        const list = await supabaseFetch(`anime_list?select=id,title,description&id=eq.${encodeURIComponent(id)}`, env);
        const currentAnime = list[0];
        if (!currentAnime) {
          return jsonResponse({ error: 'Anime not found' }, 404);
        }

        const titleTokens = (currentAnime.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 3);

        const descTokens = (currentAnime.description || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4);

        const allTokens = [...new Set([...titleTokens, ...descTokens])].slice(0, 15);

        let results = [];
        if (allTokens.length > 0) {
          const orConditions = allTokens.map(token => `title.ilike.*${encodeURIComponent(token)}*,description.ilike.*${encodeURIComponent(token)}*`).join(',');
          try {
            results = await supabaseFetch(`anime_list?select=id,title,poster,s_eps,s_m3u8_url,d_m3u8_url,description&id=neq.${encodeURIComponent(id)}&or=(${orConditions})&limit=50`, env);
          } catch (e) {
            results = [];
          }
        }

        if (results.length < 10) {
          try {
            const fallbackData = await supabaseFetch(`anime_list?select=id,title,poster,s_eps,s_m3u8_url,d_m3u8_url,description&id=neq.${encodeURIComponent(id)}&limit=30`, env);
            const existingIds = new Set(results.map(r => r.id));
            const filteredFallback = fallbackData.filter(item => !existingIds.has(item.id));
            results = [...results, ...filteredFallback];
          } catch (e) {}
        }

        const shuffled = results.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 10);
        return jsonResponse(selected);
      } catch (err) {
        return jsonResponse({ error: 'Failed to get recommendations', message: err.message }, 500);
      }
    }

    // ── POST /api/next-episode ──
    if (path === '/api/next-episode' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const { anime_id, current_number } = body;

        if (!anime_id || current_number === undefined || current_number === null) {
          return jsonResponse({ error: 'Missing required fields: anime_id, current_number' }, 400);
        }

        const currentNum = Number(current_number);
        if (isNaN(currentNum)) {
          return jsonResponse({ error: 'current_number must be a number' }, 400);
        }

        const list = await supabaseFetch(`anime_list?select=id,title,s_m3u8_url,d_m3u8_url,s_eps,poster&id=eq.${encodeURIComponent(anime_id)}`, env);
        const data = list[0];
        if (!data) {
          return jsonResponse({ error: 'Anime not found in database', anime_id }, 404);
        }

        let episodes = data.s_m3u8_url;
        if (typeof episodes === 'string') {
          try {
            episodes = JSON.parse(episodes);
          } catch (e) {
            episodes = [];
          }
        }

        if (!Array.isArray(episodes) || episodes.length === 0) {
          return jsonResponse({ error: 'No episodes available for this anime', anime_id }, 404);
        }

        const sortedEps = episodes
          .map(ep => {
            const urlStr = (ep.url || ep.link || ep.m3u8 || '').trim();
            return { number: Number(ep.number), url: urlStr };
          })
          .filter(ep => !isNaN(ep.number) && ep.url !== '')
          .sort((a, b) => a.number - b.number);

        const nextEpisode = sortedEps.find(ep => ep.number > currentNum);

        if (!nextEpisode) {
          return jsonResponse({
            status: 'series_complete',
            anime_id,
            title: data.title,
            current_number: currentNum,
            message: `No episodes after Ep ${currentNum}. Series complete.`,
          });
        }

        const expectedNext = currentNum + 1;
        return jsonResponse({
          status: 'next_episode',
          anime_id,
          title: data.title,
          current_number: currentNum,
          next_number: nextEpisode.number,
          next_url: nextEpisode.url,
          gap_jumped: nextEpisode.number !== expectedNext,
          poster: data.poster || null,
        });
      } catch (err) {
        return jsonResponse({ error: 'Failed to process next-episode API', message: err.message }, 500);
      }
    }

    // ── Catch-All 404 Response ──
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
