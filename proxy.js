export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        status: "error",
        message: "Missing Configuration"
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (url.pathname === '/api/home' && request.method === 'GET') {
      try {
        const collectionsUrl = `${supabaseUrl}/rest/v1/site_collections?select=*`;
        const collectionsRes = await fetch(collectionsUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!collectionsRes.ok) {
          throw new Error("Collections Failed");
        }

        const collections = await collectionsRes.json();
        const slugsSet = new Set();
        const idsSet = new Set();

        if (Array.isArray(collections)) {
          for (const c of collections) {
            if (c) {
              const colSlugs = extractArrayValues(c.anime_slug);
              const colIds = extractArrayValues(c.anime_ids);
              for (const slug of colSlugs) {
                slugsSet.add(slug);
              }
              for (const id of colIds) {
                idsSet.add(id);
              }
            }
          }
        }

        const uniqueSlugs = Array.from(slugsSet);
        const uniqueIds = Array.from(idsSet);
        let animeMasterList = [];

        if (uniqueSlugs.length > 0 || uniqueIds.length > 0) {
          let filter = '';
          if (uniqueSlugs.length > 0 && uniqueIds.length > 0) {
            filter = `&or=(slug.in.("${uniqueSlugs.join('","')}"),id.in.(${uniqueIds.join(',')}))`;
          } else if (uniqueSlugs.length > 0) {
            filter = `&slug=in.("${uniqueSlugs.join('","')}")`;
          } else if (uniqueIds.length > 0) {
            filter = `&id=in.(${uniqueIds.join(',')})`;
          }

          const masterUrl = `${supabaseUrl}/rest/v1/anime_master?select=id,title:title_en,slug,poster_url,banner_url,anime_type,anime_status,total_sub_eps,total_dub_eps,synopsis${filter}`;
          const masterRes = await fetch(masterUrl, {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          });

          if (masterRes.ok) {
            animeMasterList = await masterRes.json();
          }
        }

        const responseData = {
          hero_slider: [],
          trending: [],
          popular: [],
          top_airing: [],
          recent_updates: [],
          upcoming_anime: [],
          'most-viewed-day': [],
          'most-viewed-week': [],
          'most-viewed-month': []
        };

        const animeBySlug = new Map();
        const animeById = new Map();

        if (Array.isArray(animeMasterList)) {
          for (const item of animeMasterList) {
            if (item) {
              if (item.slug) {
                animeBySlug.set(String(item.slug).trim().toLowerCase(), item);
              }
              if (item.id) {
                animeById.set(String(item.id).trim().toLowerCase(), item);
              }
            }
          }
        }

        if (Array.isArray(collections)) {
          for (const col of collections) {
            if (col && col.collection_key) {
              const key = col.collection_key;
              if (responseData.hasOwnProperty(key)) {
                if (key === 'hero_slider' || key === 'trending' || key === 'popular' || key === 'top_airing' || key.startsWith('most-viewed') || key.startsWith('most_viewed')) {
                  const colSlugs = extractArrayValues(col.anime_slug);
                  responseData[key] = mapCollection(colSlugs, animeBySlug);
                } else if (key === 'recent_updates' || key === 'upcoming_anime') {
                  const colIds = extractArrayValues(col.anime_ids);
                  responseData[key] = mapCollection(colIds, animeById);
                }
              }
            }
          }
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
          message: err.message
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    else if (url.pathname === '/api/anime' && request.method === 'GET') {
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

        const selectStr = 'select=id,title:title_en,slug,poster_url,banner_url,anime_type,anime_status,total_sub_eps,total_dub_eps,synopsis';
        const animeUrl = `${supabaseUrl}/rest/v1/anime_master?${selectStr}&slug=eq.${slug}`;
        const animeRes = await fetch(animeUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!animeRes.ok) {
          throw new Error("Details Failed");
        }

        const list = await animeRes.json();
        if (list.length === 0) {
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
        let recommendations = [];

        const recsUrl = `${supabaseUrl}/rest/v1/anime_master?${selectStr}&id=neq.${baseAnime.id}&or=(anime_type.eq.${encodeURIComponent(baseAnime.anime_type || 'TV')},anime_status.eq.${encodeURIComponent(baseAnime.anime_status || 'Finished Airing')})&limit=24`;
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
            recommendations = shuffle(rawRecs);
          }
        }

        return new Response(JSON.stringify({
          status: "success",
          data: {
            anime_details: baseAnime,
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
          message: err.message
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

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
};

function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

function extractArrayValues(val) {
  if (val === null || val === undefined) return [];
  let arr = [];
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          arr = parsed;
        } else {
          arr = [parsed];
        }
      } catch (e) {
        arr = trimmed.split(',').map(s => s.trim());
      }
    } else {
      arr = trimmed.split(',').map(s => s.trim());
    }
  } else {
    arr = [val];
  }
  return arr
    .map(x => (x === null || x === undefined) ? '' : String(x).trim())
    .filter(x => x.length > 0);
}

function mapCollection(keysList, lookupMap) {
  if (!Array.isArray(keysList) || !(lookupMap instanceof Map)) return [];
  const mapped = [];
  for (const key of keysList) {
    try {
      if (key === null || key === undefined) continue;
      const stringKey = String(key).trim().toLowerCase();
      if (lookupMap.has(stringKey)) {
        const match = lookupMap.get(stringKey);
        if (match) {
          mapped.push(match);
        }
      }
    } catch (err) {
    }
  }
  return mapped;
}
