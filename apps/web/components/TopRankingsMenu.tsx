'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import RankingsGrid from './RankingsGrid';

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

  const top3 = [...categories]
    .sort((a, b) => (voteCountMap[b.id] ?? 0) - (voteCountMap[a.id] ?? 0))
    .slice(0, 3);

  return (
    <section>
      <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
        {t('rankings.topRankings')}
      </h2>

      <div className="border border-divider rounded-2xl overflow-hidden bg-page">
        {top3.map((cat, i) => {
          const topAlbums = topAlbumsMap[cat.id] ?? [];
          const voteCount = voteCountMap[cat.id] ?? 0;
          const voteLabel = voteCount === 0
            ? t('rankings.noRankingsYet')
            : `${voteCount.toLocaleString()} ${voteCount === 1 ? t('rankings.ranking') : t('rankings.rankingPlural')}`;
          const title = (() => {
            const k = `rankingTitles.${cat.slug}`;
            const r = t(k);
            return r === k ? cat.title : r;
          })();

          return (
            <Link
              key={cat.id}
              href={`/rankings/${cat.slug}`}
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
              <span className="flex-1 text-[14px] font-semibold text-ink min-w-0 truncate group-hover:text-mint-dark transition">
                {title}
              </span>
              <span className="text-[11px] text-muted flex-shrink-0 hidden sm:block">{voteLabel}</span>
            </Link>
          );
        })}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full px-5 py-4 text-[13px] font-medium text-muted hover:text-ink hover:bg-surface transition"
        >
          <span>{expanded ? t('rankings.showLess') : t('rankings.viewAllRankings')}</span>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {expanded && (
        <div className="mt-6">
          <RankingsGrid categories={categories} topAlbumsMap={topAlbumsMap} voteCountMap={voteCountMap} />
        </div>
      )}
    </section>
  );
}
