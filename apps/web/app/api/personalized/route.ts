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

const MIN_UNRATED = 5;

export async function GET(req: NextRequest) {
  const artistsParam = req.nextUrl.searchParams.get('artists') ?? '';
  const userId = req.nextUrl.searchParams.get('userId') ?? '';

  const artists = artistsParam.split(',').filter(Boolean).slice(0, 5);

  const supabase = createServerClient();

  // Fetch all rated release IDs for this user from the server
  let excludeIds = new Set<string>();
  if (supabase && userId) {
    const { data: ratedRows } = await supabase
      .from('ratings')
      .select('release_id')
      .eq('user_id', userId);
    excludeIds = new Set((ratedRows ?? []).map((r: any) => r.release_id));
  }

  const sections = (
    await Promise.all(
      artists.map(async (artistName) => {
        let albums: AlbumRelease[] = [];

        // ── Primary: query releases already in our DB ─────────────────────
        if (supabase) {
          let query = supabase
            .from('releases')
            .select('id, title, artist, cover_url, release_type, release_date')
            .ilike('artist', `%${artistName}%`)
            .not('release_type', 'ilike', 'single');

          if (excludeIds.size > 0) {
            query = query.not('id', 'in', `(${[...excludeIds].join(',')})`);
          }

          const { data: dbReleases } = await query.limit(40);

          albums = (dbReleases ?? []).map((r: any) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            date: r.release_date ?? null,
            country: null,
            releaseType: r.release_type ?? 'Album',
            coverUrl: r.cover_url ?? null,
          }));
        }

        // No runtime Spotify supplement — if the DB lacks the artist's catalog,
        // populate it via npm run expand:discography / expand:related.
        const filtered = shuffle(albums).slice(0, 20);
        if (filtered.length < MIN_UNRATED) return null;

        return {
          title: `More from ${artistName}`,
          subtitle: "Albums you haven't rated yet",
          albums: filtered,
        };
      })
    )
  ).filter(Boolean);

  return NextResponse.json({ sections });
}
