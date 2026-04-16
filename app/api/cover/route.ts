import { fetchCoverArtUrl } from '../../../lib/coverArt';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const mbid = request.nextUrl.searchParams.get('mbid');
  if (!mbid) {
    return new Response(JSON.stringify({ url: null }), { status: 400 });
  }
  const url = await fetchCoverArtUrl(mbid);
  return new Response(JSON.stringify({ url }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
