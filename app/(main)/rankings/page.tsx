import Link from 'next/link';
import { createServerClient } from '../../../lib/supabaseServer';
import RankingsGrid from '../../../components/RankingsGrid';

export const revalidate = 60;

export default async function RankingsPage() {
  const supabase = createServerClient();

  let categories: { id: string; slug: string; title: string; description: string | null; genre: string | null; year: number | null }[] = [];
  const leaderMap: Record<string, { coverUrl: string | null; title: string; artist: string }> = {};
  const voteCountMap: Record<string, number> = {};

  if (supabase) {
    const [{ data: cats }, { data: votes }] = await Promise.all([
      supabase
        .from('ranking_categories')
        .select('id, slug, title, description, genre, year, sort_order')
        .order('sort_order')
        .order('created_at'),
      supabase.from('ranking_votes').select('category_id, release_id'),
    ]);

    categories = cats ?? [];

    const perCategory = new Map<string, Map<string, number>>();
    for (const v of votes ?? []) {
      if (!perCategory.has(v.category_id)) perCategory.set(v.category_id, new Map());
      const m = perCategory.get(v.category_id)!;
      m.set(v.release_id, (m.get(v.release_id) ?? 0) + 1);
    }

    const topReleaseIds: string[] = [];
    for (const [catId, relMap] of perCategory) {
      const total = [...relMap.values()].reduce((a, b) => a + b, 0);
      voteCountMap[catId] = total;
      const top = [...relMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top) topReleaseIds.push(top);
    }

    if (topReleaseIds.length > 0) {
      const { data: releases } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .in('id', topReleaseIds);

      const releaseById = new Map((releases ?? []).map((r) => [r.id, r]));

      for (const [catId, relMap] of perCategory) {
        const topId = [...relMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!topId) continue;
        const rel = releaseById.get(topId);
        if (rel) leaderMap[catId] = { coverUrl: rel.cover_url, title: rel.title, artist: rel.artist };
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
            className="text-[38px] font-extrabold text-ink leading-[1.06]"
            style={{ letterSpacing: '-1.2px' }}
          >
            Rankings
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            One vote per listener. Community-driven leaderboards across music's best categories.
          </p>
        </div>
      </div>

      {/* Category grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16">
        {categories.length === 0 ? (
          <p className="text-sm text-muted">No ranking categories yet. Run the seed endpoint to get started.</p>
        ) : (
          <RankingsGrid
            categories={categories}
            leaderMap={leaderMap}
            voteCountMap={voteCountMap}
          />
        )}
      </div>
    </div>
  );
}
