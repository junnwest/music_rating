import { searchSpotifyAlbums, searchSpotifyArtists, searchSpotifyTracks } from '../../../lib/spotify';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const type = searchParams.get('type') ?? 'releases';
  const year = searchParams.get('year');
  const market = searchParams.get('market') ?? undefined;

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query parameter' }), { status: 400 });
  }

  try {
    if (type === 'artists') {
      const artists = await searchSpotifyArtists(query);
      return new Response(JSON.stringify({ artists }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (type === 'recordings') {
      const recordings = await searchSpotifyTracks(query);
      return new Response(JSON.stringify({ recordings }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Append year filter to Spotify query if provided (Spotify supports year:XXXX natively)
    const spotifyQuery = year ? `${query} year:${year}` : query;
    let releases = await searchSpotifyAlbums(spotifyQuery, 10, market);

    // Post-filter by year as a belt-and-suspenders check
    if (year) {
      releases = releases.filter(r => !r.date || r.date.startsWith(year));
    }

    return new Response(JSON.stringify({ releases }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
