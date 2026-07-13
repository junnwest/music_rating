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
  clusterProfiles,
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
  const cacheKey = `taste:profile:v3:${userId}`;
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

  // ── stats (means + population std devs — the report shows ±1σ bands) ──
  const scores = scored.map((r) => display(r)!);
  const avgScore = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
  const sdScore =
    avgScore != null && scores.length > 1
      ? Math.sqrt(scores.reduce((s, x) => s + (x - avgScore) ** 2, 0) / scores.length)
      : null;
  const fiveStars = scores.filter((x) => x >= 5).length;
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of rows) months[new Date(r.created_at).getMonth()] += 1;
  const peakCount = Math.max(...months);

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

  const clamp = (x: number) => Math.max(0, Math.min(1, x));

  // ── axes (each value 0..1; ≥ 0.5 leans toward the first-listed pole).
  // era and judgment carry a ±1σ band (low/high) — breadth and reach are
  // share-based, where a std dev isn't meaningful.
  // breadth: how evenly taste spreads across worlds (1 − dominant share).
  const breadthValue = clusters.length >= 2 ? 1 - clusters[0].share : 0.25;
  // era: mean release year on a 50-year window ending now (0.5 = 25y ago).
  const nowYear = new Date().getFullYear();
  const eraValue = meanYear != null ? clamp((meanYear - (nowYear - 50)) / 50) : 0.5;
  const eraLow = meanYear != null && sdYears != null ? clamp((meanYear - sdYears - (nowYear - 50)) / 50) : null;
  const eraHigh = meanYear != null && sdYears != null ? clamp((meanYear + sdYears - (nowYear - 50)) / 50) : null;
  // reach: share of rated albums in the prestige canon (proxy for mainstream/
  // canonical listening — prestige covers curated canon lists, ~1.6k rows).
  const prestigeShare =
    rows.length > 0
      ? rows.filter((r) => r.release_groups!.prestige_score != null).length / rows.length
      : 0;
  const reachValue = rows.length > 0 ? Math.min(1, prestigeShare * 2) : 0.5;
  // judgment: warmth of scoring — 2.5★ avg → 0, 4.5★ avg → 1; band = ±1σ.
  const judgmentValue = avgScore != null ? clamp((avgScore - 2.5) / 2) : 0.5;
  const judgmentLow = avgScore != null && sdScore != null ? clamp((avgScore - sdScore - 2.5) / 2) : null;
  const judgmentHigh = avgScore != null && sdScore != null ? clamp((avgScore + sdScore - 2.5) / 2) : null;

  const type = typeFromAxes({
    breadth: breadthValue,
    era: eraValue,
    reach: reachValue,
    judgment: judgmentValue,
  });

  const r2 = (x: number | null) => (x != null ? Math.round(x * 100) / 100 : null);
  const axes = {
    breadth: { value: r2(breadthValue), clusterCount: clusters.length, topShare: r2(clusters[0]?.share ?? 1) },
    era: { value: r2(eraValue), low: r2(eraLow), high: r2(eraHigh), meanYear: meanYear != null ? Math.round(meanYear) : null, sdYears: r2(sdYears) },
    reach: { value: r2(reachValue), prestigeShare: r2(prestigeShare) },
    judgment: { value: r2(judgmentValue), low: r2(judgmentLow), high: r2(judgmentHigh), mean: r2(avgScore), sd: r2(sdScore) },
  };

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
    axes,
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
    stats: {
      avgScore: r2(avgScore),
      sdScore: r2(sdScore),
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
