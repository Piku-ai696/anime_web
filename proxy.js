/**
 * XMAX platform global data engine
 * Cloudflare Worker (ES Module Router)
 */

function isValidNumericRank(val) {
  if (val === null || val === undefined) return false;
  // Stringify the property value, trim any white spaces, and check if it matches a digit sequence pattern
  const clean = String(val).trim();
  return /^\d+$/.test(clean);
}

export default {
  async fetch(request, env, ctx) {
    // Standard CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Intercept HTTP OPTIONS requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    // Handle requests to GET '/api/home'
    if (url.pathname === '/api/home' && request.method === 'GET') {
      try {
        const supabaseUrl = env.SUPABASE_URL || 'https://ucgxzganknweqfucjqqw.supabase.co';
        const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY';

        const headers = {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        };

        // Step 1: Fetch all rows from 'anime_list_trending' in a single bulk request
        const trendingRes = await fetch(`${supabaseUrl}/rest/v1/anime_list_trending?select=*`, { headers });
        if (!trendingRes.ok) {
          throw new Error(`Failed to fetch trending list: ${trendingRes.status} ${await trendingRes.text()}`);
        }
        const trendingRows = await trendingRes.json();

        if (!Array.isArray(trendingRows)) {
          throw new Error('Response from anime_list_trending is not an array.');
        }

        // Step 2: Extract all target slugs and anikoto_id elements into sets
        const uniqueSlugsSet = new Set();
        const uniqueIdsSet = new Set();

        const categories = [
          'hero_slider',
          'trending',
          'popular',
          'top_airing',
          'most-viewed-day',
          'most-viewed-week',
          'most-viewed-month'
        ];

        // Explicit iteration over every row to gather valid slugs by trimmed regex checks
        categories.forEach(col => {
          trendingRows.forEach(row => {
            const rankVal = row[col];
            if (row.slug && isValidNumericRank(rankVal)) {
              uniqueSlugsSet.add(row.slug);
            }
          });
        });

        // Scan the rows to locate the non-null cells containing latest_episodes and upcoming_anime arrays
        let latestEpisodesIds = [];
        let upcomingAnimeIds = [];

        for (const row of trendingRows) {
          // Parse upcoming_anime as a flat array of numbers
          if (row.upcoming_anime) {
            const cell = row.upcoming_anime;
            const arr = Array.isArray(cell) ? cell : [cell];
            upcomingAnimeIds = arr.map(item => Number(item)).filter(id => !isNaN(id));
            if (upcomingAnimeIds.length > 0) {
              break;
            }
          }
        }

        for (const row of trendingRows) {
          // Parse latest_episodes as an array of objects, pulling out the nested object 'id' property values and converting them to numbers
          if (row.latest_episodes) {
            const cell = row.latest_episodes;
            const arr = Array.isArray(cell) ? cell : [cell];
            latestEpisodesIds = arr.map(item => {
              if (item && typeof item === 'object') {
                return Number(item.id);
              }
              return Number(item);
            }).filter(id => !isNaN(id));
            if (latestEpisodesIds.length > 0) {
              break;
            }
          }
        }

        // Compile all unique target slugs and anikoto_id numbers into separate filter pools
        latestEpisodesIds.forEach(id => uniqueIdsSet.add(id));
        upcomingAnimeIds.forEach(id => uniqueIdsSet.add(id));

        const uniqueSlugsList = Array.from(uniqueSlugsSet).filter(Boolean);
        const uniqueIdsList = Array.from(uniqueIdsSet).filter(id => id !== null && id !== undefined && !isNaN(id));

        const uniqueSlugs = uniqueSlugsList.length > 0 ? uniqueSlugsList : ['__dummy_slug__'];
        const uniqueIds = uniqueIdsList.length > 0 ? uniqueIdsList : [-1];

        let metaRows = [];

        // Step 3: Perform ONE cross-table bulk fetch back to 'anime_list1' using the exact syntax
        if (uniqueSlugsList.length > 0 || uniqueIdsList.length > 0) {
          const selectQuery = `or=(id.in.(${uniqueSlugs.map(s => `"${s}"`).join(',')}),anikoto_id.in.(${uniqueIds.join(',')}))&select=id,title,description,poster,s/ep/c,d/ep/c,eps,status,anikoto_id`;
          const metaUrl = `${supabaseUrl}/rest/v1/anime_list1?${selectQuery}`;
          const metaRes = await fetch(metaUrl, { headers });

          if (metaRes.ok) {
            metaRows = await metaRes.json();
          } else {
            console.error(`Failed to fetch metadata from anime_list1: ${metaRes.status} ${await metaRes.text()}`);
          }
        }

        // Index metadata by slug and anikoto_id for quick O(1) resolution
        const metaBySlug = new Map();
        const metaById = new Map();

        if (Array.isArray(metaRows)) {
          metaRows.forEach(item => {
            const slug = item.id || item.slug;
            if (slug) {
              metaBySlug.set(slug, item);
            }
            if (item.anikoto_id !== undefined && item.anikoto_id !== null) {
              metaById.set(Number(item.anikoto_id), item);
            }
          });
        }

        // Step 4: Map the retrieved metadata objects back into separate response arrays in correct rank order
        const getSortedContainer = (columnName) => {
          return trendingRows
            .filter(r => r.slug && isValidNumericRank(r[columnName]))
            .sort((a, b) => parseInt(String(a[columnName]).trim()) - parseInt(String(b[columnName]).trim()))
            .map(r => metaBySlug.get(r.slug))
            .filter(Boolean);
        };

        const hero_slider = getSortedContainer('hero_slider');
        const trending = getSortedContainer('trending');
        const popular = getSortedContainer('popular');
        const top_airing = getSortedContainer('top_airing');
        const most_viewed_day = getSortedContainer('most-viewed-day');
        const most_viewed_week = getSortedContainer('most-viewed-week');
        const most_viewed_month = getSortedContainer('most-viewed-month');

        const latest_episodes = latestEpisodesIds.map(id => metaById.get(id)).filter(Boolean).slice(0, 5);
        const upcoming_anime = upcomingAnimeIds.map(id => metaById.get(id)).filter(Boolean).slice(0, 5);

        // Step 5: Package response
        const responseData = {
          status: 'success',
          data: {
            hero_slider,
            trending,
            popular,
            top_airing,
            latest_episodes,
            upcoming_anime,
            most_viewed_day,
            most_viewed_week,
            most_viewed_month
          }
        };

        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });

      } catch (error) {
        console.error('Error serving /api/home request:', error);
        
        // Deep validation fallback
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            hero_slider: [],
            trending: [],
            popular: [],
            top_airing: [],
            latest_episodes: [],
            upcoming_anime: [],
            most_viewed_day: [],
            most_viewed_week: [],
            most_viewed_month: []
          },
          error: error.message
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    // Default 404 Route
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
};
