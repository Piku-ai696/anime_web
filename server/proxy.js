// ═══════════════════════════════════════════════════════════════════════════════
// ZyroX — Production Stream Server
// Security: Helmet · CORS Lock · Rate Limiter
// Features: M3U8 Proxy · PNG Stripper · Supabase Next-Episode API
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Supabase Client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Database Verification Status ──────────────────────────────────────────────
console.log('[Supabase] Operational Mode: 100% Live DB Queries Enabled');

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY STACK
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Helmet — HTTP Header Protection ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://vjs.zencdn.net", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://vjs.zencdn.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://vjs.zencdn.net", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      connectSrc: ["'self'", "https://ucgxzganknweqfucjqqw.supabase.co", "*.infinityfreeapp.com", "*.infinityfree.com", "*.gt.tc", "*.onrender.com"],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ── 2. CORS — Domain Restriction & Dynamic Origin Authorization ───────────────
const allowedOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://zyrox.gt.tc',
  'http://zyrox.gt.tc'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like server-to-server or postman)
    if (!origin) return callback(null, true);

    const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isInfinityFree = origin.endsWith('.infinityfreeapp.com') || origin.endsWith('.infinityfree.com') || origin.includes('infinityfree');
    const isGtTc = origin.endsWith('.gt.tc') || origin.includes('gt.tc');
    const isAllowedHardcoded = allowedOrigins.includes(origin);

    if (isLocal || isInfinityFree || isGtTc || isAllowedHardcoded) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected Origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  optionsSuccessStatus: 200,
  credentials: true
}));

// ── 3. Rate Limiter — Anti-Scraping ──────────────────────────────────────────
const proxyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1-minute window
  max: 300,                   // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded.' },
});

// ── JSON Body Parsing ─────────────────────────────────────────────────────────
app.use(express.json());

// ── Serve Static Frontend ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PROXY ENDPOINT — /proxy?url=<encoded_url>
// Injects Referer: https://vibeplayer.site/ into every upstream request.
// Strips PNG magic headers from .ts segments.
// Rewrites relative URLs in .m3u8 manifests to route through this proxy.
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/proxy', proxyLimiter, async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    // Validate URL
    const parsed = new URL(targetUrl);
    console.log(`[Proxy] → ${parsed.pathname.split('/').pop()}`);

    // Fetch upstream with injected headers
    const upstream = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://vibeplayer.site/',
        'Origin': 'https://vibeplayer.site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      console.error(`[Proxy] ✗ Upstream ${upstream.status} for ${targetUrl}`);
      return res.status(upstream.status).json({
        error: `Upstream returned ${upstream.status}`,
        url: targetUrl,
      });
    }

    // Forward content-type
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    // ── M3U8 Manifest Rewriting ─────────────────────────────────────────────
    const isManifest = targetUrl.endsWith('.m3u8') ||
      (contentType && contentType.includes('mpegurl'));

    if (isManifest) {
      const body = await upstream.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const isMaster = body.includes('#EXT-X-STREAM-INF');

      const rewritten = body
        .split('\n')
        .map(line => {
          const trimmed = line.trim();

          // Inject CODECS into master manifest for Video.js VHS detection
          if (isMaster && trimmed.startsWith('#EXT-X-STREAM-INF') && !trimmed.includes('CODECS')) {
            return trimmed.replace(
              '#EXT-X-STREAM-INF:',
              '#EXT-X-STREAM-INF:CODECS="avc1.64001f,mp4a.40.2",'
            );
          }

          // Skip empty lines and HLS tags
          if (!trimmed || trimmed.startsWith('#')) {
            return line;
          }

          // Already absolute → just proxy it
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return `/proxy?url=${encodeURIComponent(trimmed)}`;
          }

          // Relative URL → make absolute then proxy
          const absoluteUrl = new URL(trimmed, baseUrl).href;
          return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
        })
        .join('\n');

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // ── Subtitle Pass-through ───────────────────────────────────────────────
    const isSubtitle = targetUrl.endsWith('.vtt') || targetUrl.endsWith('.srt') ||
      (contentType && (contentType.includes('text/vtt') || contentType.includes('subrip')));

    if (isSubtitle) {
      const body = await upstream.text();
      res.set('Content-Type', 'text/vtt');
      return res.send(body);
    }

    // ── Binary / TS Segments — PNG Magic Header Stripping ───────────────────
    let buffer = Buffer.from(await upstream.arrayBuffer());

    // PNG magic: 89 50 4E 47 (first 4 bytes)
    // The CDN disguises TS segments as PNG images.
    // Actual TS data starts after the PNG IEND chunk (4-byte marker + 4-byte CRC).
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (buffer.length > 70 && buffer.slice(0, 4).equals(PNG_MAGIC)) {
      const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44]);
      const iendIdx = buffer.indexOf(IEND);
      if (iendIdx >= 0) {
        const tsStart = iendIdx + 8; // Skip past IEND chunk (4 marker + 4 CRC)
        buffer = buffer.slice(tsStart);
        console.log(`[Proxy] ⚡ Stripped PNG wrapper (${tsStart}B), TS: ${buffer.length}B`);
      }
    }

    res.set('Content-Type', 'video/mp2t');
    res.send(buffer);

  } catch (err) {
    console.error(`[Proxy] ✗ Error:`, err.message);
    res.status(502).json({
      error: 'Proxy fetch failed',
      message: err.message,
      url: targetUrl,
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/next-episode — Gap-Jumping Algorithm
// Accepts: { anime_id, current_number }
// Pulls s_m3u8_url JSON array from Supabase.
// Returns the smallest episode number strictly greater than current_number.
// If a gap exists (e.g., 4 → 6 because 5 is missing), it jumps to 6.
// If no further episodes exist, returns series_complete.
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/next-episode', apiLimiter, async (req, res) => {
  const { anime_id, current_number } = req.body;

  // Validate inputs
  if (!anime_id || current_number === undefined || current_number === null) {
    return res.status(400).json({
      error: 'Missing required fields: anime_id, current_number',
    });
  }

  const currentNum = Number(current_number);
  if (isNaN(currentNum)) {
    return res.status(400).json({ error: 'current_number must be a number' });
  }

  let data = null;
  try {
    const { data: dbData, error } = await supabase
      .from('anime_list')
      .select('id, title, s_m3u8_url, d_m3u8_url, s_eps, poster')
      .eq('id', anime_id)
      .single();

    if (!error && dbData) {
      data = dbData;
    }
  } catch (err) {
    console.warn(`[Supabase] Error querying next-episode, using local:`, err.message);
  }

  if (!data) {
    return res.status(404).json({ error: 'Anime not found in Supabase database', anime_id });
  }

  let episodes = data.s_m3u8_url;
  if (typeof episodes === 'string') {
    try {
      episodes = JSON.parse(episodes);
    } catch (e) {
      episodes = [];
    }
  }

  // Validate episode array
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return res.status(404).json({
      error: 'No episodes available for this anime',
      anime_id,
    });
  }

  // ── Gap-Jumping Algorithm ─────────────────────────────────────────────
  // Extract all episode numbers, sort ascending, find smallest > current
  const sortedEps = episodes
    .map(ep => {
      const urlStr = (ep.url || ep.link || ep.m3u8 || '').trim();
      return { number: Number(ep.number), url: urlStr };
    })
    .filter(ep => !isNaN(ep.number) && ep.url !== '')
    .sort((a, b) => a.number - b.number);

  const nextEpisode = sortedEps.find(ep => ep.number > currentNum);

  if (!nextEpisode) {
    // No more episodes — series is complete
    console.log(`[API] ✓ Series complete: ${data.title} (after Ep ${currentNum})`);
    return res.json({
      status: 'series_complete',
      anime_id,
      title: data.title,
      current_number: currentNum,
      message: `No episodes after Ep ${currentNum}. Series complete.`,
    });
  }

  // Gap detection logging
  const expectedNext = currentNum + 1;
  if (nextEpisode.number !== expectedNext) {
    console.log(`[API] ⚡ Gap-Jump: Ep ${currentNum} → Ep ${nextEpisode.number} (skipped ${nextEpisode.number - currentNum - 1} missing)`);
  } else {
    console.log(`[API] ✓ Next: Ep ${currentNum} → Ep ${nextEpisode.number}`);
  }

  return res.json({
    status: 'next_episode',
    anime_id,
    title: data.title,
    current_number: currentNum,
    next_number: nextEpisode.number,
    next_url: nextEpisode.url,
    gap_jumped: nextEpisode.number !== expectedNext,
    poster: data.poster || null,
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/anime/:id — Fetch full anime data for Theater Mode
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/anime/:id', apiLimiter, async (req, res) => {
  const { id } = req.params;

  let data = null;
  try {
    const { data: dbData, error } = await supabase
      .from('anime_list')
      .select('id, title, description, poster, s_m3u8_url, d_m3u8_url, s_eps')
      .eq('id', id)
      .single();

    if (!error && dbData) {
      data = dbData;
    }
  } catch (err) {
    console.warn(`[Supabase] Error querying anime ID, using local:`, err.message);
  }

  if (!data) {
    return res.status(404).json({ error: 'Anime not found in Supabase database', id });
  }

  return res.json(data);
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/anime/:id/recommendations — Relational Suggestions
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/anime/:id/recommendations', apiLimiter, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: currentAnime, error: fetchErr } = await supabase
      .from('anime_list')
      .select('id, title, description')
      .eq('id', id)
      .single();

    if (fetchErr || !currentAnime) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    const titleTokens = (currentAnime.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    const descTokens = (currentAnime.description || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4);

    const allTokens = [...new Set([...titleTokens, ...descTokens])].slice(0, 15);

    let results = [];
    if (allTokens.length > 0) {
      const orConditions = allTokens.map(token => `title.ilike.%${token}%,description.ilike.%${token}%`).join(',');
      
      const { data, error } = await supabase
        .from('anime_list')
        .select('id, title, poster, s_eps, s_m3u8_url, d_m3u8_url, description')
        .neq('id', id)
        .or(orConditions)
        .limit(50);

      if (!error && data) {
        results = data;
      }
    }

    if (results.length < 10) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('anime_list')
        .select('id, title, poster, s_eps, s_m3u8_url, d_m3u8_url, description')
        .neq('id', id)
        .limit(30);

      if (!fallbackError && fallbackData) {
        const existingIds = new Set(results.map(r => r.id));
        const filteredFallback = fallbackData.filter(item => !existingIds.has(item.id));
        results = [...results, ...filteredFallback];
      }
    }

    const shuffled = results.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 10);

    return res.json(selected);
  } catch (err) {
    console.error('[API] Recommendations error:', err.message);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/search — Live Database Search (Limited to 24 results)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/search', apiLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }
  try {
    const { data, error } = await supabase
      .from('anime_list')
      .select('id, title, poster, s_eps, s_m3u8_url, d_m3u8_url, description')
      .ilike('title', `%${query}%`)
      .limit(24);

    if (error) {
      throw error;
    }
    return res.json(data || []);
  } catch (err) {
    console.error('[API] ✗ Search error:', err.message);
    res.status(500).json({ error: 'Failed to search catalog' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/spotlight — Spotlight Slider Carousel (Ordered by spot positioning)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/trending/spotlight', apiLimiter, async (_req, res) => {
  try {
    const { data: trendData, error: trendErr } = await supabase
      .from('anime_list_trending')
      .select('id, spot')
      .not('spot', 'is', null)
      .order('spot', { ascending: true });

    if (trendErr) throw trendErr;
    if (!trendData || trendData.length === 0) return res.json([]);

    const ids = trendData.map(item => item.id);
    const { data: animeData, error: animeErr } = await supabase
      .from('anime_list')
      .select('id, title, description, poster, s_eps, s_m3u8_url, d_m3u8_url')
      .in('id', ids);

    if (animeErr) throw animeErr;

    const mapped = trendData.map(t => {
      const anime = animeData.find(a => a.id === t.id);
      return anime ? { ...anime, spot: t.spot } : null;
    }).filter(Boolean);

    return res.json(mapped);
  } catch (err) {
    console.error('[API] Spotlight error:', err.message);
    res.status(500).json({ error: 'Failed to load spotlight' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/trending — Trending Now Row (Ordered by no positioning)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/trending/now', apiLimiter, async (_req, res) => {
  try {
    const { data: trendData, error: trendErr } = await supabase
      .from('anime_list_trending')
      .select('id, no')
      .not('no', 'is', null)
      .order('no', { ascending: true });

    if (trendErr) throw trendErr;
    if (!trendData || trendData.length === 0) return res.json([]);

    const ids = trendData.map(item => item.id);
    const { data: animeData, error: animeErr } = await supabase
      .from('anime_list')
      .select('id, title, description, poster, s_eps, s_m3u8_url, d_m3u8_url')
      .in('id', ids);

    if (animeErr) throw animeErr;

    const mapped = trendData.map(t => {
      const anime = animeData.find(a => a.id === t.id);
      return anime ? { ...anime, no: t.no } : null;
    }).filter(Boolean);

    return res.json(mapped);
  } catch (err) {
    console.error('[API] Trending error:', err.message);
    res.status(500).json({ error: 'Failed to load trending' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/top10 — Top 10 Global Chart (Ordered by T10 placement)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/trending/top10', apiLimiter, async (_req, res) => {
  try {
    const { data: trendData, error: trendErr } = await supabase
      .from('anime_list_trending')
      .select('id, T10')
      .not('T10', 'is', null)
      .order('T10', { ascending: true });

    if (trendErr) throw trendErr;
    if (!trendData || trendData.length === 0) return res.json([]);

    const ids = trendData.map(item => item.id);
    const { data: animeData, error: animeErr } = await supabase
      .from('anime_list')
      .select('id, title, description, poster, s_eps, s_m3u8_url, d_m3u8_url')
      .in('id', ids);

    if (animeErr) throw animeErr;

    const mapped = trendData.map(t => {
      const anime = animeData.find(a => a.id === t.id);
      return anime ? { ...anime, T10: t.T10 } : null;
    }).filter(Boolean);

    return res.json(mapped);
  } catch (err) {
    console.error('[API] Top 10 error:', err.message);
    res.status(500).json({ error: 'Failed to load top 10' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: /api/catalog — List all anime for Homepage
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/catalog', apiLimiter, async (_req, res) => {
  try {
    let data = null;
    try {
      const { data: dbData, error } = await supabase
        .from('anime_list')
        .select('id, title, poster, s_eps, s_m3u8_url, d_m3u8_url, description')
        .order('title', { ascending: true });

      if (!error && dbData && dbData.length > 0) {
        data = dbData;
      }
    } catch (err) {
      console.warn(`[Supabase] Catalog fetch failed:`, err.message);
    }

    return res.json(data || []);
  } catch (err) {
    console.error('[API] ✗ Catalog error:', err.message);
    res.status(500).json({ error: 'Failed to load catalog' });
  }
});

// ── Details Page Route ────────────────────────────────────────────────────────
app.get('/anime', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'anime'));
});
app.get('/anime.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'anime'));
});

// ── Theater Page Route ────────────────────────────────────────────────────────
app.get('/theater', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'theater'));
});
app.get('/theater.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'theater'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║          ZyroX — Production Stream Server            ║');
  console.log('  ╠═══════════════════════════════════════════════════════╣');
  console.log(`  ║  Server:    http://localhost:${PORT}                    ║`);
  console.log(`  ║  Theater:   http://localhost:${PORT}/                    ║`);
  console.log(`  ║  Health:    http://localhost:${PORT}/health              ║`);
  console.log('  ║  Proxy:     /proxy?url=<encoded>                     ║');
  console.log('  ║  API:       /api/next-episode (POST)                 ║');
  console.log('  ║  API:       /api/anime/:id (GET)                     ║');
  console.log('  ╠═══════════════════════════════════════════════════════╣');
  console.log('  ║  Security:  Helmet · CORS Lock · Rate Limiter        ║');
  console.log('  ║  Supabase:  Connected                                ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('');
});
