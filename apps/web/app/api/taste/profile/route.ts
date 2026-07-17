import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { eloToScore } from '../../../../lib/elo';
import { preferHangulName } from '../../../../lib/sj/display';
import { displayGenre } from '../../../../lib/taste/embeddings';
import { sceneOf, type Scene } from '../../../../lib/taste/albumVector';
import {
  weightsFromRatings,
  buildClusters,
  clusterProfiles,
  dislikedTags,
} from '../../../../lib/taste/profile';

// Full taste analysis for the Taste page (2026-07-13 rebuild: a graphical
// analysis report — world composition, release-decade and score-distribution
// histograms, scene mix, canon reach, 12-month activity — the MBTI-style
// 4-letter type is gone). Everything is computed here from a single ratings
// fetch so the client renders one payload. Clustering/vector math stays in
// Node against the bundled embeddings (Micro-instance rule).
//
// The user's stored profile row (user_taste_profiles) is still upserted when
// it drifts, since iOS/other consumers read it — but this route derives from
// the ratings directly, which it needs anyway for the charts.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 60;

interface RatingRow {
  score: number | null;
  elo_score: number | null;
  created_at: string;
  release_groups: {
    id: string;
    title: string;
    artist_display: string;
    cover_url: string | null;
    native_title: string | null;
    genres: string[] | null;
    first_release_date: string | null;
    prestige_score: number | null;
    artists: { name_native: string | null; country: string | null } | null;
  } | null;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-profile', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const cacheKey = `taste:profile:v4:${userId}`;
  if (!refresh) {
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [ratingsRes, standingsRes, trackCountRes] = await Promise.all([
    supabase
      .from('ratings')
      .select(
        'score, elo_score, created_at, release_groups(id, title, artist_display, cover_url, native_title, genres, first_release_date, prestige_score, artists!release_groups_primary_artist_id_fkey(name_native, country))',
      )
      .eq('user_id', userId)
      .limit(500),
    supabase.rpc('get_user_genre_standings', { p_user_id: userId }),
    supabase
      .from('track_ratings')
      .select('recording_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);
  if (ratingsRes.error) {
    console.error('[taste] ratings query error:', ratingsRes.error.message);
    return NextResponse.json({ error: ratingsRes.error.message }, { status: 503 });
  }

  const rows = ((ratingsRes.data as unknown as RatingRow[] | null) ?? []).filter(
    (r) => r.release_groups,
  );
  const display = (r: RatingRow) =>
    r.score ?? (r.elo_score != null ? eloToScore(r.elo_score) : null);
  const scored = rows.filter((r) => display(r) != null);

  // ── weights / clusters (+ keep the stored profile row in sync for iOS) ──
  const weights = weightsFromRatings(
    rows.map((r) => ({ score: r.score, elo_score: r.elo_score, genres: r.release_groups!.genres })),
  );
  const clusters = buildClusters(weights);
  const disliked = dislikedTags(weights);
  // Per-world era + scene profiles ("2020s · Korean scene") for the report.
  const worldProfiles = clusterProfiles(
    rows.map((r) => ({
      genres: r.release_groups!.genres,
      first_release_date: r.release_groups!.first_release_date,
      country: r.release_groups!.artists?.country ?? null,
    })),
    clusters,
  );
  const { error: upsertErr } = await supabase.from('user_taste_profiles').upsert({
    user_id: userId,
    genre_weights: weights,
    rating_count: rows.length,
    updated_at: new Date().toISOString(),
  });
  if (upsertErr) console.error('[taste] profile upsert error:', upsertErr.message);

  // ── headline stats (means + population std devs) ──
  const scores = scored.map((r) => display(r)!);
  const avgScore = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
  const sdScore =
    avgScore != null && scores.length > 1
      ? Math.sqrt(scores.reduce((s, x) => s + (x - avgScore) ** 2, 0) / scores.length)
      : null;
  const fiveStars = scores.filter((x) => x >= 5).length;

  const years = rows
    .map((r) => r.release_groups!.first_release_date)
    .filter((d): d is string => !!d)
    .map((d) => parseInt(d.slice(0, 4), 10))
    .filter((y) => y >= 1900);
  const meanYear = years.length > 0 ? years.reduce((s, y) => s + y, 0) / years.length : null;
  const sdYears =
    meanYear != null && years.length > 1
      ? Math.sqrt(years.reduce((s, y) => s + (y - meanYear) ** 2, 0) / years.length)
      : null;

  const top = scored.reduce<RatingRow | null>(
    (best, r) => (best == null || (display(r) ?? 0) > (display(best) ?? 0) ? r : best),
    null,
  );

  // ── chart data ──
  // Release decades (contiguous, zero-filled between first and last).
  const decadeMap = new Map<number, number>();
  for (const y of years) {
    const d = Math.floor(y / 10) * 10;
    decadeMap.set(d, (decadeMap.get(d) ?? 0) + 1);
  }
  const decades: { decade: number; count: number }[] = [];
  if (decadeMap.size > 0) {
    const first = Math.min(...decadeMap.keys());
    const last = Math.max(...decadeMap.keys());
    for (let d = first; d <= last; d += 10) decades.push({ decade: d, count: decadeMap.get(d) ?? 0 });
  }

  // Score distribution in half-star buckets (index 0 = 0.5★ … 9 = 5.0★).
  const scoreDist = Array.from({ length: 10 }, () => 0);
  for (const x of scores) scoreDist[Math.max(0, Math.min(9, Math.round(x * 2) - 1))] += 1;

  // Scene mix across all rated albums, by primary artist country.
  const sceneCounts: Record<Scene, number> = { kr: 0, jp: 0, west: 0, other: 0 };
  let sceneTotal = 0;
  for (const r of rows) {
    const s = sceneOf(r.release_groups!.artists?.country ?? null);
    if (s) {
      sceneCounts[s] += 1;
      sceneTotal += 1;
    }
  }

  // Rating activity over the last 12 calendar months (oldest first).
  const timeline: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    timeline.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, count: 0 });
  }
  const monthIndex = new Map(timeline.map((t, i) => [t.month, i]));
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const i = monthIndex.get(key);
    if (i != null) timeline[i].count += 1;
  }
  const peakCount = Math.max(...timeline.map((t) => t.count));

  // Canon reach: share of rated albums in the prestige canon (proxy for
  // mainstream/canonical listening — prestige covers curated canon lists).
  const prestigeShare =
    rows.length > 0
      ? rows.filter((r) => r.release_groups!.prestige_score != null).length / rows.length
      : 0;

  const r2 = (x: number | null) => (x != null ? Math.round(x * 100) / 100 : null);

  interface StandingRow {
    genre: string;
    user_avg: number;
    community_avg: number;
    user_count: number;
  }
  const standings = ((standingsRes.data as StandingRow[] | null) ?? []).map((s) => ({
    genre: displayGenre(s.genre),
    userAvg: Number(s.user_avg),
    communityAvg: Number(s.community_avg),
    userCount: Number(s.user_count),
  }));

  const payload = {
    ratingCount: rows.length + (trackCountRes.count ?? 0),
    albumRatingCount: rows.length,
    totalTags: Object.keys(weights).length,
    clusters: clusters.map((c, i) => {
      const sumW = c.tags.reduce((s, t) => s + t.w, 0);
      const sumN = c.tags.reduce((s, t) => s + t.n, 0);
      const p = worldProfiles[i];
      return {
        share: c.share,
        avgScore: sumN > 0 ? Math.round((3 + sumW / sumN) * 100) / 100 : null,
        meanYear: p?.meanYear ?? null,
        sdYears: p?.sdYears ?? null,
        dominantScene: p?.dominantScene ?? null,
        tags: c.tags.slice(0, 8).map((t) => ({
          tag: t.tag,
          display: displayGenre(t.tag),
          avg: t.avg,
          n: Math.round(t.n * 10) / 10,
        })),
      };
    }),
    disliked: Array.from(disliked)
      .slice(0, 6)
      .map((tag) => ({ tag, display: displayGenre(tag) })),
    standings,
    charts: {
      decades,
      scoreDist,
      scenes: sceneTotal > 0 ? { counts: sceneCounts, total: sceneTotal } : null,
      timeline,
      peakMonthIndex: peakCount > 0 ? timeline.findIndex((t) => t.count === peakCount) : null,
    },
    stats: {
      avgScore: r2(avgScore),
      sdScore: r2(sdScore),
      fiveStars,
      meanYear: meanYear != null ? Math.round(meanYear) : null,
      sdYears: r2(sdYears),
      prestigeShare: r2(prestigeShare),
    },
    topAlbum: top?.release_groups
      ? {
          id: top.release_groups.id,
          title: preferHangulName(top.release_groups.title, top.release_groups.native_title),
          artist: preferHangulName(
            top.release_groups.artist_display,
            top.release_groups.artists?.name_native,
          ),
          coverUrl: top.release_groups.cover_url,
          score: display(top)!,
        }
      : null,
  };

  await cacheSet(cacheKey, payload, TTL_SECONDS);
  return NextResponse.json(payload);
}
