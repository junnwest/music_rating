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
// Over-fetch, then re-rank for intent in JS so an exact/prefix match always beats a merely
// popular substring hit. A prestige-only DB order would rank a very prestigious album that just
// *contains* the query above the album whose title *is* the query.
const ARTIST_POOL = 12;
const ALBUM_POOL = 15;

/** 3 = exact, 2 = prefix, 1 = substring — the strongest match across the given fields wins. */
function intentRank(q: string, ...fields: (string | null | undefined)[]): number {
  let best = 1;
  for (const f of fields) {
    if (!f) continue;
    const v = f.toLowerCase();
    if (v === q) return 3;
    if (v.startsWith(q)) best = Math.max(best, 2);
  }
  return best;
}

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

  const ql = q.toLowerCase();
  const prefix = `${q.replace(/[%_,()]/g, ' ').trim()}%`;
  const [artistsResult, albumsResult] = await Promise.all([
    supabase
      .from('artists')
      .select('id, name, name_native, cover_url')
      .or(`name.ilike.${prefix},name_native.ilike.${prefix}`)
      .limit(ARTIST_POOL),
    supabase
      .from('release_groups')
      .select('id, title, native_title, artist_display, cover_url, release_group_type, prestige_score')
      .or(`title.ilike.${prefix},artist_display.ilike.${prefix},native_title.ilike.${prefix}`)
      .neq('release_group_type', 'single')
      .order('prestige_score', { ascending: false, nullsFirst: false })
      .limit(ALBUM_POOL),
  ]);

  // Artists: exact > prefix, then the shorter name (a decent proxy for the primary/best-known
  // act — "Drake" before "Drake Bell") so what the user meant floats up.
  const artists: SuggestArtist[] = (artistsResult.data ?? [])
    .map((a: any) => ({
      item: {
        id: a.id,
        name: a.name,
        nameNative: a.name_native ?? null,
        coverUrl: a.cover_url ?? null,
      } as SuggestArtist,
      rank: intentRank(ql, a.name, a.name_native),
    }))
    .sort((a, b) => b.rank - a.rank || a.item.name.length - b.item.name.length)
    .slice(0, MAX_ARTISTS)
    .map((r) => r.item);

  // Albums: exact/prefix match first, prestige (popularity) as the tiebreaker — the rows arrive
  // prestige-ordered, so a stable sort on intent keeps popular-first within each match tier.
  const albums: SuggestAlbum[] = (albumsResult.data ?? [])
    .map((r: any) => ({
      item: {
        id: r.id,
        title: r.title,
        titleNative: r.native_title ?? null,
        artist: r.artist_display,
        coverUrl: r.cover_url ?? null,
        releaseType: r.release_group_type ?? null,
      } as SuggestAlbum,
      rank: intentRank(ql, r.title, r.native_title, r.artist_display),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_ALBUMS)
    .map((r) => r.item);

  const result = { artists, albums };
  cacheSet(cacheKey, result, SUGGEST_TTL).catch(() => {});

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' },
  });
}
