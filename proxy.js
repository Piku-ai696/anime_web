export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. Streaming Proxy (The Core Engine)
      if (path === "/proxy") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return new Response("Missing URL", { status: 400, headers: corsHeaders });

        const response = await fetch(targetUrl, {
          method: "GET",
          headers: {
            "Referer": "https://vibeplayer.site/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          }
        });

        const newHeaders = new Headers(response.headers);
        Object.keys(corsHeaders).forEach(key => newHeaders.set(key, corsHeaders[key]));
        
        if (targetUrl.includes(".m3u8")) newHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        if (targetUrl.includes(".vtt")) newHeaders.set("Content-Type", "text/vtt");

        return new Response(response.body, { status: response.status, headers: newHeaders });
      }

      // 2. Search Route
      if (path === "/api/search") {
        const query = url.searchParams.get("q");
        if (!query) return new Response(JSON.stringify([]), { headers: corsHeaders });

        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/anime_list?title=ilike.*${encodeURIComponent(query)}*&select=*&limit=24`, {
          headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}` }
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. Spotlight Route
      if (path === "/api/trending/spotlight") {
        const trendRes = await fetch(`${env.SUPABASE_URL}/rest/v1/anime_list_trending?spot=not.is.null&order=spot.asc`, {
          headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}` }
        });
        const trendingItems = await trendRes.json();
        const ids = trendingItems.map(item => `"${item.id}"`).join(",");
        
        const catalogRes = await fetch(`${env.SUPABASE_URL}/rest/v1/anime_list?id=in.(${ids})`, {
          headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}` }
        });
        const catalogData = await catalogRes.json();
        return new Response(JSON.stringify(catalogData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 4. Catalog Route
      if (path === "/api/catalog") {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/anime_list?select=*&limit=1000`, {
          headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}` }
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response("ZyroX Proxy Online", { headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};
