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

export async function GET(req: NextRequest) {
  const artistsParam = req.nextUrl.searchParams.get('artists') ?? '';
  const excludeIdsParam = req.nextUrl.searchParams.get('excludeIds') ?? '';
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0', 10);

  const artistNames = artistsParam.split(',').filter(Boolean);
  const excludeIds = new Set(excludeIdsParam.split(',').filter(Boolean));

  const albums: AlbumRelease[] = [];
  const seen = new Set(excludeIds);

  const supabase = createServerClient();

  // ── Community picks (page 0 only) ────────────────────────────────────────
  if (page === 0 && supabase) {
    const { data: allRatings } = await supabase.from('ratings').select('release_id');
    if (allRatings && allRatings.length > 0) {
      const counts = new Map<string, number>();
      for (const r of allRatings) {
        counts.set(r.release_id, (counts.get(r.release_id) ?? 0) + 1);
      }
      const topIds = shuffle(
        [...counts.entries()]
          .filter(([id]) => !excludeIds.has(id))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 60)
      )
        .slice(0, 20)
        .map(([id]) => id);

      if (topIds.length > 0) {
        const { data: releases } = await supabase
          .from('releases')
          .select('id, title, artist, cover_url, release_type, release_date')
          .in('id', topIds)
          .not('release_type', 'ilike', 'single');
        const releaseMap = new Map((releases ?? []).map((r: any) => [r.id, r]));
        for (const id of topIds) {
          const r = releaseMap.get(id);
          if (r && !seen.has(r.id)) {
            seen.add(r.id);
            albums.push(toRelease(r));
          }
        }
      }
    }
  }

  // ── Artist picks: single combined OR query, paginated ────────────────────
  let hasMoreResults = false;

  if (artistNames.length > 0 && supabase) {
    const orClause = artistNames.map((n) => `artist.ilike.%${n}%`).join(',');
    let query = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(orClause)
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single');

    if (excludeIds.size > 0) {
      query = query.not('id', 'in', `(${[...excludeIds].join(',')})`);
    }

    const { data: dbReleases } = await query
      .order('release_date', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (dbReleases && dbReleases.length > 0) {
      hasMoreResults = true;
      for (const r of shuffle(dbReleases)) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          albums.push(toRelease(r));
        }
      }
    }

    // No runtime Spotify fallback — when artist catalogs are missing from the
    // DB, the prestige-ordered DB browse below picks up the slack.
  }

  // ── Fallback: prestige-ordered DB browse when artist albums exhausted ─────
  if (!hasMoreResults && supabase) {
    let query = supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .not('cover_url', 'is', null)
      .not('release_type', 'ilike', 'single');

    if (excludeIds.size > 0) {
      query = query.not('id', 'in', `(${[...excludeIds].join(',')})`);
    }

    const { data: fallbackReleases } = await query
      .order('prestige', { ascending: true, nullsFirst: false })
      .order('release_date', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (fallbackReleases && fallbackReleases.length > 0) {
      hasMoreResults = true;
      for (const r of fallbackReleases) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          albums.push(toRelease(r));
        }
      }
    }
  }

  return NextResponse.json({ albums, hasMore: hasMoreResults });
}
