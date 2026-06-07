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

    // Path Route A: '/api/home' (Dashboard Delivery Engine or Advanced Search)
    if (url.pathname === '/api/home' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        const search = url.searchParams.get("search");
        const genre = url.searchParams.get("genre");
        const premiered = url.searchParams.get("premiered");
        const studios = url.searchParams.get("studios");
        const type = url.searchParams.get("type");
        const status = url.searchParams.get("status");

        const isSearch = (search && search.trim() !== "") ||
                         (genre && genre.trim() !== "") ||
                         (premiered && premiered.trim() !== "") ||
                         (studios && studios.trim() !== "") ||
                         (type && type.trim() !== "") ||
                         (status && status.trim() !== "");

        if (isSearch) {
          // Dynamic URL Construction for advanced search
          let searchUrl = `${supabaseUrl}/rest/v1/anime_list1?select=*`;

          if (search && search.trim() !== "") {
            const query = search.trim();
            searchUrl += `&or=(title.ilike.*${encodeURIComponent(query)}*,jp_titles.ilike.*${encodeURIComponent(query)}*,keywords.ilike.*${encodeURIComponent(query)}*)`;
          }
          if (genre && genre.trim() !== "") {
            searchUrl += `&genre.ilike.%${encodeURIComponent(genre.trim())}%`;
          }
          if (premiered && premiered.trim() !== "") {
            searchUrl += `&premiered.eq.${encodeURIComponent(premiered.trim())}`;
          }
          if (studios && studios.trim() !== "") {
            searchUrl += `&studios.ilike.%${encodeURIComponent(studios.trim())}%`;
          }
          if (type && type.trim() !== "") {
            searchUrl += `&type.eq.${encodeURIComponent(type.trim())}`;
          }
          if (status && status.trim() !== "") {
            searchUrl += `&status.ilike.%${encodeURIComponent(status.trim())}%`;
          }

          searchUrl += `&limit=50`;

          const res = await fetch(searchUrl, {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          });

          if (!res.ok) {
            throw new Error(`HTTP error ${res.status} performing search`);
          }

          const data = await res.json();
          const mappedData = Array.isArray(data) ? data.map(mapItem).filter(x => x !== null) : [];

          return new Response(JSON.stringify({
            status: "success",
            data: mappedData
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // Default Dashboard Delivery
        const selectStr = `*`;
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

        const cleanTokens = (str) => {
          if (!str || typeof str !== 'string') return [];
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
          orClauses.push(`title.ilike.%${encodeURIComponent(token)}%`);
          orClauses.push(`keywords.ilike.%${encodeURIComponent(token)}%`);
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
 * REPAIRED BACKEND MAPPING UTILITY LAYER
 */
function mapItem(item) {
  if (!item) return null;
  const subValue = item["s / ep / c"] !== undefined && item["s / ep / c"] !== null ? item["s / ep / c"] : 0;
  const dubValue = item["d / ep / c"] !== undefined && item["d / ep / c"] !== null ? item["d / ep / c"] : 0;
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
    type: item.type || 'TV',
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
