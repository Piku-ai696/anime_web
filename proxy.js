/**
 * XMAX Platform — Unified Cloudflare Worker Data Engine
 * ES Module Router: Homepage batches, Global library search, Dynamic detail & keyword recommendations
 */

function mapItem(item) {
  if (!item) return null;
  return {
    id: item.id || item.slug || '',
    title: item.title || '',
    description: item.description || '',
    poster: item.poster || '',
    's/ep/c': item['s/ep/c'] !== undefined && item['s/ep/c'] !== null ? item['s/ep/c'] : 0,
    'd/ep/c': item['d/ep/c'] !== undefined && item['d/ep/c'] !== null ? item['d/ep/c'] : 0,
    status: item.status || item.anime_status || '',
    type: item.type || '',
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

export default {
  async fetch(request, env, ctx) {
    // Global CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 1. Preflight Configuration: Intercept HTTP OPTIONS requests instantly
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 2. Unified Path Routing Engine: Intercept GET requests at pathname '/api/home'
    if (url.pathname === '/api/home' && request.method === 'GET') {
      const supabaseUrl = 'https://ucgxzganknweqfucjqqw.supabase.co';
      const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY';

      const headers = {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      };

      const searchQuery = url.searchParams.get('search');
      const animeSlug = url.searchParams.get('anime_slug');

      try {
        // ──────────────────────────────────────────────────────────
        // 3. Execution Track Alpha — Global Library Text Search
        // ──────────────────────────────────────────────────────────
        if (searchQuery) {
          const query = encodeURIComponent(searchQuery.trim());
          const searchUrl = `${supabaseUrl}/rest/v1/anime_list1?or=(title.ilike.*${query}*,jp_titles.ilike.*${query}*,description.ilike.*${query}*)&limit=24`;

          const searchRes = await fetch(searchUrl, { headers });
          let searchResults = [];
          if (searchRes.ok) {
            const raw = await searchRes.json();
            searchResults = (raw || []).map(mapItem).filter(Boolean);
          }

          return new Response(JSON.stringify({
            status: 'success',
            data: searchResults
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // ──────────────────────────────────────────────────────────
        // 4. Execution Track Beta — Dynamic Details & Keyword Recommendations
        // ──────────────────────────────────────────────────────────
        if (animeSlug) {
          // Step A: Fetch the complete record row for that item directly
          const primaryRes = await fetch(
            `${supabaseUrl}/rest/v1/anime_list1?id=eq.${encodeURIComponent(animeSlug)}`,
            { headers }
          );
          if (!primaryRes.ok) {
            throw new Error(`Failed to fetch title details: ${primaryRes.status}`);
          }
          const primaryData = await primaryRes.json();
          const primaryRow = primaryData && primaryData.length > 0 ? mapItem(primaryData[0]) : null;

          if (!primaryRow) {
            return new Response(JSON.stringify({
              status: 'success',
              data: { anime_details: null, recommendations: [] }
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Step B: Extract string components from keywords, genre, and title columns
          const keywordSource = (primaryRow.keywords || '') + ' ' + (primaryRow.genre || '') + ' ' + (primaryRow.title || '');
          const tokens = keywordSource
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);
          const uniqueTokens = Array.from(new Set(tokens)).slice(0, 5);

          // Step C: Execute a secondary library cross-search using PostgREST text matching
          let relatedRows = [];
          if (uniqueTokens.length > 0) {
            const orFilter = 'or=(' + uniqueTokens.map(t => `keywords.ilike.*${t}*,genre.ilike.*${t}*`).join(',') + ')';
            const crossSearchUrl = `${supabaseUrl}/rest/v1/anime_list1?${orFilter}&limit=40`;
            const crossRes = await fetch(crossSearchUrl, { headers });
            if (crossRes.ok) {
              const crossData = await crossRes.json();
              relatedRows = (crossData || [])
                .map(mapItem)
                .filter(Boolean)
                .filter(i => i.id !== primaryRow.id);
            }
          }

          // Backfill if fewer than 6 recommendations
          if (relatedRows.length < 6) {
            const fallbackRes = await fetch(`${supabaseUrl}/rest/v1/anime_list1?limit=30`, { headers });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              const extras = (fallbackData || [])
                .map(mapItem)
                .filter(Boolean)
                .filter(i => i.id !== primaryRow.id && !relatedRows.some(r => r.id === i.id));
              relatedRows = [...relatedRows, ...extras].slice(0, 20);
            }
          }

          return new Response(JSON.stringify({
            status: 'success',
            data: {
              anime_details: primaryRow,
              recommendations: relatedRows
            }
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // ──────────────────────────────────────────────────────────
        // 5. Execution Track Gamma — Standard Homepage Generation
        // ──────────────────────────────────────────────────────────
        const endpoints = [
          'hero_slider?select=*&order=rank_number.asc',
          'trending?select=*&order=rank_number.asc',
          'popular?select=*&order=rank_number.asc',
          'top_airing?select=*&order=rank_number.asc',
          'most_viewed_day?select=*&order=rank_number.asc',
          'most_viewed_week?select=*&order=rank_number.asc',
          'most_viewed_month?select=*&order=rank_number.asc',
          'latest_episodes?select=*&limit=5',
          'upcoming_anime?select=*&limit=5'
        ];

        const fetchPromises = endpoints.map(endpoint =>
          fetch(`${supabaseUrl}/rest/v1/${endpoint}`, { headers })
            .then(async res => {
              if (!res.ok) return [];
              return res.json();
            })
            .catch(() => [])
        );

        const [
          hero_slider_raw,
          trending_raw,
          popular_raw,
          top_airing_raw,
          most_viewed_day_raw,
          most_viewed_week_raw,
          most_viewed_month_raw,
          latest_episodes_raw,
          upcoming_anime_raw
        ] = await Promise.all(fetchPromises);

        const hero_slider = (hero_slider_raw || []).map(mapItem).filter(Boolean);
        const trending = (trending_raw || []).map(mapItem).filter(Boolean);
        const popular = (popular_raw || []).map(mapItem).filter(Boolean);
        const top_airing = (top_airing_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_day = (most_viewed_day_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_week = (most_viewed_week_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_month = (most_viewed_month_raw || []).map(mapItem).filter(Boolean);
        const latest_episodes = (latest_episodes_raw || []).map(mapItem).filter(Boolean).slice(0, 5);
        const upcoming_anime = (upcoming_anime_raw || []).map(mapItem).filter(Boolean).slice(0, 5);

        return new Response(JSON.stringify({
          status: 'success',
          data: {
            hero_slider, trending, popular, top_airing,
            latest_episodes, upcoming_anime,
            most_viewed_day, most_viewed_week, most_viewed_month
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error) {
        // Global try/catch safeguard
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            hero_slider: [], trending: [], popular: [], top_airing: [],
            latest_episodes: [], upcoming_anime: [],
            most_viewed_day: [], most_viewed_week: [], most_viewed_month: []
          },
          error: error.message
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Default 404 Route
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
