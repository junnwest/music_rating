import { createServerClient } from '../../../lib/supabaseServer';
import RankingsGrid from '../../../components/RankingsGrid';
import FilterBuilder from '../../../components/FilterBuilder';

export const revalidate = 60;

export default async function RankingsPage() {
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
      supabase.from('user_rankings').select('category_id'),
      supabase.from('ranking_seed_entries').select('category_id, release_id, seed_votes'),
    ]);

    categories = cats ?? [];

    // voteCountMap = unique users who have submitted a ranking per category
    for (const r of rankingRows ?? []) {
      voteCountMap[r.category_id] = (voteCountMap[r.category_id] ?? 0) + 1;
    }

    // Top 5 albums per category from seed entries (pre-launch baseline)
    // When real rankings exist, compute from ranking_entries instead
    const seedByCategory = new Map<string, { release_id: string; seed_votes: number }[]>();
    for (const s of seedEntries ?? []) {
      if (!seedByCategory.has(s.category_id)) seedByCategory.set(s.category_id, []);
      seedByCategory.get(s.category_id)!.push(s);
    }

    const top5PerCategory = new Map<string, string[]>();
    const allTopIds = new Set<string>();

    // For categories with real rankings, use ranking_entries; otherwise use seed
    const categoryIds = categories.map(c => c.id);
    let rankingEntryMap = new Map<string, string[]>(); // catId -> top5 releaseIds from real rankings

    if (categoryIds.length > 0) {
      const catWithRankings = categories.filter(c => (voteCountMap[c.id] ?? 0) > 0).map(c => c.id);
      if (catWithRankings.length > 0) {
        const { data: rankingsByCat } = await supabase
          .from('user_rankings')
          .select('id, category_id')
          .in('category_id', catWithRankings);

        const rankingIdsToCat = new Map((rankingsByCat ?? []).map(r => [r.id, r.category_id]));
        const allRankingIds = (rankingsByCat ?? []).map(r => r.id);

        if (allRankingIds.length > 0) {
          const { data: entryRows } = await supabase
            .from('user_ranking_entries')
            .select('ranking_id, release_id, rank')
            .in('ranking_id', allRankingIds);

          // Compute simple vote count per release per category (rank=1 only, for top-5 display)
          const scoresByCat = new Map<string, Map<string, number>>();
          for (const e of entryRows ?? []) {
            const catId = rankingIdsToCat.get(e.ranking_id);
            if (!catId) continue;
            if (!scoresByCat.has(catId)) scoresByCat.set(catId, new Map());
            const m = scoresByCat.get(catId)!;
            m.set(e.release_id, (m.get(e.release_id) ?? 0) + (e.rank === 1 ? 2 : 1));
          }

          for (const [catId, m] of scoresByCat) {
            const top5 = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
            rankingEntryMap.set(catId, top5);
          }
        }
      }
    }

    for (const cat of categories) {
      const fromRealRankings = rankingEntryMap.get(cat.id);
      const fromSeed = (seedByCategory.get(cat.id) ?? [])
        .sort((a, b) => b.seed_votes - a.seed_votes)
        .slice(0, 5)
        .map(s => s.release_id);

      const top5 = fromRealRankings ?? fromSeed;
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
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            Community
          </p>
          <h1
            className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]"
            style={{ letterSpacing: '-1.2px' }}
          >
            Rankings
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            Build your personal ranking. See where the community stands.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16 flex flex-col gap-14">
        <section>
          <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
            Most Active Rankings
          </h2>
          {categories.length === 0 ? (
            <p className="text-sm text-muted">No ranking categories yet. Run the seed endpoint to get started.</p>
          ) : (
            <RankingsGrid
              categories={categories}
              topAlbumsMap={topAlbumsMap}
              voteCountMap={voteCountMap}
            />
          )}
        </section>

        <FilterBuilder categories={categories} topAlbumsMap={topAlbumsMap} />
      </div>
    </div>
  );
}
