export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = (env && env.SUPABASE_URL) || "https://ucgxzganknweqfucjqqw.supabase.co";
    const supabaseKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) || (env && env.SUPABASE_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

    const url = new URL(request.url);

    if (url.pathname === '/api/home' && (request.method === 'GET' || request.method === 'POST')) {
      try {
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

        const fetchPromises = tables.map(async (cfg) => {
          try {
            let queryUrl = `${supabaseUrl}/rest/v1/${cfg.table}?select=${encodeURIComponent(selectStr)}`;
            if (cfg.order) queryUrl += `&order=${cfg.order}`;
            if (cfg.limit) queryUrl += `&limit=${cfg.limit}`;

            const res = await fetch(queryUrl, {
              method: 'GET',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            });

            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            return { key: cfg.key, data: Array.isArray(data) ? data.map(mapRecord) : [] };
          } catch (err) {
            return { key: cfg.key, data: [] };
          }
        });

        const results = await Promise.all(fetchPromises);
        const responseData = {};
        for (const item of results) {
          responseData[item.key] = item.data || [];
        }

        return new Response(JSON.stringify({ status: "success", data: responseData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", message: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/anime' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        const slug = url.searchParams.get("slug");
        if (!slug) {
          return new Response(JSON.stringify({ status: "error", message: "Missing Slug" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const selectStr = `id,title,description,poster,"s / ep / c","d / ep / c",genre,premiered,status,mal_score,anikoto_id,type,keywords`;
        const detailUrl = `${supabaseUrl}/rest/v1/anime_list1?id=eq.${encodeURIComponent(slug)}&select=${encodeURIComponent(selectStr)}`;
        
        const detailRes = await fetch(detailUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        const list = await detailRes.json();
        if (!list || !Array.isArray(list) || list.length === 0) {
          return new Response(JSON.stringify({ status: "error", message: "Not Found" }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const baseAnime = list[0];
        const mappedBaseAnime = mapRecord(baseAnime);

        const cleanTokens = (str) => {
          if (!str || typeof str !== 'string') return [];
          const fillers = new Set(["the", "and", "for", "with", "from", "you", "that", "this", "season", "part", "movie"]);
          return str
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
            .split(/\s+/)
            .filter(t => t.length > 2 && !fillers.has(t));
        };

        const tokens = [...new Set([...cleanTokens(baseAnime.title), ...cleanTokens(baseAnime.keywords)])];
        let orClauses = [];
        
        if (baseAnime.genre) {
          const genres = Array.isArray(baseAnime.genre) ? baseAnime.genre : (typeof baseAnime.genre === 'string' ? baseAnime.genre.split(',') : []);
          genres.forEach(g => {
            if (g && String(g).trim().length > 0) {
              orClauses.push(`genre.ilike.%${encodeURIComponent(String(g).trim())}%`);
            }
          });
        }

        for (const token of tokens.slice(0, 8)) {
          orClauses.push(`title.ilike.%${encodeURIComponent(token)}%`);
          orClauses.push(`keywords.ilike.%${encodeURIComponent(token)}%`);
        }

        let recommendations = [];
        let recsUrl = `${supabaseUrl}/rest/v1/anime_list1?id=neq.${encodeURIComponent(baseAnime.id)}&select=${encodeURIComponent(selectStr)}`;
        if (orClauses.length > 0) {
          recsUrl += `&or=(${orClauses.slice(0, 20).join(',')})`;
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
            recommendations = rawRecs.map(mapRecord);
          }
        }

        return new Response(JSON.stringify({ status: "success", data: { anime_details: mappedBaseAnime, recommendations } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", message: err.message, data: { anime_details: null, recommendations: [] } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    return new Response(JSON.stringify({ status: "error", message: "Route Not Found" }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};

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
    genre: x.genre || [],
    premiered: x.premiered || "",
    status: x.status || "",
    mal_score: x.mal_score !== null && x.mal_score !== undefined ? x.mal_score : "N/A",
    anikoto_id: x.anikoto_id || "",
    type: x.type || "TV"
  };
}
