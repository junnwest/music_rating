import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  const yearParam = req.nextUrl.searchParams.get('year');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const year = parseInt(yearParam ?? String(new Date().getFullYear()), 10);
  const start = `${year}-01-01T00:00:00.000Z`;
  const end = `${year + 1}-01-01T00:00:00.000Z`;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { data: ratings } = await supabase
    .from('ratings')
    .select('score, created_at, release_id, releases(title, artist, genres, cover_url)')
    .eq('user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end)
    .not('score', 'is', null);

  if (!ratings || ratings.length === 0) {
    return NextResponse.json({ year, empty: true });
  }

  // Total rated
  const total = ratings.length;
  const scores = ratings.map((r: any) => r.score as number);
  const avgScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

  // Top genre
  const genreCount = new Map<string, number>();
  for (const r of ratings) {
    const genreStr = (r.releases as any)?.genres as string | null;
    if (!genreStr) continue;
    for (const g of genreStr.split(',')) {
      const g2 = g.trim().toLowerCase();
      if (g2) genreCount.set(g2, (genreCount.get(g2) ?? 0) + 1);
    }
  }
  const topGenreRaw = [...genreCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topGenre = topGenreRaw
    ? topGenreRaw.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : null;

  // Top artist (most rated)
  const artistCount = new Map<string, number>();
  for (const r of ratings) {
    const artist = (r.releases as any)?.artist as string | null;
    if (artist) artistCount.set(artist, (artistCount.get(artist) ?? 0) + 1);
  }
  const topArtist = [...artistCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topArtistCount = topArtist ? (artistCount.get(topArtist) ?? 0) : 0;

  // Highest & lowest rated
  const sorted = [...ratings].sort((a: any, b: any) => b.score - a.score);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  // Most active month
  const monthCount = new Map<number, number>();
  for (const r of ratings) {
    const m = new Date(r.created_at).getMonth();
    monthCount.set(m, (monthCount.get(m) ?? 0) + 1);
  }
  const topMonthIdx = [...monthCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topMonthLabel =
    topMonthIdx !== null
      ? new Date(year, topMonthIdx).toLocaleString('en-US', { month: 'long' })
      : null;
  const topMonthCount = topMonthIdx !== null ? (monthCount.get(topMonthIdx) ?? 0) : 0;

  // Perfect scores
  const perfectCount = scores.filter((s) => s === 5).length;

  return NextResponse.json({
    year,
    empty: false,
    total,
    avgScore,
    topGenre,
    topArtist,
    topArtistCount,
    perfectCount,
    topMonthLabel,
    topMonthCount,
    highest: highest
      ? {
          title: (highest.releases as any)?.title ?? '—',
          artist: (highest.releases as any)?.artist ?? '',
          coverUrl: (highest.releases as any)?.cover_url ?? null,
          score: highest.score,
          releaseId: highest.release_id,
        }
      : null,
    lowest: lowest && lowest.release_id !== highest?.release_id
      ? {
          title: (lowest.releases as any)?.title ?? '—',
          artist: (lowest.releases as any)?.artist ?? '',
          coverUrl: (lowest.releases as any)?.cover_url ?? null,
          score: lowest.score,
          releaseId: lowest.release_id,
        }
      : null,
  });
}
