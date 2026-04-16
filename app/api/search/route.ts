import { fetchMusicBrainzReleases } from '../../../lib/musicbrainz';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query parameter' }), { status: 400 });
  }

  const releases = await fetchMusicBrainzReleases(query);
  return new Response(JSON.stringify({ releases }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
