import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { cacheGet, cacheSet } from '../../../../lib/cache';

const SUGGEST_TTL = 60 * 10; // 10 minutes
const MAX_ARTISTS = 2;
const MAX_RELEASES = 5;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('query')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ artists: [], releases: [] });

  const cacheKey = `sj:suggest:${q.toLowerCase()}`;
  const cached = await cacheGet<{ artists: unknown[]; releases: unknown[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ artists: [], releases: [] });

  // Prefix match (`q%`) uses B-tree indexes and is near-instant.
  // Both queries share a single DB connection.
  const prefix = `${q}%`;
  const [artistsResult, releasesResult] = await Promise.all([
    supabase
      .from('artists')
      .select('id, name, cover_url, popularity')
      .or(`name.ilike.${prefix},name_native.ilike.${prefix}`)
      .order('popularity', { ascending: false, nullsFirst: false })
      .limit(MAX_ARTISTS),
    supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(`title.ilike.${prefix},artist.ilike.${prefix}`)
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single')
      .order('prestige', { ascending: true, nullsFirst: false })
      .limit(MAX_RELEASES),
  ]);

  const artists = (artistsResult.data ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    coverUrl: a.cover_url ?? null,
    genres: [],
    popularity: a.popularity ?? 0,
  }));

  const releases = (releasesResult.data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    coverUrl: r.cover_url ?? null,
    releaseType: r.release_type ?? 'Album',
    date: r.release_date ?? null,
    country: null,
  }));

  const result = { artists, releases };
  cacheSet(cacheKey, result, SUGGEST_TTL).catch(() => {});

  return NextResponse.json(result);
}
