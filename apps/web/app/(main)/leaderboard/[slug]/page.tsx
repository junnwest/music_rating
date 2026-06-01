import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../lib/supabaseServer';
import RankingVoteWidget, { type LeaderboardEntry } from '../../../../components/RankingVoteWidget';
import FilterBuilder from '../../../../components/FilterBuilder';
import Link from 'next/link';
import { getServerT } from '../../../../lib/i18n/server';
import { cacheGet, cacheSet } from '../../../../lib/cache';

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

const PAGE_SIZE = 10;

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 10) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 6) {
    return [...Array.from({ length: 8 }, (_, i) => i + 1), '...', total];
  }
  if (current >= total - 5) {
    return [1, '...', ...Array.from({ length: 8 }, (_, i) => total - 7 + i)];
  }
  return [1, '...', current - 2, current - 1, current, current + 1, current + 2, '...', total];
}

export default async function LeaderboardCategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { page?: string };
}) {
  const t = getServerT();
  const supabase = createServerClient();
  if (!supabase) notFound();

  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10));

  const { data: category } = await supabase
    .from('ranking_categories')
    .select('id, slug, title, description, genre, year')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!category) notFound();

  type ScoreCache = { totalRankers: number; sortedEntries: [string, number][] };
  const cacheKey = `sj:ranking:scores:v2:${category.id}`;
  const CACHE_TTL = 5 * 60;

  let totalRankers: number;
  let sortedEntries: [string, number][];

  const cached = await cacheGet<ScoreCache>(cacheKey);
  if (cached) {
    totalRankers = cached.totalRankers;
    sortedEntries = cached.sortedEntries;
  } else {
    const [{ data: rankings }, { data: seedEntries }] = await Promise.all([
      supabase.from('user_rankings').select('id').eq('category_id', category.id),
      supabase.from('ranking_seed_entries').select('release_id, seed_votes').eq('category_id', category.id),
    ]);

    const rankingIds = (rankings ?? []).map(r => r.id);
    let entries: { ranking_id: string; release_id: string; rank: number }[] = [];
    if (rankingIds.length > 0) {
      const { data } = await supabase
        .from('user_ranking_entries')
        .select('ranking_id, release_id, rank')
        .in('ranking_id', rankingIds);
      entries = data ?? [];
    }

    const rawRankScores = computeSillaScores(entries);

    for (const s of seedEntries ?? []) {
      rawRankScores.set(s.release_id, (rawRankScores.get(s.release_id) ?? 0) + s.seed_votes);
    }

    const releaseIds = [...rawRankScores.keys()];
    const { data: bayesianRows } = await supabase.rpc('get_calibrated_bayesian_scores', {
      release_ids: releaseIds,
    });
    const bayesianMap = new Map<string, number>(
      (bayesianRows ?? []).map((r: any) => [r.release_id as string, r.bayesian_score as number]),
    );

    const maxRaw = Math.max(...rawRankScores.values(), 1);
    const PRIOR = 2.75;

    const combined = new Map<string, number>();
    for (const id of releaseIds) {
      const rankScore = (rawRankScores.get(id) ?? 0) / maxRaw;
      const bayes    = bayesianMap.get(id) ?? PRIOR;
      const ratingScore = Math.max(0, Math.min(1, (bayes - 0.5) / 4.5));
      combined.set(id, 0.55 * ratingScore + 0.45 * rankScore);
    }

    totalRankers = rankings?.length ?? 0;
    sortedEntries = [...combined.entries()].sort((a, b) => b[1] - a[1]);

    cacheSet(cacheKey, { totalRankers, sortedEntries }, CACHE_TTL).catch(() => {});
  }

  const totalAlbums = sortedEntries.length;
  const totalPages = Math.ceil(totalAlbums / PAGE_SIZE);
  const currentPage = Math.min(page, totalPages || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageIds = sortedEntries.slice(offset, offset + PAGE_SIZE).map(([id]) => id);
  const maxRawScore = sortedEntries[0]?.[1] ?? 1;

  let releaseMap = new Map<string, { title: string; artist: string; coverUrl: string | null }>();
  let avgRatingMap = new Map<string, number>();

  if (pageIds.length > 0) {
    const [{ data: releases }, { data: ratingRows }] = await Promise.all([
      supabase.from('releases').select('id, title, artist, cover_url').in('id', pageIds),
      supabase.from('ratings').select('release_id, score').in('release_id', pageIds),
    ]);
    for (const r of releases ?? []) {
      releaseMap.set(r.id, { title: r.title, artist: r.artist, coverUrl: r.cover_url });
    }
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
    .slice(offset, offset + PAGE_SIZE)
    .map(([releaseId, rawScore], i) => {
      const rel = releaseMap.get(releaseId);
      return {
        rank: offset + i + 1,
        releaseId,
        title: rel?.title ?? 'Unknown album',
        artist: rel?.artist ?? '—',
        coverUrl: rel?.coverUrl ?? null,
        sillaScore: (rawScore / maxRawScore) * 100,
        avgRating: avgRatingMap.get(releaseId) ?? null,
      };
    });

  const { data: otherCats } = await supabase
    .from('ranking_categories')
    .select('id, slug, title, description, genre, year')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .neq('slug', params.slug)
    .limit(20);

  const allCatIds = [category.id, ...(otherCats ?? []).map((c) => c.id)];
  const topAlbumsMap: Record<string, { coverUrl: string | null }[]> = {};
  if (allCatIds.length > 0) {
    const { data: seedRows } = await supabase
      .from('ranking_seed_entries')
      .select('category_id, release_id, seed_votes')
      .in('category_id', allCatIds)
      .order('seed_votes', { ascending: false });

    const seedByCat = new Map<string, string[]>();
    for (const s of seedRows ?? []) {
      if (!seedByCat.has(s.category_id)) seedByCat.set(s.category_id, []);
      const arr = seedByCat.get(s.category_id)!;
      if (arr.length < 5) arr.push(s.release_id);
    }

    const allSeedIds = [...new Set([...seedByCat.values()].flat())];
    if (allSeedIds.length > 0) {
      const { data: seedReleases } = await supabase
        .from('releases')
        .select('id, cover_url')
        .in('id', allSeedIds);
      const coverById = new Map((seedReleases ?? []).map((r) => [r.id, r.cover_url as string | null]));
      for (const [catId, ids] of seedByCat) {
        topAlbumsMap[catId] = ids.map((id) => ({ coverUrl: coverById.get(id) ?? null }));
      }
    }
  }

  const allCategories = [
    { id: category.id, slug: category.slug, title: category.title, description: category.description, genre: category.genre, year: category.year },
    ...(otherCats ?? []),
  ];

  return (
    <div className="bg-page min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <div className="flex gap-3 flex-wrap mb-3">
            {category.genre && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-page border border-divider text-[11px] font-medium text-muted">
                {category.genre}
              </span>
            )}
            {category.year && (
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-page border border-divider text-[11px] font-medium text-muted">
                {category.year}
              </span>
            )}
          </div>

          <h1
            className="text-[34px] font-extrabold text-ink leading-[1.08]"
            style={{ letterSpacing: '-1px' }}
          >
            {(() => { const k = `rankingTitles.${category.slug}`; const r = t(k); return r === k ? category.title : r; })()}
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
                {totalRankers === 1 ? 'tierlist submitted' : 'tierlists submitted'}
              </div>
            </div>
            <Link
              href={`/leaderboard/${category.slug}/rank`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-ink border border-divider hover:bg-surface transition"
            >
              Build your tierlist →
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 mt-10">
            <div className="flex items-center gap-1">
              {currentPage > 1 ? (
                <Link
                  href={`/leaderboard/${category.slug}?page=${currentPage - 1}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[13px] text-muted hover:text-ink border border-divider hover:bg-surface transition"
                >
                  ←
                </Link>
              ) : (
                <span className="w-8 h-8 flex items-center justify-center text-[13px] text-[#DDDDD8]">←</span>
              )}

              {getPageNumbers(currentPage, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-[12px] text-muted">…</span>
                ) : (
                  <Link
                    key={p}
                    href={`/leaderboard/${category.slug}?page=${p}`}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-[12px] font-semibold transition ${
                      p === currentPage
                        ? 'bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111]'
                        : 'text-muted hover:text-ink border border-divider hover:bg-surface'
                    }`}
                  >
                    {p}
                  </Link>
                )
              )}

              {currentPage < totalPages ? (
                <Link
                  href={`/leaderboard/${category.slug}?page=${currentPage + 1}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[13px] text-muted hover:text-ink border border-divider hover:bg-surface transition"
                >
                  →
                </Link>
              ) : (
                <span className="w-8 h-8 flex items-center justify-center text-[13px] text-[#DDDDD8]">→</span>
              )}
            </div>

            <form method="GET" action={`/leaderboard/${category.slug}`} className="flex items-center gap-2">
              <label className="text-[11px] text-muted whitespace-nowrap">Go to page</label>
              <input
                type="number"
                name="page"
                min={1}
                max={totalPages}
                defaultValue={currentPage}
                className="w-14 h-8 px-2 text-[12px] text-ink border border-divider rounded-lg text-center focus:outline-none focus:border-ink transition"
              />
              <button
                type="submit"
                className="h-8 px-3 text-[12px] font-semibold text-ink border border-divider rounded-lg hover:bg-surface transition"
              >
                Go
              </button>
            </form>
          </div>
        )}

        {/* Other Leaderboards */}
        {(otherCats ?? []).length > 0 && (
          <div className="mt-14 pt-10 border-t border-divider">
            <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
              More Leaderboards
            </h2>
            <div className="flex flex-col gap-2">
              {(otherCats ?? []).map((cat) => {
                const thumbs = topAlbumsMap[cat.id] ?? [];
                return (
                  <div key={cat.id} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-divider hover:bg-surface transition group">
                    <div className="flex gap-[4px] flex-shrink-0">
                      {Array.from({ length: 5 }).map((_, j) => {
                        const album = thumbs[j];
                        return album?.coverUrl ? (
                          <img
                            key={j}
                            src={album.coverUrl}
                            alt=""
                            className="w-[36px] h-[36px] rounded-[4px] object-cover border border-divider flex-shrink-0"
                          />
                        ) : (
                          <div
                            key={j}
                            className="w-[36px] h-[36px] rounded-[4px] border border-dashed border-[#DDDDD8] bg-surface flex-shrink-0"
                          />
                        );
                      })}
                    </div>
                    <span className="flex-1 text-[14px] font-semibold text-ink group-hover:text-mint-dark transition truncate">
                      {cat.title}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link href={`/leaderboard/${cat.slug}/rank`} className="text-[12px] font-medium text-muted hover:text-ink transition whitespace-nowrap">
                        Rank →
                      </Link>
                      <Link
                        href={`/leaderboard/${cat.slug}`}
                        className="text-[12px] font-semibold text-ink border border-[#DDDDD8] rounded-lg px-3 py-1.5 hover:bg-surface transition whitespace-nowrap"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Browse by filter */}
        <div className="mt-14">
          <FilterBuilder categories={allCategories} topAlbumsMap={topAlbumsMap} />
        </div>
      </div>
    </div>
  );
}
