import { searchSpotifyAlbums, searchSpotifyArtists, searchSpotifyTracks, SpotifyCircuitOpenError } from '../../../lib/spotify';
import { searchItunesAlbums, searchItunesArtists } from '../../../lib/itunes';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { saveBasicReleases, saveItunesReleases, searchReleases, searchArtistsInDb, searchReleasesInDb } from '../../../lib/dbCache';
import { rateLimit } from '../../../lib/rateLimit';
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

async function logSearchMiss(query: string, type: string, dbCount: number): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key);
  await db.from('search_misses').insert({ query, type, db_count: dbCount });
}

// Cache search responses in Redis so repeated identical queries (across users
// and across server restarts) don't burn Spotify quota. Search results don't
// change frequently — 1 day staleness is acceptable.
const SEARCH_TTL = 86400;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const type = searchParams.get('type') ?? 'releases';
  const year = searchParams.get('year');
  const market = searchParams.get('market') ?? undefined;

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query parameter' }), { status: 400 });
  }

  const limited = await rateLimit(request, 'search', 30, 60);
  if (limited) return limited;

  const normalized = normalizeQuery(query);

  if (type === 'artists') {
    const cacheKey = `search:artists:${normalized}`;
    const cached = await cacheGet<{ artists: unknown[] }>(cacheKey);
    if (cached) return jsonResponse(cached);

    try {
      const artists = await searchSpotifyArtists(query);
      const body = { artists };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      return jsonResponse(body);
    } catch (err) {
      console.warn('[search] Spotify artist search failed, trying iTunes:', (err as Error).message);
      try {
        const artists = await searchItunesArtists(query);
        return jsonResponse({ artists });
      } catch {
        const artists = await searchArtistsInDb(query);
        return jsonResponse({ artists, degraded: true });
      }
    }
  }

  if (type === 'recordings') {
    const cacheKey = `search:tracks:${normalized}`;
    const cached = await cacheGet<{ recordings: unknown[] }>(cacheKey);
    if (cached) return jsonResponse(cached);

    try {
      const recordings = await searchSpotifyTracks(query);
      const body = { recordings };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      return jsonResponse(body);
    } catch (err) {
      console.warn('[search] Spotify track search failed, no DB fallback:', (err as Error).message);
      return jsonResponse({ recordings: [], degraded: true });
    }
  }

  // Releases (default) — DB-first, Spotify fallback
  const DB_SUFFICIENT = 5;
  const cacheKey = `search:albums:${normalized}:y=${year ?? ''}:m=${market ?? ''}`;
  const cached = await cacheGet<{ releases: unknown[] }>(cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    const dbResults = await searchReleases(query, year ?? null);

    if (dbResults.length >= DB_SUFFICIENT) {
      const body = { releases: dbResults };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      // Refresh DB in the background so future searches improve
      const spotifyBg = year ? `${query} year:${year}` : query;
      searchSpotifyAlbums(spotifyBg, 10, market)
        .then(results => saveBasicReleases(results))
        .catch(() => {});
      return jsonResponse(body);
    }

    // DB insufficient — log miss for nightly ingestion queue
    logSearchMiss(normalized, 'releases', dbResults.length).catch(() => {});

    // DB results insufficient — try Spotify, then iTunes
    const spotifyQuery = year ? `${query} year:${year}` : query;
    let results: Awaited<ReturnType<typeof searchSpotifyAlbums>>;
    try {
      results = await searchSpotifyAlbums(spotifyQuery, 10, market);
      if (year) results = results.filter(r => !r.date || r.date.startsWith(year));
      saveBasicReleases(results).catch(() => {});
    } catch (spotifyErr) {
      console.warn('[search] Spotify album search failed, trying iTunes:', (spotifyErr as Error).message);
      results = await searchItunesAlbums(query, 10);
      if (year) results = results.filter(r => !r.date || r.date.startsWith(year));
      saveItunesReleases(results).catch(() => {});
    }

    const body = { releases: results };
    await cacheSet(cacheKey, body, SEARCH_TTL);
    return jsonResponse(body);
  } catch (err) {
    if (err instanceof SpotifyCircuitOpenError) {
      // Circuit open — try iTunes before degrading to DB-only
      try {
        const results = await searchItunesAlbums(query, 10);
        const filtered = year ? results.filter(r => !r.date || r.date.startsWith(year)) : results;
        saveItunesReleases(filtered).catch(() => {});
        return jsonResponse({ releases: filtered });
      } catch { /* fall through to DB */ }
      const dbResults = await searchReleases(query, year ?? null);
      return jsonResponse({ releases: dbResults });
    }
    console.warn('[search] album search failed, falling back to DB:', (err as Error).message);
    let releases = await searchReleasesInDb(query);
    if (year) releases = releases.filter(r => !r.date || r.date.startsWith(year));
    return jsonResponse({ releases, degraded: true });
  }
}
