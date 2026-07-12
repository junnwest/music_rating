import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { displayGenre } from '../../../../lib/taste/embeddings';
import {
  weightsFromRatings,
  buildClusters,
  dislikedTags,
  type GenreWeights,
} from '../../../../lib/taste/profile';

// Taste page data: the user's genre clusters ("taste worlds") derived from
// user_taste_profiles.genre_weights (trigger-maintained) + the bundled genre
// embeddings. All clustering happens here in Node — the DB read is a single
// PK lookup. Self-heals: if rating_count disagrees with the actual ratings
// table (e.g. ratings written while the trigger misfired), the profile is
// recomputed from scratch and upserted.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 60;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-profile', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // The Taste page passes refresh=1 so a just-rated album is reflected
  // immediately; the cached copy serves any other consumer.
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const cacheKey = `taste:profile:v1:${userId}`;
  if (!refresh) {
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [profileRes, countRes] = await Promise.all([
    supabase
      .from('user_taste_profiles')
      .select('genre_weights, rating_count')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('ratings').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  if (profileRes.error) {
    console.error('[taste] profile query error:', profileRes.error.message);
    return NextResponse.json({ error: profileRes.error.message }, { status: 503 });
  }

  const actualCount = countRes.count ?? 0;
  let weights =
    (profileRes.data?.genre_weights as GenreWeights | undefined) ?? ({} as GenreWeights);

  // Self-heal on drift (or first sight of a user the backfill missed).
  if (!profileRes.data || profileRes.data.rating_count !== actualCount) {
    const { data: rows, error } = await supabase
      .from('ratings')
      .select('score, elo_score, release_groups(genres)')
      .eq('user_id', userId)
      .limit(500);
    if (!error && rows) {
      weights = weightsFromRatings(
        (rows as unknown as { score: number | null; elo_score: number | null; release_groups: { genres: string[] | null } | null }[]).map(
          (r) => ({ score: r.score, elo_score: r.elo_score, genres: r.release_groups?.genres ?? null }),
        ),
      );
      await supabase.from('user_taste_profiles').upsert({
        user_id: userId,
        genre_weights: weights,
        rating_count: actualCount,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const clusters = buildClusters(weights);
  const disliked = dislikedTags(weights);

  const payload = {
    ratingCount: actualCount,
    totalTags: Object.keys(weights).length,
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
  };

  await cacheSet(cacheKey, payload, TTL_SECONDS);
  return NextResponse.json(payload);
}
