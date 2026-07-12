import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { eloToScore } from '../../../../lib/elo';
import { displayName } from '../../../../lib/sj/display';
import { displayGenre } from '../../../../lib/taste/embeddings';
import {
  weightsFromRatings,
  buildClusters,
  dislikedTags,
} from '../../../../lib/taste/profile';

// Full taste analysis for the Taste page (2026-07-12 restructure: one report
// page instead of a card reel). Everything is computed here from a single
// ratings fetch — clusters, the MBTI-style type, axes, stats — so the client
// renders one payload. Clustering/vector math stays in Node against the
// bundled embeddings (Micro-instance rule); the only extra DB work vs the old
// version is the genre-standings RPC the page previously called itself.
//
// The user's stored profile row (user_taste_profiles) is still upserted when
// it drifts, since iOS/other consumers read it — but this route derives from
// the ratings directly, which it needs anyway for stats/axes.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 60;
/** Albums released within this many years count toward the "Current" era pole. */
const ERA_YEARS = 10;

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
    artists: { name_native: string | null } | null;
  } | null;
}

// Taste-type letters, one per axis (value ≥ 0.5 → first letter):
//   breadth    E Eclectic   / F Focused
//   era        N Current    / T Timeless
//   reach      M Mainstream / U Underground
//   judgment   W Warm       / S Sharp
// The display name composes an adjective (judgment × breadth) and a noun
// (reach × era) — 8 i18n strings cover all 16 types.
function typeFromAxes(axes: Record<string, number>): {
  code: string;
  adjectiveKey: string;
  nounKey: string;
} {
  const breadth = axes.breadth >= 0.5 ? 'E' : 'F';
  const era = axes.era >= 0.5 ? 'N' : 'T';
  const reach = axes.reach >= 0.5 ? 'M' : 'U';
  const judgment = axes.judgment >= 0.5 ? 'W' : 'S';
  return {
    code: `${breadth}${era}${reach}${judgment}`,
    adjectiveKey: `adj${judgment}${breadth}`, // adjWE | adjSE | adjWF | adjSF
    nounKey: `noun${reach}${era}`, //            nounMN | nounUN | nounMT | nounUT
  };
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-profile', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const cacheKey = `taste:profile:v2:${userId}`;
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
        'score, elo_score, created_at, release_groups(id, title, artist_display, cover_url, native_title, genres, first_release_date, prestige_score, artists!release_groups_primary_artist_id_fkey(name_native))',
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
  const { error: upsertErr } = await supabase.from('user_taste_profiles').upsert({
    user_id: userId,
    genre_weights: weights,
    rating_count: rows.length,
    updated_at: new Date().toISOString(),
  });
  if (upsertErr) console.error('[taste] profile upsert error:', upsertErr.message);

  // ── stats ──
  const avgScore =
    scored.length > 0
      ? scored.reduce((s, r) => s + (display(r) ?? 0), 0) / scored.length
      : null;
  const fiveStars = scored.filter((r) => (display(r) ?? 0) >= 5).length;
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of rows) months[new Date(r.created_at).getMonth()] += 1;
  const peakCount = Math.max(...months);

  const top = scored.reduce<RatingRow | null>(
    (best, r) => (best == null || (display(r) ?? 0) > (display(best) ?? 0) ? r : best),
    null,
  );

  // ── axes (each 0..1; ≥ 0.5 leans toward the first-listed pole) ──
  // breadth: how evenly taste spreads across worlds (1 − dominant share).
  const breadth = clusters.length >= 2 ? 1 - clusters[0].share : 0.25;
  // era: share of rated albums released in the last ERA_YEARS years.
  const cutoffYear = new Date().getFullYear() - ERA_YEARS;
  const dated = rows.filter((r) => r.release_groups!.first_release_date);
  const era =
    dated.length > 0
      ? dated.filter(
          (r) => parseInt(r.release_groups!.first_release_date!.slice(0, 4), 10) >= cutoffYear,
        ).length / dated.length
      : 0.5;
  // reach: share of rated albums in the prestige canon (proxy for mainstream/
  // canonical listening — prestige covers curated canon lists, ~1.6k rows).
  const reach =
    rows.length > 0
      ? Math.min(1, (rows.filter((r) => r.release_groups!.prestige_score != null).length / rows.length) * 2)
      : 0.5;
  // judgment: warmth of scoring — 2.5★ avg → 0, 4.5★ avg → 1.
  const judgment =
    avgScore != null ? Math.max(0, Math.min(1, (avgScore - 2.5) / 2)) : 0.5;

  const axes = { breadth, era, reach, judgment };
  const type = typeFromAxes(axes);

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
    type,
    axes: Object.fromEntries(
      Object.entries(axes).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    clusters: clusters.map((c) => {
      const sumW = c.tags.reduce((s, t) => s + t.w, 0);
      const sumN = c.tags.reduce((s, t) => s + t.n, 0);
      return {
        share: c.share,
        avgScore: sumN > 0 ? Math.round((3 + sumW / sumN) * 100) / 100 : null,
        ratingCount: Math.max(...c.tags.map((t) => t.n)),
        tags: c.tags.slice(0, 5).map((t) => ({
          tag: t.tag,
          display: displayGenre(t.tag),
          avg: t.avg,
          n: t.n,
        })),
      };
    }),
    disliked: Array.from(disliked)
      .slice(0, 6)
      .map((tag) => ({ tag, display: displayGenre(tag) })),
    standings,
    stats: {
      avgScore: avgScore != null ? Math.round(avgScore * 100) / 100 : null,
      fiveStars,
      months,
      peakMonthIndex: peakCount > 0 ? months.indexOf(peakCount) : null,
      peakMonthCount: peakCount,
    },
    topAlbum: top?.release_groups
      ? {
          id: top.release_groups.id,
          title: displayName(top.release_groups.title, top.release_groups.native_title),
          artist: displayName(
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
