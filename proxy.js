/**
 * XMAX platform global data engine
 * Cloudflare Worker (ES Module Router)
 */

function isValidNumericRank(val) {
  if (val === null || val === undefined) return false;
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

        // Step 2: Extract all target slugs and anikoto_id elements into sets using separate routines
        const uniqueSlugsSet = new Set();
        const uniqueIdsSet = new Set();

        // Independent evaluation routines per category to completely fix the row skipper bug
        // hero_slider
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['hero_slider'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // trending
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['trending'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // popular
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['popular'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // top_airing
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['top_airing'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // most-viewed-day
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['most-viewed-day'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // most-viewed-week
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['most-viewed-week'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }
        // most-viewed-month
        for (const row of trendingRows) {
          if (row.slug && isValidNumericRank(row['most-viewed-month'])) {
            uniqueSlugsSet.add(row.slug);
          }
        }

        // Parse upcoming_anime and latest_episodes from JSONB columns
        let latestEpisodesIds = [];
        let upcomingAnimeIds = [];

        for (const row of trendingRows) {
          // Parse upcoming_anime as a raw array of primitive numbers
          if (row.upcoming_anime) {
            const arr = Array.isArray(row.upcoming_anime) ? row.upcoming_anime : [row.upcoming_anime];
            const parsed = arr.map(item => Number(item)).filter(id => !isNaN(id));
            if (parsed.length > 0) {
              upcomingAnimeIds = parsed;
              parsed.forEach(id => uniqueIdsSet.add(id));
            }
          }
          // Parse latest_episodes as an array of nested objects, extracting item.id and converting to a Number
          if (row.latest_episodes) {
            const arr = Array.isArray(row.latest_episodes) ? row.latest_episodes : [row.latest_episodes];
            const parsed = arr.map(item => {
              if (item && typeof item === 'object') {
                return Number(item.id);
              }
              return Number(item);
            }).filter(id => !isNaN(id));
            if (parsed.length > 0) {
              latestEpisodesIds = parsed;
              parsed.forEach(id => uniqueIdsSet.add(id));
            }
          }
        }

        let metaRows = [];

        // Step 3: Execute exactly ONE cross-table bulk fetch call back to 'anime_list1' using URL encoded slugs
        if (uniqueSlugsSet.size > 0 || uniqueIdsSet.size > 0) {
          const slugsArray = Array.from(uniqueSlugsSet).length > 0 ? Array.from(uniqueSlugsSet) : ['__dummy_slug__'];
          const idsArray = Array.from(uniqueIdsSet).length > 0 ? Array.from(uniqueIdsSet) : [-1];

          // CRITICAL URL QUERY FIX: Explicitly URL-encode string slugs to prevent syntax rejections using %22
          const safeSlugs = slugsArray.map(s => `%22${s}%22`).join(',');
          const selectQuery = `or=(id.in.(${safeSlugs}),anikoto_id.in.(${idsArray.join(',')}))&select=id,title,description,poster,s/ep/c,d/ep/c,eps,status,anikoto_id`;
          
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
