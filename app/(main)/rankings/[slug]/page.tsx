import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../lib/supabaseServer';
import RankingVoteWidget, { type LeaderboardEntry } from '../../../../components/RankingVoteWidget';
import Link from 'next/link';

export const revalidate = 30;

function computeSillaScores(
  entries: { ranking_id: string; release_id: string; rank: number }[]
): Map<string, number> {
  const byRanking = new Map<string, { release_id: string; rank: number }[]>();
  for (const e of entries) {
    if (!byRanking.has(e.ranking_id)) byRanking.set(e.ranking_id, []);
    byRanking.get(e.ranking_id)!.push(e);
  }

  const scores = new Map<string, number>();
  for (const userEntries of byRanking.values()) {
    const byRank = new Map<number, string[]>();
    for (const e of userEntries) {
      if (!byRank.has(e.rank)) byRank.set(e.rank, []);
      byRank.get(e.rank)!.push(e.release_id);
    }

    let pos = 1;
    for (const [, albums] of [...byRank.entries()].sort(([a], [b]) => a - b)) {
      const t = albums.length;
      const effectivePos = pos + (t - 1) / 2;
      const score = 1 / effectivePos;
      for (const releaseId of albums) {
        scores.set(releaseId, (scores.get(releaseId) ?? 0) + score);
      }
      pos += t;
    }
  }
  return scores;
}

export default async function RankingCategoryPage({ params }: { params: { slug: string } }) {
  const supabase = createServerClient();
  if (!supabase) notFound();

  // Fetch category
  const { data: category } = await supabase
    .from('ranking_categories')
    .select('id, slug, title, description, genre, year')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!category) notFound();

  // Fetch user rankings + seed entries in parallel
  const [{ data: rankings }, { data: seedEntries }] = await Promise.all([
    supabase.from('user_rankings').select('id').eq('category_id', category.id),
    supabase.from('ranking_seed_entries').select('release_id, seed_votes').eq('category_id', category.id),
  ]);

  // Fetch all entries for this category's rankings
  const rankingIds = (rankings ?? []).map(r => r.id);
  let entries: { ranking_id: string; release_id: string; rank: number }[] = [];
  if (rankingIds.length > 0) {
    const { data } = await supabase
      .from('user_ranking_entries')
      .select('ranking_id, release_id, rank')
      .in('ranking_id', rankingIds);
    entries = data ?? [];
  }

  // Silla Scores from real rankings
  const scores = computeSillaScores(entries);

  // Seed entries contribute rank-1 equivalent (1.0 per seed vote)
  for (const s of seedEntries ?? []) {
    scores.set(s.release_id, (scores.get(s.release_id) ?? 0) + s.seed_votes);
  }

  const totalRankers = rankings?.length ?? 0;
  const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const topIds = sortedEntries.slice(0, 10).map(([id]) => id);
  const maxRawScore = sortedEntries[0]?.[1] ?? 1;

  // Fetch release details + rating stats for top 10 in parallel
  let releaseMap = new Map<string, { title: string; artist: string; coverUrl: string | null }>();
  let avgRatingMap = new Map<string, number>();

  if (topIds.length > 0) {
    const [{ data: releases }, { data: ratingRows }] = await Promise.all([
      supabase.from('releases').select('id, title, artist, cover_url').in('id', topIds),
      supabase.from('ratings').select('release_id, score').in('release_id', topIds),
    ]);
    for (const r of releases ?? []) {
      releaseMap.set(r.id, { title: r.title, artist: r.artist, coverUrl: r.cover_url });
    }
    // Compute avg rating per release
    const ratingAccum = new Map<string, { sum: number; count: number }>();
    for (const r of ratingRows ?? []) {
      const cur = ratingAccum.get(r.release_id) ?? { sum: 0, count: 0 };
      ratingAccum.set(r.release_id, { sum: cur.sum + Number(r.score), count: cur.count + 1 });
    }
    for (const [id, { sum, count }] of ratingAccum) {
      avgRatingMap.set(id, sum / count);
    }
  }

  const leaderboard: LeaderboardEntry[] = sortedEntries
    .slice(0, 10)
    .map(([releaseId, rawScore], i) => {
      const rel = releaseMap.get(releaseId);
      return {
        rank: i + 1,
        releaseId,
        title: rel?.title ?? 'Unknown album',
        artist: rel?.artist ?? '—',
        coverUrl: rel?.coverUrl ?? null,
        sillaScore: (rawScore / maxRawScore) * 100,
        avgRating: avgRatingMap.get(releaseId) ?? null,
      };
    });

  return (
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <Link
            href="/rankings"
            className="text-[12px] font-medium text-muted hover:text-ink transition mb-4 inline-block"
          >
            ← Rankings
          </Link>

          <div className="flex gap-3 flex-wrap mb-3">
            {category.genre && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-[#EBEBEB] text-[11px] font-medium text-muted">
                {category.genre}
              </span>
            )}
            {category.year && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-[#EBEBEB] text-[11px] font-medium text-muted">
                {category.year}
              </span>
            )}
          </div>

          <h1
            className="text-[34px] font-extrabold text-ink leading-[1.08]"
            style={{ letterSpacing: '-1px' }}
          >
            {category.title}
          </h1>

          <div className="flex items-center gap-4 mt-5">
            <div className="flex items-center gap-2">
              <div
                className="text-[22px] font-extrabold text-ink"
                style={{ letterSpacing: '-0.6px' }}
              >
                {totalRankers.toLocaleString()}
              </div>
              <div className="text-[13px] text-muted">
                {totalRankers === 1 ? 'ranking submitted' : 'rankings submitted'}
              </div>
            </div>
            <Link
              href={`/rankings/${category.slug}/rank`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-ink border border-[#EBEBEB] hover:bg-surface transition"
            >
              Build your ranking →
            </Link>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16" style={{ maxWidth: 820 }}>
        <RankingVoteWidget
          categoryId={category.id}
          leaderboard={leaderboard}
          totalRankers={totalRankers}
        />
      </div>
    </div>
  );
}
