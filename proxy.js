export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Intercept OPTIONS preflight requests natively with an empty 200 response
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Active Database Credentials Configuration
    const supabaseUrl = (env && env.SUPABASE_URL) || "https://ucgxzganknweqfucjqqw.supabase.co";
    const supabaseKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) || (env && env.SUPABASE_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

    const url = new URL(request.url);

    // Endpoint A: Path '/api/home' (GET)
    if (url.pathname === '/api/home' && request.method === 'GET') {
      try {
        // Explicitly compiled select string wrapping slashed column tokens inside double quotes
        const selectStr = `id,title,description,poster,"s / ep / c","d / ep / c",genre,premiered,status,mal_score,anikoto_id,type`;
        
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

        // Execute parallel async requests
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
            const mappedData = Array.isArray(data) ? data.map(mapRecord) : [];
            return { key: cfg.key, data: mappedData };
          } catch (err) {
            console.error(`[Edge Worker] Error loading table ${cfg.table}:`, err);
            return { key: cfg.key, data: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        const responseData = {};
        for (const item of results) {
          responseData[item.key] = item.data;
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

    // Endpoint B: Path '/api/anime' (GET)
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

        // Query directory table 'anime_list1' using .eq filter syntax to isolate the base row
        const selectStr = `id,title,description,poster,"s / ep / c","d / ep / c",genre,premiered,status,mal_score,anikoto_id,type`;
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
        const mappedBaseAnime = mapRecord(baseAnime);
        const baseId = baseAnime.id;

        // Clean tokens from keywords and title
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
        let recsUrl = `${supabaseUrl}/rest/v1/anime_list1?id=neq.${encodeURIComponent(baseId)}&select=${encodeURIComponent(selectStr)}`;

        let orClauses = [];
        
        // If genre exists, map genres to 'or' query conditions
        if (baseAnime.genre) {
          const genres = typeof baseAnime.genre === 'string' 
            ? baseAnime.genre.split(',').map(g => g.trim()) 
            : (Array.isArray(baseAnime.genre) ? baseAnime.genre : []);
          genres.forEach(genre => {
            if (genre.length > 0) {
              orClauses.push(`genre.ilike.%${encodeURIComponent(genre)}%`);
            }
          });
        }

        // Add title and keyword clauses
        for (const token of tokens.slice(0, 10)) {
          orClauses.push(`title.ilike.%${encodeURIComponent(token)}%`);
          orClauses.push(`keywords.ilike.%${encodeURIComponent(token)}%`);
        }

        if (orClauses.length > 0) {
          recsUrl += `&or=(${orClauses.slice(0, 20).join(',')})`;
        }

        recsUrl += `&limit=24`; // Capped at 24 entries

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
 * Maps a single database record from the new meta-table schema.
 * Wraps all mapping algorithms inside safe defensive null-fallbacks.
 */
function mapRecord(x) {
  if (!x) return x;
  return {
    id: x.id || "",
    title: x.title || "",
    description: x.description || "",
    poster: x.poster || "",
    "s / ep / c": x["s / ep / c"] !== null && x["s / ep / c"] !== undefined ? x["s / ep / c"] : 0,
    "d / ep / c": x["d / ep / c"] !== null && x["d / ep / c"] !== undefined ? x["d / ep / c"] : 0,
    genre: x.genre || "",
    premiered: x.premiered || "",
    status: x.status || "",
    mal_score: x.mal_score !== null && x.mal_score !== undefined ? x.mal_score : "N/A",
    anikoto_id: x.anikoto_id || "",
    type: x.type || "",

    // Backward compatibility aliases:
    slug: x.id || "",
    poster_url: x.poster || "",
    anime_status: x.status || "",
    total_sub_eps: x["s / ep / c"] !== null && x["s / ep / c"] !== undefined ? x["s / ep / c"] : 0,
    total_dub_eps: x["d / ep / c"] !== null && x["d / ep / c"] !== undefined ? x["d / ep / c"] : 0,
    synopsis: x.description || "",
    anime_type: x.type || "TV"
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
