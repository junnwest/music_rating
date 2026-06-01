import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import type { AlbumRelease } from '../../../types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PAGE_SIZE = 20;

function toRelease(r: any): AlbumRelease {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    date: r.release_date ?? null,
    country: null,
    releaseType: r.release_type ?? 'Album',
    coverUrl: r.cover_url ?? null,
  };
}

// Interpolate bucket proportions from adventurousness (0–100).
// Conservative (0):  90% in-taste / 8% adjacent / 2% discovery
// Default (50):      70% in-taste / 20% adjacent / 10% discovery
// Adventurous (100): 45% in-taste / 30% adjacent / 25% discovery
function bucketSizes(adventurousness: number, total: number): { inTaste: number; adjacent: number; discovery: number } {
  const t = Math.max(0, Math.min(100, adventurousness)) / 100;
  const inTastePct  = 0.90 - 0.45 * t;
  const adjacentPct = 0.08 + 0.22 * t;
  const inTaste  = Math.round(inTastePct  * total);
  const adjacent = Math.round(adjacentPct * total);
  const discovery = Math.max(0, total - inTaste - adjacent);
  return { inTaste, adjacent, discovery };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const artistsParam      = searchParams.get('artists')         ?? '';
  const genresParam       = searchParams.get('genres')          ?? '';
  const excludeIdsParam   = searchParams.get('excludeIds')      ?? '';
  const page              = parseInt(searchParams.get('page')   ?? '0', 10);
  const adventurousness   = parseInt(searchParams.get('adventurousness') ?? '50', 10);
  const userId            = searchParams.get('userId')          ?? '';
  // Active browse filters — when set, constrain ALL buckets to these values
  const filterGenre  = searchParams.get('filterGenre')  ?? '';
  const filterType   = searchParams.get('filterType')   ?? '';  // 'Album' | 'EP' | ''
  const filterDecade = searchParams.get('filterDecade') ?? '';  // e.g. '1990' → 1990–1999

  const artistNames = artistsParam.split(',').filter(Boolean);
  const genreNames  = genresParam.split(',').filter(Boolean);
  const excludeIds  = new Set(excludeIdsParam.split(',').filter(Boolean));
  const seen        = new Set(excludeIds);

  const supabase = createServerClient();

  const { inTaste: inTasteN, adjacent: adjacentN, discovery: discoveryN } = bucketSizes(adventurousness, PAGE_SIZE);

  // Helper: apply active browse filters to any query builder
  function applyBrowseFilters<T>(q: T): T {
    let query = q as any;
    if (filterGenre)  query = query.ilike('genres', `%${filterGenre}%`);
    if (filterType)   query = query.eq('release_type', filterType);
    if (filterDecade) {
      const yr = parseInt(filterDecade, 10);
      query = query.gte('release_date', `${yr}-01-01`).lte('release_date', `${yr + 9}-12-31`);
    }
    return query as T;
  }

  // ── Artists the user rated ≤2★ (excluded from in-taste + adjacent buckets) ─
  const negativeArtists = new Set<string>();
  if (userId && supabase) {
    const { data: negRatings } = await supabase
      .from('ratings')
      .select('releases(artist)')
      .eq('user_id', userId)
      .lte('score', 2.0);
    for (const r of negRatings ?? []) {
      const artist = (r.releases as any)?.artist as string | undefined;
      if (artist) negativeArtists.add(artist.split(',')[0].trim().toLowerCase());
    }
  }

  const albums: AlbumRelease[] = [];

  // ── IN-TASTE: artist-matching releases ─────────────────────────────────────
  if (supabase && inTasteN > 0 && artistNames.length > 0) {
    const orClause = artistNames.map((n) => `artist.ilike.%${n}%`).join(',');
    let q = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(orClause)
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single');

    q = applyBrowseFilters(q);
    if (excludeIds.size > 0) q = q.not('id', 'in', `(${[...excludeIds].join(',')})`);

    const { data: rows } = await q
      .order('release_date', { ascending: false })
      .range(page * inTasteN, page * inTasteN + inTasteN * 3 - 1);

    let count = 0;
    for (const r of shuffle(rows ?? [])) {
      if (seen.has(r.id)) continue;
      if (negativeArtists.has(r.artist?.split(',')[0]?.trim().toLowerCase() ?? '')) continue;
      seen.add(r.id);
      albums.push(toRelease(r));
      if (++count >= inTasteN) break;
    }
  }

  // ── ADJACENT: genre-matching releases (not already covered by in-taste) ────
  if (supabase && adjacentN > 0 && genreNames.length > 0) {
    const orClause = genreNames.map((g) => `genres.ilike.%${g}%`).join(',');
    let q = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(orClause)
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single');

    q = applyBrowseFilters(q);
    if (excludeIds.size > 0) q = q.not('id', 'in', `(${[...excludeIds].join(',')})`);

    const { data: rows } = await q
      .order('release_date', { ascending: false })
      .range(page * adjacentN, page * adjacentN + adjacentN * 3 - 1);

    let count = 0;
    for (const r of shuffle(rows ?? [])) {
      if (seen.has(r.id)) continue;
      if (negativeArtists.has(r.artist?.split(',')[0]?.trim().toLowerCase() ?? '')) continue;
      seen.add(r.id);
      albums.push(toRelease(r));
      if (++count >= adjacentN) break;
    }
  }

  // ── DISCOVERY: community-loved albums outside user's usual artists ──────────
  if (supabase && discoveryN > 0) {
    let q = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date, ratings_count')
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single')
      .gt('ratings_count', 0);

    q = applyBrowseFilters(q);
    if (excludeIds.size > 0) q = q.not('id', 'in', `(${[...excludeIds].join(',')})`);

    const { data: rows } = await q
      .order('ratings_count', { ascending: false, nullsFirst: false })
      .range(page * discoveryN, page * discoveryN + discoveryN * 4 - 1);

    // Prefer albums from artists the user hasn't seen (true discovery)
    const knownArtists = new Set(artistNames.map((a) => a.toLowerCase()));
    const unknown  = (rows ?? []).filter((r) => !knownArtists.has(r.artist?.split(',')[0]?.trim().toLowerCase() ?? ''));
    const familiar = (rows ?? []).filter((r) =>  knownArtists.has(r.artist?.split(',')[0]?.trim().toLowerCase() ?? ''));
    let count = 0;
    for (const r of [...shuffle(unknown), ...shuffle(familiar)]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      albums.push(toRelease(r));
      if (++count >= discoveryN) break;
    }
  }

  // ── Prestige fallback when buckets don't fill the page ────────────────────
  let hasMoreResults = albums.length > 0;
  if (supabase && albums.length < PAGE_SIZE) {
    let q = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single');

    q = applyBrowseFilters(q);
    const seenIds = [...seen];
    if (seenIds.length > 0) q = q.not('id', 'in', `(${seenIds.join(',')})`);

    const { data: fallback } = await q
      .order('prestige', { ascending: true, nullsFirst: false })
      .order('release_date', { ascending: false })
      .limit(PAGE_SIZE - albums.length + 10);

    if (fallback && fallback.length > 0) {
      hasMoreResults = true;
      for (const r of fallback) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          albums.push(toRelease(r));
        }
      }
    }
  }

  return NextResponse.json({ albums, hasMore: hasMoreResults });
}
