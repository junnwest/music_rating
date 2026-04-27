import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getSpotifyRecommendations } from '../../../../lib/spotify';

const CATEGORIES = [
  { key: 'k-pop', query: 'k-pop' },
  { key: 'korean-indie', query: 'korean indie' },
  { key: 'korean-rb', query: 'korean r&b' },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret');
  if (!process.env.SEED_SECRET || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const results = [];

  for (const cat of CATEGORIES) {
    const albums = await getSpotifyRecommendations(cat.query);

    if (albums.length === 0) {
      results.push({ category: cat.key, count: 0, note: 'Spotify returned nothing — try again later' });
      continue;
    }

    const rows = albums.map((a) => ({
      category: cat.key,
      release_id: a.id,
      title: a.title,
      artist: a.artist,
      cover_url: a.coverUrl ?? null,
      release_type: a.releaseType,
    }));

    const { error } = await supabase
      .from('curated_releases')
      .upsert(rows, { onConflict: 'category,release_id' });

    results.push({ category: cat.key, count: rows.length, error: error?.message ?? null });
  }

  return NextResponse.json({ results });
}
