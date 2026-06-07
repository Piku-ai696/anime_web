export default {
  async fetch(request, env, ctx) {
    // Apply absolute wild-card CORS headers to all routes
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Automatically return an empty Status 200 on all HTTP 'OPTIONS' requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Credentials & Permissions
    const supabaseUrl = "https://ucgxzganknweqfucjqqw.supabase.co";
    const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

    const url = new URL(request.url);

    // Path Route A: '/api/home' (Dashboard Delivery Engine or Cached Search Gateway)
    if (url.pathname === '/api/home' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        const search = url.searchParams.get("search");
        const genre = url.searchParams.get("genre");
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");
        const premiered = url.searchParams.get("premiered");

        // Protective parameters sanitization helper function
        function getValidParam(val) {
          if (!val) return null;
          const s = val.trim();
          if (s === "" || s.toLowerCase().includes("choose") || s.toLowerCase() === "all" || s.toLowerCase() === "select" || s.startsWith("Choose")) return null;
          return s;
        }

        const isFiltering = !!(getValidParam(search) || getValidParam(genre) || getValidParam(status) || getValidParam(type) || getValidParam(premiered));

        if (isFiltering) {
          // STATIC CACHE KEY IDENTIFIER URL
          const cacheKey = "https://zyrox-proxy.internal/api/library_dump_cache";
          
          const cache = caches.default;
          let cachedResponse = null;
          try {
            cachedResponse = await cache.match(cacheKey);
          } catch (e) {
            console.warn("[Edge Worker] Cache match warning:", e.message);
          }

          if (cachedResponse) {
            return cachedResponse.clone();
          }

          // If a cache miss occurs, pull the whole master table cleanly from Supabase
          const searchUrl = `${supabaseUrl}/rest/v1/anime_list1?select=*`;

          const res = await fetch(searchUrl, {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          });

          if (!res.ok) {
            throw new Error(`HTTP error ${res.status} performing search data dump`);
          }

          const data = await res.json();
          const mappedData = Array.isArray(data) ? data.map(mapItem).filter(x => x !== null) : [];
          
          const finalPayload = JSON.stringify({
            status: "success",
            data: mappedData
          });

          try {
            // Save to cache with 1-hour Edge Memory Cache block and CORS headers
            ctx.waitUntil(cache.put(cacheKey, new Response(finalPayload, {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
              }
            })));
          } catch (e) {
            console.warn("[Edge Worker] Cache put warning:", e.message);
          }

          return new Response(finalPayload, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // Default Dashboard Delivery (when isFiltering is false)
        const selectStr = `*`;
        const tables = [
          { key: 'hero_slider', table: 'hero_slider', order: 'rank_number.asc', limit: 10 },
          { key: 'trending', table: 'trending', order: 'rank_number.asc', limit: 12 },
          { key: 'popular', table: 'popular', order: 'rank_number.asc', limit: 10 },
          { key: 'top_airing', table: 'top_airing', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_day', table: 'most_viewed_day', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_week', table: 'most_viewed_week', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_month', table: 'most_viewed_month', order: 'rank_number.asc', limit: 10 },
          { key: 'latest_episodes', table: 'latest_episodes', order: 'rank_number.asc', limit: 5 },
          { key: 'upcoming_anime', table: 'upcoming_anime', order: 'rank_number.asc', limit: 5 }
        ];

        const fetchPromises = tables.map(async (cfg) => {
          try {
            let queryUrl = `${supabaseUrl}/rest/v1/${cfg.table}?select=${encodeURIComponent(selectStr)}`;
            if (cfg.order) {
              queryUrl += `&order=${cfg.order}`;
            }
            if (cfg.limit) {
              queryUrl += `&limit=${cfg.limit}`;
            }

            const res = await fetch(queryUrl, {
              method: 'GET',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            });

            if (!res.ok) {
              throw new Error(`HTTP error ${res.status} fetching ${cfg.table}`);
            }

            const data = await res.json();
            const mappedData = Array.isArray(data) ? data.map(mapItem).filter(x => x !== null) : [];
            return { key: cfg.key, data: mappedData };
          } catch (err) {
            console.error(`[Edge Worker] Error loading table ${cfg.table}:`, err);
            return { key: cfg.key, data: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        const responseData = {};
        for (const item of results) {
          responseData[item.key] = item.data || [];
        }

        return new Response(JSON.stringify({
          status: "success",
          data: responseData
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          status: "error",
          message: err.message,
          data: {
            hero_slider: [], trending: [], popular: [], top_airing: [],
            most_viewed_day: [], most_viewed_week: [], most_viewed_month: [],
            latest_episodes: [], upcoming_anime: []
          }
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // Path Route B: '/api/anime' (Deep Recommendations Engine)
    if (url.pathname === '/api/anime' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        const slug = url.searchParams.get("slug");
        if (!slug || slug.trim() === "") {
          return new Response(JSON.stringify({
            status: "error",
            message: "Missing Slug"
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        const selectStr = `*`;
        const detailUrl = `${supabaseUrl}/rest/v1/anime_list1?id=eq.${encodeURIComponent(slug)}&select=${encodeURIComponent(selectStr)}`;
        
        const detailRes = await fetch(detailUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!detailRes.ok) {
          throw new Error(`Failed to query detail: ${detailRes.statusText}`);
        }

        const list = await detailRes.json();
        if (!list || !Array.isArray(list) || list.length === 0) {
          return new Response(JSON.stringify({
            status: "error",
            message: "Not Found"
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        const baseAnime = list[0];
        const mappedBaseAnime = mapItem(baseAnime);
        const baseIdString = baseAnime.id;

        const cleanTokens = (val) => {
          if (!val) return [];
          let str = '';
          if (Array.isArray(val)) {
            str = val.join(' ');
          } else if (typeof val === 'string') {
            if (val.trim().startsWith('[') && val.trim().endsWith(']')) {
              try {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed)) {
                  str = parsed.join(' ');
                } else {
                  str = val;
                }
              } catch (e) {
                str = val;
              }
            } else {
              str = val;
            }
          } else {
            str = String(val);
          }
          const fillers = new Set(["the", "and", "for", "with", "from", "you", "that", "this", "sub", "dub", "season", "part", "movie", "series"]);
          return str
            .toLowerCase()
            .split(/[\s,]+/)
            .map(t => t.trim())
            .filter(t => t.length > 2 && !fillers.has(t));
        };

        const tokens = [
          ...new Set([
            ...cleanTokens(baseAnime.title),
            ...cleanTokens(baseAnime.keywords)
          ])
        ];

        let recommendations = [];
        let recsUrl = `${supabaseUrl}/rest/v1/anime_list1?id=neq.${encodeURIComponent(baseIdString)}&select=${encodeURIComponent(selectStr)}`;

        let orClauses = [];
        
        for (const token of tokens.slice(0, 10)) {
          orClauses.push(`title.ilike.%25${encodeURIComponent(token)}%25`);
          orClauses.push(`keywords.ilike.%25${encodeURIComponent(token)}%25`);
        }

        if (orClauses.length > 0) {
          recsUrl += `&or=(${orClauses.join(',')})`;
        }

        recsUrl += `&limit=24`;

        const recsRes = await fetch(recsUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (recsRes.ok) {
          const rawRecs = await recsRes.json();
          if (Array.isArray(rawRecs)) {
            const mappedRecs = rawRecs.map(mapItem).filter(x => x !== null);
            recommendations = shuffle(mappedRecs);
          }
        }

        return new Response(JSON.stringify({
          status: "success",
          data: {
            anime_details: mappedBaseAnime,
            recommendations: recommendations
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          status: "error",
          message: err.message,
          data: {
            anime_details: null,
            recommendations: []
          }
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // Default Fallback
    return new Response(JSON.stringify({
      status: "error",
      message: "Route Not Found"
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  },
};

/**
 * CORE DATABASE SCHEMA NORMALIZATION MAPPER
 */
function mapItem(item) {
  if (!item) return null;
  const subValue = item["s / ep / c"] !== undefined && item["s / ep / c"] !== null ? item["s / ep / c"] : 
                   (item["s/ep/c"] !== undefined && item["s/ep/c"] !== null ? item["s/ep/c"] : 0);
  const dubValue = item["d / ep / c"] !== undefined && item["d / ep / c"] !== null ? item["d / ep / c"] : 
                   (item["d/ep/c"] !== undefined && item["d/ep/c"] !== null ? item["d/ep/c"] : 0);
  return {
    id: item.id || '',
    title: item.title || '',
    description: item.description || '',
    poster: item.poster || '',
    "s / ep / c": subValue,
    "d / ep / c": dubValue,
    "s/ep/c": subValue,
    "d/ep/c": dubValue,
    status: item.status || '',
    type: item.type ? String(item.type).replace(/[\[\]"]/g, "").toUpperCase().trim() : 'TV',
    jp_titles: item.jp_titles || '',
    keywords: item.keywords || '',
    aired: item.aired || '',
    premiered: item.premiered || '',
    duration: item.duration || '',
    mal_score: item.mal_score || '',
    studios: item.studios || '',
    genre: item.genre || '',
    anikoto_id: item.anikoto_id !== undefined ? item.anikoto_id : null
  };
}

/**
 * Fisher-Yates array shuffle function
 */
function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}
