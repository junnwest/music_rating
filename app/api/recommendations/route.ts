import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { resolveArtistId, searchAlbumsByArtistId, searchAlbumsByArtistName } from '../../../lib/spotify';
import type { AlbumRelease } from '../../../types';

export async function GET(req: NextRequest) {
  const artistsParam = req.nextUrl.searchParams.get('artists') ?? '';
  const excludeIdsParam = req.nextUrl.searchParams.get('excludeIds') ?? '';
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0', 10);

  const artistNames = artistsParam.split(',').filter(Boolean).slice(0, 5);
  const excludeIds = new Set(excludeIdsParam.split(',').filter(Boolean));

  const albums: AlbumRelease[] = [];
  const seen = new Set(excludeIds);

  // ── Might Know (community): only on page 0 ───────────────────────────────
  if (page === 0) {
    const supabase = createServerClient();
    if (supabase) {
      const { data: allRatings } = await supabase.from('ratings').select('release_id');
      if (allRatings && allRatings.length > 0) {
        const counts = new Map<string, number>();
        for (const r of allRatings) {
          counts.set(r.release_id, (counts.get(r.release_id) ?? 0) + 1);
        }
        const topIds = [...counts.entries()]
          .filter(([id]) => !excludeIds.has(id))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([id]) => id);

        if (topIds.length > 0) {
          const { data: releases } = await supabase
            .from('releases')
            .select('id, title, artist, cover_url, release_type, release_date')
            .in('id', topIds);
          const releaseMap = new Map((releases ?? []).map((r: any) => [r.id, r]));
          for (const id of topIds) {
            const r = releaseMap.get(id);
            if (r && !seen.has(r.id)) {
              seen.add(r.id);
              albums.push({
                id: r.id,
                title: r.title,
                artist: r.artist,
                date: r.release_date ?? null,
                country: null,
                releaseType: r.release_type ?? 'Album',
                coverUrl: r.cover_url ?? null,
              });
            }
          }
        }
      }
    }
  }

  // ── Might Love: precise per-artist search with fallback ──────────────────
  let spotifyHadResults = false;
  if (artistNames.length > 0) {
    const offset = page * 10;

    const pages = await Promise.all(
      artistNames.map(async (name) => {
        const id = await resolveArtistId(name);

        // Primary: filter by Spotify artist ID (exact, no lookalikes)
        if (id) {
          const results = await searchAlbumsByArtistId(id, name, offset);
          if (results.length > 0) return results;
        }

        // Fallback: name search + exact name match filter
        const fallback = await searchAlbumsByArtistName(name, offset);
        const nameLower = name.toLowerCase();
        return fallback.filter((album) =>
          album.artist.split(',').some((a) => a.trim().toLowerCase() === nameLower)
        );
      })
    );

    for (const list of pages) {
      if (list.length > 0) spotifyHadResults = true;
      for (const album of list) {
        if (!seen.has(album.id)) {
          seen.add(album.id);
          albums.push(album);
        }
      }
    }
  }

  return NextResponse.json({ albums, hasMore: spotifyHadResults });
}
