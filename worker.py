import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// 1. Database Configuration Setup
const SUPABASE_URL = "https://ucgxzganknweqfucjqqw.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

// Configurable Scraping Ranges
const START_ID = 1;
const END_ID = 9000;
const RATE_LIMIT_DELAY = 2200; // 2.2 seconds in milliseconds

// Simple utility function for dynamic, precise delay tracking
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches all anikoto_id values from rows where status is 'Finished Airing'.
 * These will be safely ignored to save time and API bandwidth.
 */
async function getFinishedAnimeIds() {
  console.log("🔍 Scanning database for already finished anime entries...");
  try {
    const { data, error } = await supabase
      .from("ultimate")
      .select("anikoto_id")
      .eq("status", "Finished Airing");

    if (error) throw error;

    // Extract numbers into a JavaScript Set for O(1) lightning-fast lookups
    const finishedIds = new Set(
      data
        .filter(row => row.anikoto_id !== null && row.anikoto_id !== undefined)
        .map(row => Math.floor(Number(row.anikoto_id)))
    );

    console.log(`✅ Found ${finishedIds.size} finished anime rows. These will be skipped.`);
    return finishedIds;
  } catch (err) {
    console.warn(`⚠️ Error fetching existing rows: ${err.message}. Starting with an empty exclusion list.`);
    return new Set();
  }
}

/**
 * Flattens the nested Anikoto API JSON response payload 
 * and saves/updates it into the public.ultimate table.
 */
async function parseAndUpsert(apiData) {
  const anime = apiData?.data?.anime;
  if (!anime || !anime.mal_id) return false;

  // Extract terms arrays safely and turn into strings
  const terms = anime.terms_by_type || {};
  const genreList = terms.genre || [];
  const studioList = terms.studios || [];
  const typeList = terms.type || [];

  const genreStr = Array.isArray(genreList) ? genreList.join(', ') : null;
  const studiosStr = Array.isArray(studioList) ? studioList.join(', ') : null;
  const animeType = (Array.isArray(typeList) && typeList.length > 0) ? typeList[0] : null;

  // Construct row layout matching your exact PostgreSQL schema
  const rowData = {
    mal_id: Math.floor(Number(anime.mal_id)), // Primary Key
    anikoto_id: Math.floor(Number(anime.id)),  // Saved from the response id field
    slug: anime.slug || null,
    title: anime.title || null,
    alternative: anime.alternative || null,
    titles: anime.titles || null,
    native: anime.native || null,
    rating: anime.rating || null,
    poster: anime.poster || null,
    is_sub: anime.is_sub !== null && anime.is_sub !== undefined ? Math.floor(Number(anime.is_sub)) : 0,
    is_dub: anime.is_dub !== null && anime.is_dub !== undefined ? Math.floor(Number(anime.is_dub)) : 0,
    description: anime.description || null,
    aired: anime.aired || null,
    season: anime.season || null,
    year: anime.year !== null && anime.year !== undefined ? String(anime.year) : null, // Match text column format
    duration: anime.duration || null,
    status: anime.status || null,
    score: anime.score !== null && anime.score !== undefined ? String(anime.score) : null,
    episodes: anime.episodes ? Math.floor(Number(anime.episodes)) : 0,
    ani_id: anime.ani_id ? Math.floor(Number(anime.ani_id)) : null,
    source: anime.source || null,
    background_image: anime.background_image || null,
    genre: genreStr,
    studios: studiosStr,
    type: animeType,
    relations: null // Keeping explicitly empty as requested
  };

  try {
    // Upsert transaction target execution
    const { error } = await supabase
      .from("ultimate")
      .upsert(rowData, { onConflict: "mal_id" });

    if (error) throw error;
    console.log(`   Saved: ${rowData.title} (MAL ID: ${rowData.mal_id}) -> Status: ${rowData.status}`);
    return true;
  } catch (err) {
    console.error(`   ❌ Database write error for ${anime.title || 'Unknown'}: ${err.message}`);
    return false;
  }
}

async function startScraper() {
  // Step 1: Initialize list of already completed/finished IDs
  const ignoredIds = await getFinishedAnimeIds();

  print(`\n🚀 Launching Scraper pipeline loop across IDs ${START_ID} to ${END_ID}...`);

  // Step 2: Loop comprehensively across your entire targeted range
  for (let currentId = START_ID; currentId <= END_ID; currentId++) {
    
    // Check if current ID falls inside our pre-parsed exclusion set matrix
    if (ignoredIds.has(currentId)) {
      continue;
    }

    console.log(`🌐 Querying Anikoto ID: ${currentId}...`);
    const apiUrl = `http://anikotoapi.site/series/${currentId}`;
    const startTime = Date.now();

    try {
      const response = await fetch(apiUrl, { timeout: 10000 });

      if (response.status === 200) {
        const jsonData = await response.json();

        // --- CRUCIAL EXTRA CHECK LOGIC ---
        // If the server explicitly flags "ok": false, bypass execution steps instantly!
        if (!jsonData || jsonData.ok !== true) {
          console.log(`   慢 Skipped: ID ${currentId} returned 'ok': false (No valid anime data available here).`);
        } else {
          // Process clean data entries
          await parseAndUpsert(jsonData);
        }
      } else if (response.status === 404) {
        console.log(`   ℹ️ ID ${currentId} returned 404 (No anime exists at this tracking link)`);
      } else {
        console.log(`   ⚠️ Received unusual status code ${response.status} for ID ${currentId}`);
      }
    } catch (err) {
      console.error(`   ❌ Network communication error on ID ${currentId}: ${err.message}`);
    }

    // Precise Rate Limit Safety Valve Calculation
    const elapsedTime = Date.now() - startTime;
    const sleepNeeded = Math.max(0, RATE_LIMIT_DELAY - elapsedTime);
    if (sleepNeeded > 0) {
      await sleep(sleepNeeded);
    }
  }

  console.log("\n🎉 Scraper iteration sequence completed successfully!");
}

// Fire the program engine
startScraper();
