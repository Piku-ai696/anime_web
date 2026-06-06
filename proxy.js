/**
 * XMAX platform global data engine
 * Cloudflare Worker (ES Module Router)
 */

function extractAnikotoIds(cell) {
  const ids = [];
  if (!cell) return ids;
  
  if (Array.isArray(cell)) {
    cell.forEach(item => {
      if (item !== null && item !== undefined) {
        if (typeof item === 'object') {
          const val = item.anikoto_id !== undefined ? item.anikoto_id : item.id;
          if (val !== undefined && val !== null) {
            ids.push(Number(val));
          }
        } else {
          ids.push(Number(item));
        }
      }
    });
  } else if (typeof cell === 'object') {
    const val = cell.anikoto_id !== undefined ? cell.anikoto_id : cell.id;
    if (val !== undefined && val !== null) {
      ids.push(Number(val));
    }
  } else if (typeof cell === 'number' || typeof cell === 'string') {
    ids.push(Number(cell));
  }
  return ids.filter(id => !isNaN(id));
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

        categories.forEach(col => {
          trendingRows.forEach(row => {
            const rankVal = row[col];
            if (rankVal !== null && rankVal !== undefined && rankVal !== '' && row.slug) {
              uniqueSlugsSet.add(row.slug);
            }
          });
        });

        // Extract anikoto_id from latest_episodes and upcoming_anime
        trendingRows.forEach(row => {
          if (row.latest_episodes) {
            extractAnikotoIds(row.latest_episodes).forEach(id => uniqueIdsSet.add(id));
          }
          if (row.upcoming_anime) {
            extractAnikotoIds(row.upcoming_anime).forEach(id => uniqueIdsSet.add(id));
          }
        });

        // Compile distinct arrays matching required naming conventions
        const slugList = Array.from(uniqueSlugsSet).filter(Boolean);
        const idList = Array.from(uniqueIdsSet).filter(id => id !== null && id !== undefined && !isNaN(id));

        let metaRows = [];

        // Step 3: Perform ONE cross-table bulk batch query using double-quoted slug escaping
        if (slugList.length > 0 || idList.length > 0) {
          const safeSlugs = slugList.length > 0 ? slugList : ['__dummy_slug__'];
          const safeIds = idList.length > 0 ? idList : [-1];

          // Wrap every single text slug in double quotes inside the 'in' filter block
          // to prevent text hyphen syntax errors in Supabase.
          const selectQuery = `or=(id.in.(${safeSlugs.map(s => `"${s}"`).join(',')}),anikoto_id.in.(${safeIds.join(',')}))&select=id,title,description,poster,s/ep/c,d/ep/c,eps,status,anikoto_id`;
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

        // Step 4: Order the metadata arrays sequentially to match original layout placements
        const getSortedContainer = (columnName) => {
          return trendingRows
            .filter(r => r.slug && r[columnName] !== null && r[columnName] !== undefined && r[columnName] !== '')
            .sort((a, b) => parseInt(a[columnName]) - parseInt(b[columnName]))
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

        // Extract latest_episodes and upcoming_anime in their original list order
        let latestEpisodesIds = [];
        let upcomingAnimeIds = [];

        for (const r of trendingRows) {
          if (r.latest_episodes) {
            const ids = extractAnikotoIds(r.latest_episodes);
            if (ids.length > 0 && latestEpisodesIds.length === 0) {
              latestEpisodesIds = ids;
            }
          }
          if (r.upcoming_anime) {
            const ids = extractAnikotoIds(r.upcoming_anime);
            if (ids.length > 0 && upcomingAnimeIds.length === 0) {
              upcomingAnimeIds = ids;
            }
          }
        }

        const latest_episodes = latestEpisodesIds.map(id => metaById.get(id)).filter(Boolean).slice(0, 5);
        const upcoming_anime = upcomingAnimeIds.map(id => metaById.get(id)).filter(Boolean).slice(0, 5);

        // Step 5: Package the payload cleanly matching home sections
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
        
        // Deep validation: Return safe empty collections on database or payload structural failures
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
