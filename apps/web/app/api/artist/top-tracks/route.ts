import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// An artist's songs in popularity order, for the artist page's Songs tab
// (web + iOS), 2026-09-30.
//
// The catalogue has no per-song popularity: artists.popularity is artist-level
// (Deezer fans) and release_groups.prestige_score is a sparse critics signal.
// So the Songs tab fell back to title order (web) or rating count -> newest
// (iOS), which read as random / "recently ordered".
//
// Source: Last.fm artist.getTopTracks (play counts). Measured against our
// recordings: Primary 24 matches, E SENS 64, Epik High 81 -- Deezer's
// /artist/{id}/top had 0-1 for the Korean hip-hop artists, so it isn't used.
// Queried under the artist's name, native name and Korean phonetic name
// (Last.fm files many K-artists under either), keeping the higher play count.
//
// Returns our recording ids for this artist, most played first. Recordings
// Last.fm doesn't know are left out; clients keep their own order for those,
// after the ranked ones. Cached 7 days. No LASTFM_API_KEY -> empty order.

const TTL_SECONDS = 7 * 24 * 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Title match key: NFKC, lowercase, drop featured-artist credits -- "(feat. X)",
// "[with Y]", "(prod. Z)", a bare trailing "feat. X" -- and punctuation. Version
// tags like "(Instrumental)" / "[Live]" / "(Remix)" are KEPT, so an instrumental
// only matches Last.fm's instrumental entry instead of inheriting the original's
// play count (seen with Epik High: "Rain Song (instrumental)" ranked first).
const CREDIT = /[(\[]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?|produced by)\b[^)\]]*[)\]]|\s(?:feat\.?|ft\.?|featuring)\s.*$/gi;
const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFKC').toLowerCase().replace(CREDIT, '').replace(/[^\p{L}\p{N}]/gu, '');

async function lastfmTopTracks(artist: string, key: string): Promise<{ name: string; playcount: number }[]> {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(artist)}`
    + `&autocorrect=1&limit=200&api_key=${key}&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const json = await res.json();
    const tracks = json?.toptracks?.track ?? [];
    return (Array.isArray(tracks) ? tracks : [tracks]).map((t: any) => ({
      name: String(t?.name ?? ''), playcount: Number(t?.playcount ?? 0) || 0,
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'artist-top-tracks', 60, 60);
  if (limited) return limited;

  const artistId = req.nextUrl.searchParams.get('artistId');
  const nameParam = req.nextUrl.searchParams.get('name')?.trim() ?? '';
  if (artistId ? !UUID_RE.test(artistId) : !nameParam) {
    return NextResponse.json({ error: 'artistId or name required' }, { status: 400 });
  }
  const cacheKey = `sj:toptracks:v2:${artistId ?? `name:${nameParam.toLowerCase()}`}`;
  const cached = await cacheGet<{ order: string[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const key = process.env.LASTFM_API_KEY;
  const db = createServerClient();
  if (!key || !db) return NextResponse.json({ order: [] });

  // Artist names to ask Last.fm about.
  const lookup = artistId
    ? db.from('artists').select('name, name_native, name_phonetic_ko').eq('id', artistId).limit(1)
    : db.from('artists').select('name, name_native, name_phonetic_ko').eq('name', nameParam).limit(1);
  const { data: artistRows } = await lookup;
  const artist = (artistRows as any[] | null)?.[0];
  const displayName: string = artist?.name ?? nameParam;
  if (!displayName) return NextResponse.json({ order: [] });
  const names = [...new Set([displayName, artist?.name_native, artist?.name_phonetic_ko]
    .filter((n): n is string => !!n && !!n.trim()))];

  // Same recording set the Songs tab shows (exact artist_display; see the
  // web artist page's note on why eq, not ilike).
  const [{ data: recs }, ...lists] = await Promise.all([
    db.from('recordings').select('id, title').eq('artist_display', displayName).limit(400),
    ...names.map((n) => lastfmTopTracks(n, key)),
  ]);

  const plays = new Map<string, number>();
  for (const list of lists) {
    for (const t of list) {
      const k = norm(t.name);
      if (k) plays.set(k, Math.max(plays.get(k) ?? 0, t.playcount));
    }
  }
  const order = ((recs as { id: string; title: string }[] | null) ?? [])
    .map((r) => ({ id: r.id, plays: plays.get(norm(r.title)) ?? -1 }))
    .filter((r) => r.plays >= 0)
    .sort((a, b) => b.plays - a.plays)
    .map((r) => r.id);

  const payload = { order };
  // Don't pin an empty answer for a week -- Last.fm may just have been down.
  await cacheSet(cacheKey, payload, order.length ? TTL_SECONDS : 3600);
  return NextResponse.json(payload);
}
