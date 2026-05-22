import { createServerClient } from '../../../lib/supabaseServer';
import TopRankingsMenu from '../../../components/TopRankingsMenu';
import FilterBuilder from '../../../components/FilterBuilder';
import { getServerT } from '../../../lib/i18n/server';

export const revalidate = 60;

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

export default async function RankingsPage() {
  const t = getServerT();
  const supabase = createServerClient();

  let categories: { id: string; slug: string; title: string; description: string | null; genre: string | null; year: number | null }[] = [];
  const topAlbumsMap: Record<string, { coverUrl: string | null }[]> = {};
  const voteCountMap: Record<string, number> = {};

  if (supabase) {
    const [{ data: cats }, { data: rankingRows }, { data: seedEntries }] = await Promise.all([
      supabase
        .from('ranking_categories')
        .select('id, slug, title, description, genre, year, sort_order')
        .order('sort_order')
        .order('created_at'),
      supabase.from('user_rankings').select('id, category_id'),
      supabase.from('ranking_seed_entries').select('category_id, release_id, seed_votes'),
    ]);

    categories = cats ?? [];

    // voteCountMap = unique users who have submitted a ranking per category
    for (const r of rankingRows ?? []) {
      voteCountMap[r.category_id] = (voteCountMap[r.category_id] ?? 0) + 1;
    }

    // Build combined Silla Scores per category (seed + real rankings, same formula as leaderboard)
    const scoresByCat = new Map<string, Map<string, number>>();

    // Seed votes
    for (const s of seedEntries ?? []) {
      if (!scoresByCat.has(s.category_id)) scoresByCat.set(s.category_id, new Map());
      const m = scoresByCat.get(s.category_id)!;
      m.set(s.release_id, (m.get(s.release_id) ?? 0) + s.seed_votes);
    }

    // Real user ranking entries
    const rankingIdToCatId = new Map((rankingRows ?? []).map(r => [r.id, r.category_id]));
    const allRankingIds = (rankingRows ?? []).map(r => r.id);
    if (allRankingIds.length > 0) {
      const { data: entryRows } = await supabase
        .from('user_ranking_entries')
        .select('ranking_id, release_id, rank')
        .in('ranking_id', allRankingIds);

      // Group entries by category
      const entriesByCat = new Map<string, { ranking_id: string; release_id: string; rank: number }[]>();
      for (const e of entryRows ?? []) {
        const catId = rankingIdToCatId.get(e.ranking_id);
        if (!catId) continue;
        if (!entriesByCat.has(catId)) entriesByCat.set(catId, []);
        entriesByCat.get(catId)!.push(e);
      }

      for (const [catId, entries] of entriesByCat) {
        const silla = computeSillaScores(entries);
        if (!scoresByCat.has(catId)) scoresByCat.set(catId, new Map());
        const m = scoresByCat.get(catId)!;
        for (const [releaseId, score] of silla) {
          m.set(releaseId, (m.get(releaseId) ?? 0) + score);
        }
      }
    }

    const top5PerCategory = new Map<string, string[]>();
    const allTopIds = new Set<string>();

    for (const cat of categories) {
      const m = scoresByCat.get(cat.id) ?? new Map();
      const top5 = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
      top5PerCategory.set(cat.id, top5);
      top5.forEach(id => allTopIds.add(id));
    }

    if (allTopIds.size > 0) {
      const { data: releases } = await supabase
        .from('releases')
        .select('id, cover_url')
        .in('id', [...allTopIds]);

      const coverById = new Map((releases ?? []).map((r) => [r.id, r.cover_url as string | null]));

      for (const [catId, ids] of top5PerCategory) {
        topAlbumsMap[catId] = ids.map((id) => ({ coverUrl: coverById.get(id) ?? null }));
      }
    }
  }

  return (
    <div className="bg-page min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            {t('rankings.community')}
          </p>
          <h1
            className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]"
            style={{ letterSpacing: '-1.2px' }}
          >
            {t('rankings.title')}
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            {t('rankings.subtitle')}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16 flex flex-col gap-14">
        {categories.length === 0 ? (
          <p className="text-sm text-muted">{t('rankings.noCategories')}</p>
        ) : (
          <TopRankingsMenu
            categories={categories}
            topAlbumsMap={topAlbumsMap}
            voteCountMap={voteCountMap}
          />
        )}

        <FilterBuilder categories={categories} topAlbumsMap={topAlbumsMap} />
      </div>
    </div>
  );
}
