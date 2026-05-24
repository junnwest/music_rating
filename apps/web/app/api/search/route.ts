import { searchSpotifyAlbums, searchSpotifyArtists, searchSpotifyTracks } from '../../../lib/spotify';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { saveBasicReleases, searchArtistsInDb, searchReleasesInDb } from '../../../lib/dbCache';
import type { NextRequest } from 'next/server';

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
      console.warn('[search] Spotify artist search failed, falling back to DB:', (err as Error).message);
      const artists = await searchArtistsInDb(query);
      return jsonResponse({ artists, degraded: true });
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
      // No local tracks table — return empty with a degraded flag so the UI
      // can show a "Spotify temporarily unavailable" notice instead of a 500.
      console.warn('[search] Spotify track search failed, no DB fallback:', (err as Error).message);
      return jsonResponse({ recordings: [], degraded: true });
    }
  }

  // Releases (default)
  const cacheKey = `search:albums:${normalized}:y=${year ?? ''}:m=${market ?? ''}`;
  const cached = await cacheGet<{ releases: unknown[] }>(cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    // Append year filter to Spotify query if provided (Spotify supports year:XXXX natively)
    const spotifyQuery = year ? `${query} year:${year}` : query;
    let releases = await searchSpotifyAlbums(spotifyQuery, 10, market);

    // Post-filter by year as a belt-and-suspenders check
    if (year) {
      releases = releases.filter(r => !r.date || r.date.startsWith(year));
    }

    // Persist basic rows so /album/[id] click-throughs never 404 when Spotify
    // is rate-limited (the album page falls through to getBasicRelease). Fire
    // and forget — don't block the search response.
    saveBasicReleases(releases).catch(err => console.error('[search] saveBasicReleases failed:', err));

    const body = { releases };
    await cacheSet(cacheKey, body, SEARCH_TTL);
    return jsonResponse(body);
  } catch (err) {
    console.warn('[search] Spotify album search failed, falling back to DB:', (err as Error).message);
    let releases = await searchReleasesInDb(query);
    if (year) releases = releases.filter(r => !r.date || r.date.startsWith(year));
    return jsonResponse({ releases, degraded: true });
  }
}
