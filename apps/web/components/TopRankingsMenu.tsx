'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

const PAGE_SIZE = 15;

interface Category {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
}

interface Props {
  categories: Category[];
  topAlbumsMap: Record<string, { coverUrl: string | null }[]>;
  voteCountMap: Record<string, number>;
}

export default function TopRankingsMenu({ categories, topAlbumsMap, voteCountMap }: Props) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const sorted = useMemo(
    () => [...categories].sort((a, b) => (voteCountMap[b.id] ?? 0) - (voteCountMap[a.id] ?? 0)),
    [categories, voteCountMap],
  );

  const displayItems = expanded ? sorted.slice(0, visibleCount) : sorted.slice(0, 3);
  const hasMore = expanded && visibleCount < sorted.length;

  function rowTitle(cat: Category) {
    const k = `rankingTitles.${cat.slug}`;
    const r = t(k);
    return r === k ? cat.title : r;
  }

  function voteLabel(count: number) {
    if (count === 0) return t('rankings.noRankingsYet');
    return `${count.toLocaleString()} ${count === 1 ? t('rankings.ranking') : t('rankings.rankingPlural')}`;
  }

  return (
    <section>
      <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
        {t('rankings.topRankings')}
      </h2>

      <div className="border border-divider rounded-2xl overflow-hidden bg-page">
        {displayItems.map((cat, i) => {
          const topAlbums = topAlbumsMap[cat.id] ?? [];
          const count = voteCountMap[cat.id] ?? 0;

          return (
            <div
              key={cat.id}
              className="flex items-center gap-4 px-5 py-4 border-b border-divider hover:bg-surface transition group"
            >
              <span className="text-[15px] font-extrabold text-placeholder w-5 flex-shrink-0 text-center">
                {i + 1}
              </span>

              <div className="flex gap-[3px] flex-shrink-0">
                {Array.from({ length: 3 }).map((_, j) => {
                  const album = topAlbums[j];
                  return album?.coverUrl ? (
                    <img
                      key={j}
                      src={album.coverUrl}
                      alt=""
                      className="w-[30px] h-[30px] rounded-[4px] object-cover border border-divider flex-shrink-0"
                    />
                  ) : (
                    <div
                      key={j}
                      className="w-[30px] h-[30px] rounded-[4px] border border-dashed border-[#DDDDD8] bg-surface flex-shrink-0"
                    />
                  );
                })}
              </div>

              <Link href={`/rankings/${cat.slug}`} className="flex-1 min-w-0">
                <span className="text-[14px] font-semibold text-ink truncate block group-hover:text-mint-dark transition">
                  {rowTitle(cat)}
                </span>
              </Link>

              <span className="text-[11px] text-muted flex-shrink-0 hidden sm:block w-24 text-right">
                {voteLabel(count)}
              </span>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={`/rankings/${cat.slug}/rank`}
                  className="text-[12px] font-medium text-muted hover:text-ink transition whitespace-nowrap"
                >
                  {t('rankings.rank')}
                </Link>
                <Link
                  href={`/rankings/${cat.slug}`}
                  className="text-[12px] font-semibold text-ink border border-[#DDDDD8] rounded-lg px-3 py-1.5 hover:bg-surface transition whitespace-nowrap"
                >
                  {t('rankings.viewRanking')}
                </Link>
              </div>
            </div>
          );
        })}

        {hasMore && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="flex items-center justify-center w-full px-5 py-3.5 text-[13px] font-medium text-muted hover:text-ink hover:bg-surface transition border-b border-divider"
          >
            {t('rankings.loadMore')}
          </button>
        )}

        <button
          onClick={() => {
            setExpanded((e) => !e);
            if (expanded) setVisibleCount(PAGE_SIZE);
          }}
          className="flex items-center justify-between w-full px-5 py-4 text-[13px] font-medium text-muted hover:text-ink hover:bg-surface transition"
        >
          <span>{expanded ? t('rankings.showLess') : t('rankings.viewAllRankings')}</span>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </section>
  );
}
