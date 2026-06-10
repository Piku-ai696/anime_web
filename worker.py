import time
import requests
from supabase import create_client, Client

# 1. Database Configuration Setup
SUPABASE_URL = "https://ucgxzganknweqfucjqqw.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZ3h6Z2Fua253ZXFmdWNqcXF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE5OTczNywiZXhwIjoyMDk0Nzc1NzM3fQ.yEap0n7fCuy44Ox0YXZpj4_cf3wO7IS6oJWA6sk0GqY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Configurable Scraping Ranges
START_ID = 1
END_ID = 9000
RATE_LIMIT_DELAY = 2.2  # Strict delay interval threshold in seconds

def get_finished_anime_ids():
    """
    Fetches all anikoto_id values from rows where status is 'Finished Airing'.
    These will be safely ignored to save time and API bandwidth.
    """
    print("🔍 Scanning database for already finished anime entries...")
    try:
        response = supabase.table("ultimate") \
                           .select("anikoto_id") \
                           .eq("status", "Finished Airing") \
                           .execute()
        
        finished_ids = {int(row["anikoto_id"]) for row in response.data if row.get("anikoto_id") is not None}
        print(f"✅ Found {len(finished_ids)} finished anime rows. These will be skipped.")
        return finished_ids
    except Exception as e:
        print(f"⚠️ Error fetching existing rows: {e}. Starting with an empty exclusion list.")
        return set()

def parse_and_upsert(api_data):
    """
    Flattens the nested Anikoto API JSON response payload 
    and saves/updates it into the public.ultimate table.
    """
    anime = api_data.get("data", {}).get("anime", {})
    if not anime or not anime.get("mal_id"):
        return False

    # Extract terms arrays safely and turn into strings
    terms = anime.get("terms_by_type", {})
    genre_list = terms.get("genre", [])
    studio_list = terms.get("studios", [])
    type_list = terms.get("type", [])

    genre_str = ", ".join(genre_list) if isinstance(genre_list, list) else None
    studios_str = ", ".join(studio_list) if isinstance(studio_list, list) else None
    anime_type = type_list[0] if isinstance(type_list, list) and len(type_list) > 0 else None

    # Construct row mapped matching your exact PostgreSQL schema
    row_data = {
        "mal_id": int(anime["mal_id"]), # Primary Key
        "anikoto_id": int(anime["id"]),  # Saved from the response id as requested
        "slug": anime.get("slug"),
        "title": anime.get("title"),
        "alternative": anime.get("alternative"),
        "titles": anime.get("titles"),
        "native": anime.get("native"),
        "rating": anime.get("rating"),
        "poster": anime.get("poster"),
        "is_sub": int(anime["is_sub"]) if anime.get("is_sub") is not None else 0,
        "is_dub": int(anime["is_dub"]) if anime.get("is_dub") is not None else 0,
        "description": anime.get("description"),
        "aired": anime.get("aired"),
        "season": anime.get("season"),
        "year": str(anime["year"]) if anime.get("year") is not None else None,
        "duration": anime.get("duration"),
        "status": anime.get("status"),
        "score": str(anime["score"]) if anime.get("score") is not None else None,
        "episodes": int(anime["episodes"]) if anime.get("episodes") else 0,
        "ani_id": int(anime["ani_id"]) if anime.get("ani_id") else None,
        "source": anime.get("source"),
        "background_image": anime.get("background_image"),
        "genre": genre_str,
        "studios": studios_str,
        "type": anime_type,
        "relations": None 
    }

    try:
        supabase.table("ultimate").upsert(row_data, on_conflict="mal_id").execute()
        print(f"   Saved: {row_data['title']} (MAL ID: {row_data['mal_id']}) -> Status: {row_data['status']}")
        return True
    except Exception as e:
        print(f"   ❌ Database write error for {anime.get('title')}: {e}")
        return False

def start_scraper():
    # Step 1: Initialize list of already completed/finished IDs
    ignored_ids = get_finished_anime_ids()
    
    print(f"\n🚀 Launching Scraper pipeline loop across IDs {START_ID} to {END_ID}...")
    
    # Step 2: Loop comprehensively across your entire targeted range
    for current_id in range(START_ID, END_ID + 1):
        
        # Check if the current ID matches a cached Finished row
        if current_id in ignored_ids:
            continue
            
        print(f"🌐 Querying Anikoto ID: {current_id}...")
        api_url = f"http://anikotoapi.site/series/{current_id}"
        
        try:
            start_time = time.time()
            response = requests.get(api_url, timeout=10)
            
            if response.status_code == 200:
                json_data = response.json()
                
                # --- CRUCIAL EXTRA CHECK LOGIC ---
                # If the status is 200 but the inner response parameters explicitly flag "ok": false, skip entirely!
                if not json_data.get("ok"):
                    print(f"   ⏩ Skipped: ID {current_id} returned 'ok': false (No valid anime data available here).")
                else:
                    # If "ok": true, proceed with data parsing and database ingestion
                    parse_and_upsert(json_data)
                    
            elif response.status_code == 404:
                print(f"   ℹ️ ID {current_id} returned 404 (No anime exists at this tracking link)")
            else:
                print(f"   ⚠️ Received unusual status code {response.status_code} for ID {current_id}")
                
        except Exception as e:
            print(f"   ❌ Network communication error on ID {current_id}: {e}")
            
        # Calculate operational overhead to apply absolute, flawless 2.2-sec rate limiting
        elapsed_time = time.time() - start_time
        sleep_needed = max(0.0, RATE_LIMIT_DELAY - elapsed_time)
        if sleep_needed > 0:
            time.sleep(sleep_needed)

    print("\n🎉 Scraper iteration sequence completed successfully!")

if __name__ == "__main__":
    start_scraper()
