export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Automatically intercept preflight OPTIONS requests, delivering a clean 200 response code
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Database Credentials Configuration
    const supabaseUrl = (env && env.SUPABASE_URL) || "https://ucgxzganknweqfucjqqw.supabase.co";
    const supabaseKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) || (env && env.SUPABASE_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

    const url = new URL(request.url);

    // Route A (The Unified Home Endpoint) - Path '/api/home'
    if (url.pathname === '/api/home' && request.method === 'GET') {
      try {
        const selectStr = `id,title,description,poster,"s / ep / c","d / ep / c",genre,premiered,status,mal_score,anikoto_id`;
        
        // Target tables definition and configuration
        const tables = [
          { key: 'hero_slider', table: 'hero_slider', order: 'rank_number.asc', limit: 10 },
          { key: 'trending', table: 'trending', order: 'rank_number.asc', limit: 12 },
          { key: 'popular', table: 'popular', order: 'rank_number.asc', limit: 10 },
          { key: 'top_airing', table: 'top_airing', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_day', table: 'most_viewed_day', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_week', table: 'most_viewed_week', order: 'rank_number.asc', limit: 10 },
          { key: 'most_viewed_month', table: 'most_viewed_month', order: 'rank_number.asc', limit: 10 },
          { key: 'latest_episodes', table: 'latest_episodes', limit: 5 },
          { key: 'upcoming_anime', table: 'upcoming_anime', limit: 5 }
        ];

        // Perform concurrent parallel fetch calls to target tables ordered by rank_number.asc
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
            
            // Map records safely to retain both new meta-table schema and legacy frontend properties
            const mappedData = Array.isArray(data) ? data.map(mapRecord) : [];
            return { key: cfg.key, data: mappedData };
          } catch (err) {
            console.error(`[Edge Gateway] Error loading table ${cfg.table}:`, err);
            return { key: cfg.key, data: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        const responseData = {};
        for (const item of results) {
          responseData[item.key] = item.data;
        }

        // Backwards compatibility alias for 'recent_updates' (points to latest_episodes)
        responseData.recent_updates = responseData.latest_episodes || [];

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
          message: err.message
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // Route B (The Unified Detail Page Endpoint) - Path '/api/anime'
    if (url.pathname === '/api/anime' && request.method === 'GET') {
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

        // Query the central master directory table 'anime_list1' filtering where id.eq.[SLUG]
        const detailUrl = `${supabaseUrl}/rest/v1/anime_list1?id=eq.${encodeURIComponent(slug)}`;
        const detailRes = await fetch(detailUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!detailRes.ok) {
          throw new Error(`Failed to query detail from central directory: ${detailRes.statusText}`);
        }

        const list = await detailRes.json();
        if (!Array.isArray(list) || list.length === 0) {
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
        const mappedBaseAnime = mapRecord(baseAnime);

        // Extract keywords/title, clean filler tokens, perform a broad metadata OR query
        const cleanTokens = (str) => {
          if (!str || typeof str !== 'string') return [];
          const fillers = new Set(["the", "and", "for", "with", "from", "you", "that", "this", "sub", "dub", "season", "part", "movie", "series"]);
          return str
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
            .split(/\s+/)
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
        let recsUrl = `${supabaseUrl}/rest/v1/anime_list1?id=neq.${encodeURIComponent(baseAnime.id)}`;

        if (tokens.length > 0) {
          // Construct logical 'or' statement matching titles or keywords (capped at 10 clauses to stay within limit)
          const orClauses = [];
          for (const token of tokens.slice(0, 10)) {
            orClauses.push(`title.ilike.%${encodeURIComponent(token)}%`);
            orClauses.push(`keywords.ilike.%${encodeURIComponent(token)}%`);
          }
          recsUrl += `&or=(${orClauses.join(',')})`;
        } else if (baseAnime.genre) {
          // Fallback matching first genre if keywords/title tokens are unavailable
          const genres = baseAnime.genre.split(',').map(g => g.trim()).filter(g => g.length > 0);
          if (genres.length > 0) {
            recsUrl += `&genre.ilike.%${encodeURIComponent(genres[0])}%`;
          }
        }

        recsUrl += `&limit=48`;

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
            const mappedRecs = rawRecs.map(mapRecord);
            // Group, shuffle, and slice recommendations locally
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
          message: err.message
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
  }
};

/**
 * Maps a single database record from the new meta-table schema into the response structure.
 * Provides backwards compatibility for client keys and properties.
 */
function mapRecord(x) {
  if (!x) return x;
  return {
    ...x,
    id: x.id,
    title: x.title,
    description: x.description,
    poster: x.poster,
    "s / ep / c": x["s / ep / c"],
    "d / ep / c": x["d / ep / c"],
    genre: x.genre,
    premiered: x.premiered,
    status: x.status,
    mal_score: x.mal_score,
    anikoto_id: x.anikoto_id,

    // Backward compatibility aliases:
    slug: x.slug || x.id,
    poster_url: x.poster || x.poster_url || "",
    anime_status: x.status || x.anime_status || "",
    total_sub_eps: x["s / ep / c"] !== undefined ? x["s / ep / c"] : (x.total_sub_eps !== undefined ? x.total_sub_eps : 0),
    total_dub_eps: x["d / ep / c"] !== undefined ? x["d / ep / c"] : (x.total_dub_eps !== undefined ? x.total_dub_eps : 0),
    synopsis: x.description || x.synopsis || "",
    anime_type: x.anime_type || x.type || "TV" // Fallback default
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
