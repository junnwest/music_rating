import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { resolveArtistId, searchAlbumsByArtistId, searchAlbumsByArtistName } from '../../../lib/spotify';
import type { AlbumRelease } from '../../../types';

export async function GET(req: NextRequest) {
  const artistsParam = req.nextUrl.searchParams.get('artists') ?? '';
  const excludeIdsParam = req.nextUrl.searchParams.get('excludeIds') ?? '';

  const artists = artistsParam.split(',').filter(Boolean).slice(0, 5);
  const excludeIds = new Set(excludeIdsParam.split(',').filter(Boolean));

  const supabase = createServerClient();

  const sections = (
    await Promise.all(
      artists.map(async (artistName) => {
        const nameLower = artistName.toLowerCase();
        let albums: AlbumRelease[] = [];

        // ── Primary: query releases already in our DB ─────────────────────
        if (supabase) {
          const { data: dbReleases } = await supabase
            .from('releases')
            .select('id, title, artist, cover_url, release_type, release_date')
            .ilike('artist', `%${artistName}%`)
            .limit(20);

          albums = (dbReleases ?? [])
            .filter((r: any) => !excludeIds.has(r.id))
            .map((r: any) => ({
              id: r.id,
              title: r.title,
              artist: r.artist,
              date: r.release_date ?? null,
              country: null,
              releaseType: r.release_type ?? 'Album',
              coverUrl: r.cover_url ?? null,
            }));
        }

        // ── Fallback: Spotify (only if DB has fewer than 5 results) ──────
        if (albums.length < 5) {
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

            // Merge with existing DB results, dedup
            const seen = new Set(albums.map((a) => a.id));
            for (const a of spotifyAlbums) {
              if (!excludeIds.has(a.id) && !seen.has(a.id)) {
                seen.add(a.id);
                albums.push(a);
              }
            }
          } catch {}
        }

        const filtered = albums.slice(0, 20);
        if (filtered.length === 0) return null;

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
