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
    const supabaseUrl = (env && env.SUPABASE_URL) || "https://ucgxzganknweqfucjqqw.supabase.co";
    const supabaseKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) || (env && env.SUPABASE_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

    const url = new URL(request.url);

    // Path Route A: '/api/home' (Dashboard Delivery Engine)
    if (url.pathname === '/api/home' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        // PostgREST select parameter string explicitly handling slashed columns via double quotes
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

        // Perform optimized parallel asynchronous fetches across these 9 tables
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
            // Wrap result parsing inside defensive fallbacks
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

    // Path Route B: '/api/anime' (Deep Library Keyword Discovery)
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

        // Isolate the base anime entry from the main 'anime_list1' database table
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

        // Tokenize title and keyword parameters, filtering out filler words
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
        // Appending inequality filter so the base anime avoids recommending itself
        let recsUrl = `${supabaseUrl}/rest/v1/anime_list1?id=neq.${encodeURIComponent(baseId)}&select=${encodeURIComponent(selectStr)}`;

        let orClauses = [];
        
        // Loop string builder to build case-insensitive substring checks using standard PostgREST format
        if (baseAnime.genre) {
          let genreArray = [];
          if (Array.isArray(baseAnime.genre)) {
            genreArray = baseAnime.genre;
          } else if (typeof baseAnime.genre === 'string') {
            try {
              const parsed = JSON.parse(baseAnime.genre);
              if (Array.isArray(parsed)) {
                genreArray = parsed;
              } else {
                genreArray = baseAnime.genre.split(',').map(g => g.trim());
              }
            } catch(e) {
              genreArray = baseAnime.genre.split(',').map(g => g.trim());
            }
          }
          genreArray.forEach(genreItem => {
            if (genreItem && genreItem.trim() !== '') {
              orClauses.push(`genre.ilike.%${encodeURIComponent(genreItem.trim())}%`);
            }
          });
        }

        // Add title and keyword clauses to query matrix
        for (const token of tokens.slice(0, 10)) {
          orClauses.push(`title.ilike.%${encodeURIComponent(token)}%`);
          orClauses.push(`keywords.ilike.%${encodeURIComponent(token)}%`);
        }

        if (orClauses.length > 0) {
          recsUrl += `&or=(${orClauses.slice(0, 20).join(',')})`;
        }

        recsUrl += `&limit=24`; // Capped strictly at 24 entries

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
  }
};

/**
 * Maps a single database record from the new meta-table schema.
 * Wraps all mapping algorithms inside safe defensive null-fallbacks.
 */
function mapRecord(x) {
  if (!x) return x;
  let subVal = x["s / ep / c"] !== null && x["s / ep / c"] !== undefined ? x["s / ep / c"] : 0;
  let dubVal = x["d / ep / c"] !== null && x["d / ep / c"] !== undefined ? x["d / ep / c"] : 0;
  return {
    id: x.id || "",
    title: x.title || "",
    description: x.description || "",
    poster: x.poster || "",
    "s / ep / c": subVal,
    "d / ep / c": dubVal,
    "s/ep/c": subVal,
    "d/ep/c": dubVal,
    total_sub_eps: subVal,
    total_dub_eps: dubVal,
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
