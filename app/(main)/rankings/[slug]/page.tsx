import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../lib/supabaseServer';
import RankingVoteWidget, { type LeaderboardEntry } from '../../../../components/RankingVoteWidget';
import Link from 'next/link';

export const revalidate = 30;

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

  // Fetch all votes for this category
  const { data: votes } = await supabase
    .from('ranking_votes')
    .select('release_id')
    .eq('category_id', category.id);

  // Tally votes per release
  const tally = new Map<string, number>();
  for (const v of votes ?? []) {
    tally.set(v.release_id, (tally.get(v.release_id) ?? 0) + 1);
  }

  const sortedEntries = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const totalVotes = sortedEntries.reduce((s, [, c]) => s + c, 0);
  const topIds = sortedEntries.slice(0, 10).map(([id]) => id);

  // Fetch release details for top 10
  let releaseMap = new Map<string, { title: string; artist: string; coverUrl: string | null }>();
  if (topIds.length > 0) {
    const { data: releases } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url')
      .in('id', topIds);
    for (const r of releases ?? []) {
      releaseMap.set(r.id, { title: r.title, artist: r.artist, coverUrl: r.cover_url });
    }
  }

  const leaderboard: LeaderboardEntry[] = sortedEntries
    .slice(0, 10)
    .map(([releaseId, voteCount], i) => {
      const rel = releaseMap.get(releaseId);
      return {
        rank: i + 1,
        releaseId,
        title: rel?.title ?? 'Unknown album',
        artist: rel?.artist ?? '—',
        coverUrl: rel?.coverUrl ?? null,
        voteCount,
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
          {category.description && (
            <p className="text-[15px] text-muted mt-3 max-w-[520px] leading-relaxed">
              {category.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-5">
            <div
              className="text-[22px] font-extrabold text-ink"
              style={{ letterSpacing: '-0.6px' }}
            >
              {totalVotes.toLocaleString()}
            </div>
            <div className="text-[13px] text-muted">
              {totalVotes === 1 ? 'vote cast' : 'votes cast'}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16" style={{ maxWidth: 820 }}>
        <RankingVoteWidget
          categoryId={category.id}
          leaderboard={leaderboard}
          totalVotes={totalVotes}
        />
      </div>
    </div>
  );
}
