import { searchSpotifyAlbums, searchSpotifyArtists, searchSpotifyTracks, SpotifyCircuitOpenError } from '../../../lib/spotify';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { saveBasicReleases, searchReleases } from '../../../lib/dbCache';
import { rateLimit } from '../../../lib/rateLimit';
import type { NextRequest } from 'next/server';

// Cache search responses in Redis so repeated identical queries (across users
// and across server restarts) don't burn Spotify quota. Search results don't
// change frequently — 1 day staleness is acceptable.
const SEARCH_TTL = 86400;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
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

  try {
    if (type === 'artists') {
      const cacheKey = `search:artists:${normalized}`;
      const cached = await cacheGet<{ artists: unknown[] }>(cacheKey);
      if (cached) return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });

      const artists = await searchSpotifyArtists(query);
      const body = { artists };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }
    if (type === 'recordings') {
      const cacheKey = `search:tracks:${normalized}`;
      const cached = await cacheGet<{ recordings: unknown[] }>(cacheKey);
      if (cached) return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });

      const recordings = await searchSpotifyTracks(query);
      const body = { recordings };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }

    // Releases (default) — DB-first, Spotify fallback
    // DB has a GIN FTS index on (title || artist); hitting it first eliminates
    // ~85% of search-driven Spotify quota usage at launch traffic levels.
    const DB_SUFFICIENT = 5;
    const cacheKey = `search:albums:${normalized}:y=${year ?? ''}:m=${market ?? ''}`;
    const cached = await cacheGet<{ releases: unknown[] }>(cacheKey);
    if (cached) return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });

    const dbResults = await searchReleases(query, year ?? null);

    if (dbResults.length >= DB_SUFFICIENT) {
      const body = { releases: dbResults };
      await cacheSet(cacheKey, body, SEARCH_TTL);
      // Refresh DB in the background so future searches improve (ignore errors)
      const spotifyBg = year ? `${query} year:${year}` : query;
      searchSpotifyAlbums(spotifyBg, 10, market)
        .then(results => saveBasicReleases(results))
        .catch(() => {});  // fire-and-forget — DB already has good results
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }

    // DB results insufficient — try Spotify
    const spotifyQuery = year ? `${query} year:${year}` : query;
    let releases;
    try {
      let spotifyResults = await searchSpotifyAlbums(spotifyQuery, 10, market);
      if (year) spotifyResults = spotifyResults.filter(r => !r.date || r.date.startsWith(year));
      saveBasicReleases(spotifyResults).catch(() => {});  // persist to DB, fire-and-forget
      releases = spotifyResults;
    } catch (err) {
      if (err instanceof SpotifyCircuitOpenError) {
        // Spotify quota exhausted — return whatever the DB has (may be sparse/empty)
        return new Response(JSON.stringify({ releases: dbResults }), { headers: { 'Content-Type': 'application/json' } });
      }
      throw err;
    }

    const body = { releases };
    await cacheSet(cacheKey, body, SEARCH_TTL);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
