/**
 * XMAX platform global data engine
 * Cloudflare Worker (ES Module Router)
 */

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

        // Step 1: Make exactly ONE single POST fetch call to trigger the customized internal database RPC function
        const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_xmax_homepage_metadata`, {
          method: 'POST',
          headers: headers
        });

        if (!rpcRes.ok) {
          throw new Error(`RPC invocation failed with status ${rpcRes.status}: ${await rpcRes.text()}`);
        }

        const rpcPayloadData = await rpcRes.json();

        // Step 2: Package and respond with success block containing RPC payload directly
        const responseData = {
          status: 'success',
          data: rpcPayloadData
        };

        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });

      } catch (error) {
        console.error('Error serving /api/home request via RPC:', error);
        
        // Return fallback empty data collections in case of errors
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
