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
// Songs are opt-in (`?types=songs`, the mix page's add panel) — the omnibox
// never pays for them. A title prefix on 3.6M recordings is fast for specific
// words but can take seconds for common ones ("love"), so it runs under a hard
// budget and simply comes back empty when it blows it.
const MAX_SONGS = 6;
const SONG_POOL = 20;
const SONG_BUDGET_MS = 1500;

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

export interface SuggestSong {
  id: string;
  title: string;
  artist: string;
  releaseGroupId: string;
  albumTitle: string;
  coverUrl: string | null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('query')?.trim() ?? '';
  const wantSongs = (req.nextUrl.searchParams.get('types') ?? '').split(',').includes('songs');
  if (q.length < 2) return NextResponse.json({ artists: [], albums: [], ...(wantSongs ? { songs: [] } : {}) });

  const cacheKey = `sj:suggest2:${wantSongs ? 'songs:' : ''}${q.toLowerCase()}`;
  const cached = await cacheGet<{ artists: SuggestArtist[]; albums: SuggestAlbum[]; songs?: SuggestSong[] }>(
    cacheKey,
  );
  if (cached) return NextResponse.json(cached);

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ artists: [], albums: [] });

  const ql = q.toLowerCase();
  const prefix = `${q.replace(/[%_,()]/g, ' ').trim()}%`;
  const songsPromise: Promise<SuggestSong[]> =
    wantSongs && q.length >= 3 ? suggestSongs(supabase, ql, prefix) : Promise.resolve([]);
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

  // Drop artists with nothing to show. The `area` discovery lane queues every MB artist ENTITY in
  // a country/city, and MB entities exist without any releases (see migration 20260728000000), so
  // ~13% of the catalog would otherwise suggest a page that renders empty. The "has releases" test
  // mirrors get_artist_release_groups — primary UNION credited — so we never suggest a dead end.
  // Answered server-side (artists_with_releases) rather than by de-duplicating release rows here:
  // one prolific artist can exceed PostgREST's 1000-row response cap and truncate another's rows,
  // which would read as "no releases" and hide a real artist.
  const artistPool = (artistsResult.data ?? []) as any[];
  const withReleases = new Set<string>();
  if (artistPool.length) {
    const { data: nonEmpty } = await supabase.rpc('artists_with_releases', {
      p_ids: artistPool.map((a) => a.id),
    });
    for (const r of (nonEmpty ?? []) as any[]) withReleases.add(r.artist_id);
  }

  // Artists: exact > prefix, then the shorter name (a decent proxy for the primary/best-known
  // act — "Drake" before "Drake Bell") so what the user meant floats up.
  const artists: SuggestArtist[] = artistPool
    .filter((a: any) => withReleases.has(a.id))
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

  const songs = await songsPromise;
  const result = wantSongs ? { artists, albums, songs } : { artists, albums };
  cacheSet(cacheKey, result, SUGGEST_TTL).catch(() => {});

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' },
  });
}

async function suggestSongs(
  supabase: NonNullable<ReturnType<typeof createServerClient>>,
  ql: string,
  prefix: string,
): Promise<SuggestSong[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SONG_BUDGET_MS);
  try {
    const { data: recs, error } = await supabase
      .from('recordings')
      .select('id, title, artist_display')
      .ilike('title', prefix)
      .limit(SONG_POOL)
      .abortSignal(ctrl.signal);
    if (error || !recs?.length) return [];
    // Each song needs an album for its cover and for mix_song_items'
    // release_group_id — the canonical edition's, like the search page.
    const { data: rt, error: rtErr } = await supabase
      .from('release_tracks')
      .select('recording_id, releases(is_canonical, release_groups(id, title, cover_url, prestige_score))')
      .in(
        'recording_id',
        recs.map((r: any) => r.id),
      )
      .abortSignal(ctrl.signal);
    if (rtErr) return [];
    const rgBy: Record<string, any> = {};
    for (const row of (rt ?? []) as any[]) {
      const rg = row.releases?.release_groups;
      if (!rg) continue;
      if (row.releases?.is_canonical || !rgBy[row.recording_id]) rgBy[row.recording_id] = rg;
    }
    return (recs as any[])
      .filter((r) => rgBy[r.id])
      .map((r) => ({
        item: {
          id: r.id,
          title: r.title,
          artist: r.artist_display ?? '',
          releaseGroupId: rgBy[r.id].id,
          albumTitle: rgBy[r.id].title,
          coverUrl: rgBy[r.id].cover_url ?? null,
        } as SuggestSong,
        rank: intentRank(ql, r.title),
        prestige: rgBy[r.id].prestige_score ?? 0,
      }))
      .sort((a, b) => b.rank - a.rank || b.prestige - a.prestige)
      .slice(0, MAX_SONGS)
      .map((r) => r.item);
  } catch {
    return []; // aborted: over budget
  } finally {
    clearTimeout(timer);
  }
}
