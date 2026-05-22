import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { resolveArtistId, searchAlbumsByArtistId, searchAlbumsByArtistName } from '../../../lib/spotify';
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
        const nameLower = artistName.toLowerCase();
        let albums: AlbumRelease[] = [];

        // ── Primary: query releases already in our DB ─────────────────────
        if (supabase) {
          let query = supabase
            .from('releases')
            .select('id, title, artist, cover_url, release_type, release_date')
            .ilike('artist', `%${artistName}%`);

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

        // ── Supplement with Spotify only if DB doesn't have enough ──────
        if (albums.length < 10) {
          try {
            const id = await resolveArtistId(artistName);
            let spotifyAlbums: AlbumRelease[] = [];

            if (id) {
              spotifyAlbums = await searchAlbumsByArtistId(id, artistName);
            }
            if (!id || spotifyAlbums.length === 0) {
              const fallback = await searchAlbumsByArtistName(artistName);
              spotifyAlbums = fallback.filter((a) =>
                a.artist.split(',').some((p) => p.trim().toLowerCase() === nameLower)
              );
            }

            const seen = new Set(albums.map((a) => a.id));
            for (const a of spotifyAlbums) {
              if (!excludeIds.has(a.id) && !seen.has(a.id)) {
                seen.add(a.id);
                albums.push(a);
              }
            }
          } catch {}
        }

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
