import { NextRequest, NextResponse } from 'next/server';
import { fetchMoreArtistAlbums } from '../../../lib/spotify';

export async function GET(req: NextRequest) {
  const cursor = req.nextUrl.searchParams.get('cursor');
  if (!cursor) return NextResponse.json({ releases: [], nextCursor: null });
  const result = await fetchMoreArtistAlbums(decodeURIComponent(cursor));
  return NextResponse.json(result);
}
