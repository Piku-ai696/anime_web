// worker.js — ZyroX Edge Scraping Engine
// Cloudflare Worker · Real-time HTML parser for hianimez.org

const ORIGIN = 'https://hianimez.org';
const MEM_TTL = 5 * 60 * 1000; // 5 min in ms
const CF_CACHE_TTL = 300;       // 5 min in seconds

// ── In-memory isolate cache ──────────────────────────────────────────────────
const memCache = new Map();
function memGet(key) {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > MEM_TTL) { memCache.delete(key); return null; }
  return e.data;
}
function memSet(key, data) { memCache.set(key, { data, ts: Date.now() }); }

// ── CORS + JSON response helpers ─────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};
function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CF_CACHE_TTL}` },
  });
}
function jsonErr(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Fetch raw HTML from origin ───────────────────────────────────────────────
const SPOOF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://hianimez.org/',
  'DNT': '1',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: SPOOF_HEADERS,
    cf: { cacheTtl: CF_CACHE_TTL, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ── Utility: strip HTML tags from a string ───────────────────────────────────
function stripTags(s) { return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

// ── Card extractor (shared) ──────────────────────────────────────────────────
function extractCards(html) {
  const cards = [];
  const parts = html.split(/(?=<div[^>]+class="[^"]*flw-item[^"]*")/i);
  for (const block of parts) {
    if (!block.includes('flw-item')) continue;

    // Slug / ID
    const hrefM = block.match(/href="\/([^"#?]+)"/);
    let id = hrefM ? hrefM[1].replace(/^watch\//, '') : '';

    // Poster image
    const imgM = block.match(/data-src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
               || block.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const img = imgM ? imgM[1] : '';

    // Title — multiple fallback patterns
    let title = '';
    const titlePatterns = [
      /class="[^"]*film-name[^"]*"[^>]*>[\s\S]*?title="([^"]+)"/,
      /class="[^"]*film-name[^"]*"[^>]*><a[^>]*title="([^"]+)"/,
      /class="[^"]*film-name[^"]*"[^>]*><a[^>]*>([^<]+)<\/a>/,
      /<h3[^>]*><a[^>]*title="([^"]+)"/,
      /<h3[^>]*><a[^>]*>([^<]+)<\/a>/,
    ];
    for (const rx of titlePatterns) {
      const m = block.match(rx);
      if (m) { title = m[1].trim(); break; }
    }

    // Sub / Dub counts
    const subM = block.match(/class="[^"]*fdi-sub[^"]*"[^>]*>(?:<[^>]+>)*\s*(\d+)/i);
    const sub = subM ? parseInt(subM[1]) : 0;
    const dubM = block.match(/class="[^"]*fdi-dub[^"]*"[^>]*>(?:<[^>]+>)*\s*(\d+)/i);
    const dub = dubM ? parseInt(dubM[1]) : 0;

    // Total episodes
    const epsM = block.match(/class="[^"]*fdi-eps[^"]*"[^>]*>(?:<[^>]+>)*\s*(\d+)/i);
    const episodes = epsM ? parseInt(epsM[1]) : 0;

    // Format type
    const typeM = block.match(/class="[^"]*fdi-type[^"]*"[^>]*>([^<]+)<\/span>/i)
               || block.match(/<span[^>]*>\s*(TV|Movie|OVA|ONA|Special|Music)\s*<\/span>/i);
    const type = typeM ? typeM[1].trim() : '';

    // Duration
    const durM = block.match(/class="[^"]*fdi-duration[^"]*"[^>]*>([^<]+)<\/span>/i);
    const duration = durM ? durM[1].trim() : '';

    if (title || id) cards.push({ id, title, img, sub, dub, episodes, type, duration });
  }
  return cards;
}

// ── HOME ROUTE ───────────────────────────────────────────────────────────────
async function handleHome() {
  const cacheKey = '/home';
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  const html = await fetchHTML(`${ORIGIN}/`);

  const result = {
    spotlight: [],
    trending: [],
    recentlyAdded: [],
    topAiring: [],
    mostPopular: [],
    latestCompleted: [],
  };

  // ─── Spotlight slider ───────────────────────────────────────────────────────
  const sliderM = html.match(/id="slider"[\s\S]*?<div[^>]+class="[^"]*swiper-wrapper[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (sliderM) {
    const slideParts = sliderM[1].split(/(?=<div[^>]+class="[^"]*swiper-slide[^"]*")/i);
    for (const slide of slideParts) {
      if (!slide.includes('swiper-slide')) continue;
      const slugM = slide.match(/data-id="([^"]+)"/);
      const id = slugM ? slugM[1] : '';
      const titleM = slide.match(/class="[^"]*dynamic-name[^"]*"[^>]*>([^<]+)</i);
      const title = titleM ? titleM[1].trim() : '';
      const imgM = slide.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"[^>]*class="[^"]*film-poster-img/i)
                || slide.match(/class="[^"]*film-poster-img[^"]*"[^>]*src="([^"]+)"/i)
                || slide.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
      const img = imgM ? imgM[1] : '';
      const descM = slide.match(/class="[^"]*desi-description[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const desc = descM ? stripTags(descM[1]) : '';
      const infoBlock = slide.match(/class="[^"]*dci-info[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const stats = infoBlock
        ? [...infoBlock[1].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map(m => m[1].trim()).filter(Boolean)
        : [];
      const watchM = slide.match(/href="(\/watch\/[^"]+)"/i);
      const watchHref = watchM ? watchM[1] : `/watch/${id}`;
      if (title || id) result.spotlight.push({ id, title, img, desc, stats, watchHref });
    }
  }

  // ─── Categorised content shelves ────────────────────────────────────────────
  // Map section headings → result keys
  const sectionMap = [
    { keys: ['trending', 'top-today', 'featured'],      out: 'trending' },
    { keys: ['recently-added', 'latest-episode'],        out: 'recentlyAdded' },
    { keys: ['top-airing', 'airing'],                   out: 'topAiring' },
    { keys: ['most-popular', 'popular', 'most-viewed'], out: 'mostPopular' },
    { keys: ['latest-completed', 'completed'],          out: 'latestCompleted' },
  ];

  // Split HTML into section blocks
  const rawSections = html.split(/<section[^>]*>/i);
  let sectionOrder = 0;
  const fallbackKeys = ['trending', 'recentlyAdded', 'topAiring', 'mostPopular', 'latestCompleted'];

  for (const sec of rawSections) {
    const cards = extractCards(sec);
    if (!cards.length) continue;

    const secLower = sec.slice(0, 500).toLowerCase();
    let outKey = null;
    for (const { keys, out } of sectionMap) {
      if (keys.some(k => secLower.includes(k))) { outKey = out; break; }
    }
    if (!outKey) { outKey = fallbackKeys[sectionOrder % fallbackKeys.length]; sectionOrder++; }
    result[outKey].push(...cards);
  }

  // Global fallback — if all shelves empty, dump all cards into trending
  if (Object.entries(result).filter(([k]) => k !== 'spotlight').every(([, v]) => v.length === 0)) {
    const allCards = extractCards(html);
    result.trending = allCards.slice(0, 24);
    result.recentlyAdded = allCards.slice(24, 48);
    result.topAiring = allCards.slice(48, 72);
  }

  memSet(cacheKey, result);
  return jsonOk(result);
}

// ── ANIME DETAIL ROUTE ───────────────────────────────────────────────────────
async function handleAnime(slug) {
  if (!slug) return jsonErr('slug param required', 400);
  const cacheKey = `anime:${slug}`;
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  // hianimez slugs are typically bare (e.g. "one-piece-100") or with numeric suffix
  const url = `${ORIGIN}/${slug}`;
  const html = await fetchHTML(url);

  const result = {
    id: slug,
    title: '',
    img: '',
    synopsis: '',
    score: '',
    status: '',
    type: '',
    episodes: 0,
    duration: '',
    aired: '',
    studios: '',
    genres: [],
    meta: {},
    recommendations: [],
    animeId: '',   // numeric id used for episode list API
  };

  // Numeric anime id embedded in page (used for episode list endpoint)
  const animeIdM = html.match(/data-id="(\d+)"/i) || html.match(/"anime_id"\s*:\s*"?(\d+)"?/i) || html.match(/\/ajax\/v2\/episode\/list\/(\d+)/i);
  result.animeId = animeIdM ? animeIdM[1] : '';

  // Title
  const titlePats = [
    /class="[^"]*film-name[^"]*"[^>]*>([^<]+)</i,
    /<h2[^>]*class="[^"]*film-name[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i,
  ];
  for (const rx of titlePats) { const m = html.match(rx); if (m) { result.title = m[1].trim(); break; } }

  // Poster
  const posterSec = html.match(/class="[^"]*anisc-poster[^"]*"[^>]*>([\s\S]{0,600})/i);
  if (posterSec) {
    const imgM = posterSec[1].match(/(?:src|data-src)="([^"]+\.(?:jpg|png|webp)[^"]*)"/i);
    result.img = imgM ? imgM[1] : '';
  }
  if (!result.img) {
    const imgM = html.match(/class="[^"]*film-poster-img[^"]*"[^>]*(?:src|data-src)="([^"]+)"/i);
    result.img = imgM ? imgM[1] : '';
  }

  // Synopsis
  const descM = html.match(/class="[^"]*film-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
             || html.match(/<p[^>]+class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
             || html.match(/class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (descM) result.synopsis = stripTags(descM[1]);

  // Score / rating
  const scoreM = html.match(/class="[^"]*item-rating[^"]*"[^>]*>[\s\S]*?<\/i>\s*([\d.]+)/i)
              || html.match(/class="[^"]*score[^"]*"[^>]*>([\d.]+)<\/span>/i);
  result.score = scoreM ? scoreM[1].trim() : '';

  // Film stats bar (quality, type, duration)
  const statsBarM = html.match(/class="[^"]*film-stats[^"]*"[^>]*>([\s\S]{0,400})<\/div>/i);
  if (statsBarM) {
    result.statsBar = [...statsBarM[1].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)]
      .map(m => m[1].trim()).filter(s => s && s !== '•');
  }

  // Meta info block (Studio, Aired, Duration, Status, etc.)
  const infoBlockM = html.match(/class="[^"]*anisc-info[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*(?:anisc-related|related-anime)|<\/div>\s*<\/div>\s*<\/div>)/i);
  if (infoBlockM) {
    // Each item: <div class="item ..."><span class="name">Key:</span> <span ...>value</span></div>
    const itemParts = infoBlockM[1].split(/<div[^>]+class="[^"]*\bitem\b[^"]*"/i);
    for (const part of itemParts) {
      const labelM = part.match(/class="[^"]*name[^"]*"[^>]*>([^<:]+):?<\/span>/i);
      if (!labelM) continue;
      const label = labelM[1].trim().toLowerCase();
      // Everything after label tag until next major block
      const afterLabel = part.slice(part.indexOf(labelM[0]) + labelM[0].length);
      const valRaw = afterLabel.match(/<\/span>([\s\S]*?)(?=<div|$)/i);
      const val = valRaw ? stripTags(valRaw[1]) : stripTags(afterLabel.slice(0, 200));
      if (label && val) {
        result.meta[label] = val;
        if (label === 'status') result.status = val;
        if (label === 'type' || label === 'format') result.type = val;
        if (label === 'aired' || label === 'air date') result.aired = val;
        if (label === 'duration') result.duration = val;
        if (label === 'studios' || label === 'studio') result.studios = val;
        if (label === 'genres' || label === 'genre') {
          result.genres = val.split(/[,،]/).map(s => s.trim()).filter(Boolean);
        }
        if (label === 'episodes') result.episodes = parseInt(val) || 0;
        if (label === 'score' || label === 'mal score') result.score = result.score || val;
      }
    }
  }

  // Recommendations (related anime cards on page)
  result.recommendations = extractCards(html).filter(c => c.id !== slug).slice(0, 20);

  memSet(cacheKey, result);
  return jsonOk(result);
}

// ── WATCH / EPISODE LIST ROUTE ────────────────────────────────────────────────
async function handleWatch(slug) {
  if (!slug) return jsonErr('slug param required', 400);
  const cacheKey = `watch:${slug}`;
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  const watchUrl = `${ORIGIN}/watch/${slug}`;
  const html = await fetchHTML(watchUrl);

  const result = {
    id: slug,
    title: '',
    episodes: [],
    servers: [],
    animeId: '',
  };

  // Grab title
  const titleM = html.match(/class="[^"]*film-name[^"]*"[^>]*>([^<]+)</i)
              || html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  result.title = titleM ? titleM[1].trim() : '';

  // Numeric anime ID (for AJAX episode list fetch)
  const aidM = html.match(/data-id="(\d+)"/i) || html.match(/"anime_id"\s*:\s*"?(\d+)"?/i);
  result.animeId = aidM ? aidM[1] : '';

  // Attempt AJAX episode list endpoint (hianimez pattern)
  if (result.animeId) {
    try {
      const ajaxUrl = `${ORIGIN}/ajax/v2/episode/list/${result.animeId}`;
      const ajaxRes = await fetch(ajaxUrl, {
        headers: { ...SPOOF_HEADERS, 'X-Requested-With': 'XMLHttpRequest', 'Referer': watchUrl },
        cf: { cacheTtl: CF_CACHE_TTL, cacheEverything: true },
      });
      if (ajaxRes.ok) {
        const ajaxJson = await ajaxRes.json();
        const epHtml = ajaxJson.html || ajaxJson.data?.html || ajaxJson.episodeHtml || '';
        if (epHtml) {
          result.episodes = parseEpisodeList(epHtml);
        }
      }
    } catch (_) { /* fall through to static parse */ }
  }

  // Static parse fallback — look for episode items in page HTML
  if (!result.episodes.length) {
    result.episodes = parseEpisodeList(html);
  }

  // Servers / streaming sources — look for server buttons/list
  const serverBlock = html.match(/class="[^"]*servers-items[^"]*"[^>]*>([\s\S]*?)<\/ul>/i)
                   || html.match(/class="[^"]*server-list[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (serverBlock) {
    const serverParts = serverBlock[1].split(/<li[^>]*>/i);
    for (const sp of serverParts) {
      const idM = sp.match(/data-id="([^"]+)"/i);
      const typeM = sp.match(/data-type="([^"]+)"/i);
      const nameM = sp.match(/>([^<]+)</);
      if (idM) result.servers.push({
        id: idM[1],
        type: typeM ? typeM[1] : 'sub',
        name: nameM ? nameM[1].trim() : '',
      });
    }
  }

  memSet(cacheKey, result);
  return jsonOk(result);
}

function parseEpisodeList(html) {
  const episodes = [];
  const epParts = html.split(/(?=<a[^>]+class="[^"]*ep-item[^"]*")/i);
  for (const part of epParts) {
    if (!part.includes('ep-item')) continue;
    const numM = part.match(/data-number="(\d+)"/i) || part.match(/class="[^"]*ep-number[^"]*"[^>]*>(\d+)/i);
    const epNum = numM ? parseInt(numM[1]) : 0;
    const hrefM = part.match(/href="([^"]+)"/i);
    const href = hrefM ? hrefM[1] : '';
    const titleM = part.match(/title="([^"]+)"/i) || part.match(/class="[^"]*ep-name[^"]*"[^>]*>([^<]+)/i);
    const title = titleM ? titleM[1].trim() : `Episode ${epNum}`;
    const idM = part.match(/data-id="([^"]+)"/i);
    const id = idM ? idM[1] : '';
    if (epNum || href) episodes.push({ epNum, title, href, id });
  }
  // Sort by episode number
  episodes.sort((a, b) => a.epNum - b.epNum);
  return episodes;
}

// ── SEARCH ROUTE ─────────────────────────────────────────────────────────────
async function handleSearch(params) {
  const q = params.get('q') || '';
  const genre = params.get('genre') || '';
  const status = params.get('status') || '';
  const format = params.get('format') || '';
  const year = params.get('year') || '';

  const cacheKey = `search:${q}:${genre}:${status}:${format}:${year}`;
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  // Build hianimez search URL
  const sp = new URLSearchParams();
  if (q) sp.set('keyword', q);
  if (genre) sp.set('genre', genre.toLowerCase());
  if (status) sp.set('status', status.toLowerCase().replace(/ /g, '_'));
  if (format) sp.set('type', format.toUpperCase());
  if (year) sp.set('season_year', year);

  const url = `${ORIGIN}/search?${sp.toString()}`;
  const html = await fetchHTML(url);
  const cards = extractCards(html);

  // Pagination info
  const totalM = html.match(/class="[^"]*total-items[^"]*"[^>]*>(\d+)/i);
  const total = totalM ? parseInt(totalM[1]) : cards.length;

  const result = { q, filters: { genre, status, format, year }, total, results: cards };
  memSet(cacheKey, result);
  return jsonOk(result);
}

// ── EPISODE STREAMING SOURCES ─────────────────────────────────────────────────
async function handleSources(epId) {
  if (!epId) return jsonErr('epId param required', 400);
  const cacheKey = `sources:${epId}`;
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  // Try AJAX endpoint for episode servers
  const ajaxUrl = `${ORIGIN}/ajax/v2/episode/servers?episodeId=${epId}`;
  try {
    const res = await fetch(ajaxUrl, {
      headers: { ...SPOOF_HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
      cf: { cacheTtl: CF_CACHE_TTL, cacheEverything: true },
    });
    if (res.ok) {
      const json = await res.json();
      const serversHtml = json.html || json.data?.html || '';
      const servers = [];
      const parts = serversHtml.split(/<div[^>]+class="[^"]*server-item[^"]*"/i);
      for (const part of parts) {
        const idM = part.match(/data-id="([^"]+)"/i);
        const typeM = part.match(/data-type="([^"]+)"/i);
        const nameM = part.match(/>([^<]+)</);
        if (idM) servers.push({ id: idM[1], type: typeM?.[1] || 'sub', name: nameM?.[1]?.trim() || '' });
      }
      const result = { epId, servers };
      memSet(cacheKey, result);
      return jsonOk(result);
    }
  } catch (_) {}
  return jsonOk({ epId, servers: [] });
}

// ── STREAM EMBED SRC ──────────────────────────────────────────────────────────
async function handleEmbed(serverId) {
  if (!serverId) return jsonErr('serverId required', 400);
  const cacheKey = `embed:${serverId}`;
  const cached = memGet(cacheKey);
  if (cached) return jsonOk(cached);

  const ajaxUrl = `${ORIGIN}/ajax/v2/episode/sources?id=${serverId}`;
  try {
    const res = await fetch(ajaxUrl, {
      headers: { ...SPOOF_HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
      cf: { cacheTtl: CF_CACHE_TTL, cacheEverything: true },
    });
    if (res.ok) {
      const json = await res.json();
      const result = { serverId, link: json.link || json.url || json.data?.link || '' };
      memSet(cacheKey, result);
      return jsonOk(result);
    }
  } catch (_) {}
  return jsonOk({ serverId, link: '' });
}

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────────────
export default {
  async fetch(request) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    try {
      // /api/home
      if (path === '/api/home') return await handleHome();

      // /api/anime?slug=...
      if (path === '/api/anime') {
        const slug = params.get('slug') || '';
        return await handleAnime(slug);
      }

      // /api/watch?slug=...
      if (path === '/api/watch') {
        const slug = params.get('slug') || '';
        return await handleWatch(slug);
      }

      // /api/search?q=...&genre=...&status=...&format=...&year=...
      if (path === '/api/search') return await handleSearch(params);

      // /api/sources?epId=...
      if (path === '/api/sources') {
        const epId = params.get('epId') || '';
        return await handleSources(epId);
      }

      // /api/embed?serverId=...
      if (path === '/api/embed') {
        const serverId = params.get('serverId') || '';
        return await handleEmbed(serverId);
      }

      return jsonErr('Unknown route', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonErr(err.message || 'Internal error', 502);
    }
  },
};
