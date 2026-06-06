/**
 * XMAX platform global data engine
 * Cloudflare Worker (ES Module Router)
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
    anikoto_id: item.anikoto_id !== undefined ? item.anikoto_id : null
  };
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

        // Execute parallel Promise.all array of global fetch commands to pull data records simultaneously
        const fetchPromises = endpoints.map(endpoint => 
          fetch(`${supabaseUrl}/rest/v1/${endpoint}`, { headers })
            .then(async res => {
              if (!res.ok) {
                console.error(`Failed fetching ${endpoint}: ${res.status}`);
                return [];
              }
              return res.json();
            })
            .catch(err => {
              console.error(`Error fetching ${endpoint}:`, err);
              return [];
            })
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

        // Ensure full compatibility with the frontend mapping rules by mapping values safely
        const hero_slider = (hero_slider_raw || []).map(mapItem).filter(Boolean);
        const trending = (trending_raw || []).map(mapItem).filter(Boolean);
        const popular = (popular_raw || []).map(mapItem).filter(Boolean);
        const top_airing = (top_airing_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_day = (most_viewed_day_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_week = (most_viewed_week_raw || []).map(mapItem).filter(Boolean);
        const most_viewed_month = (most_viewed_month_raw || []).map(mapItem).filter(Boolean);
        
        // Sliced limits to 5 items are handled on database level but enforced here as a safeguard
        const latest_episodes = (latest_episodes_raw || []).map(mapItem).filter(Boolean).slice(0, 5);
        const upcoming_anime = (upcoming_anime_raw || []).map(mapItem).filter(Boolean).slice(0, 5);

        // Package and respond with success block containing mapped arrays
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
        console.error('Error serving /api/home request via parallel tables:', error);
        
        // Return fallback empty data collections in case of database issues
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
