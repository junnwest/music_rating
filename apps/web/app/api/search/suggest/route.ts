import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// Instant typeahead for the top-bar omnibox. Prefix ilike hits the GIN
// trigram indexes on release_groups (20260706000017); results are cached
// per query so repeats never touch the DB.
//
// (Rewritten 2026-07-07: the original queried the pre-renovation `releases`
// columns — artist/release_type/prestige — which no longer exist.)

const SUGGEST_TTL = 60 * 10; // 10 minutes
const MAX_ARTISTS = 3;
const MAX_ALBUMS = 5;

export interface SuggestArtist {
  id: string;
  name: string;
  nameNative: string | null;
  coverUrl: string | null;
}

export interface SuggestAlbum {
  id: string;
  title: string;
  titleNative: string | null;
  artist: string;
  coverUrl: string | null;
  releaseType: string | null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('query')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ artists: [], albums: [] });

  const cacheKey = `sj:suggest2:${q.toLowerCase()}`;
  const cached = await cacheGet<{ artists: SuggestArtist[]; albums: SuggestAlbum[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ artists: [], albums: [] });

  const prefix = `${q.replace(/[%_,()]/g, ' ').trim()}%`;
  const [artistsResult, albumsResult] = await Promise.all([
    supabase
      .from('artists')
      .select('id, name, name_native, cover_url')
      .or(`name.ilike.${prefix},name_native.ilike.${prefix}`)
      .limit(MAX_ARTISTS),
    supabase
      .from('release_groups')
      .select('id, title, native_title, artist_display, cover_url, release_group_type, prestige_score')
      .or(`title.ilike.${prefix},artist_display.ilike.${prefix},native_title.ilike.${prefix}`)
      .neq('release_group_type', 'single')
      .order('prestige_score', { ascending: false, nullsFirst: false })
      .limit(MAX_ALBUMS),
  ]);

  const artists: SuggestArtist[] = (artistsResult.data ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    nameNative: a.name_native ?? null,
    coverUrl: a.cover_url ?? null,
  }));

  const albums: SuggestAlbum[] = (albumsResult.data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    titleNative: r.native_title ?? null,
    artist: r.artist_display,
    coverUrl: r.cover_url ?? null,
    releaseType: r.release_group_type ?? null,
  }));

  const result = { artists, albums };
  cacheSet(cacheKey, result, SUGGEST_TTL).catch(() => {});

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' },
  });
}
