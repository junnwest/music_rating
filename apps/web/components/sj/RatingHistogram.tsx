'use client';

import { useLanguage } from '../../lib/i18n';

/**
 * Inline rating-distribution histogram — ten 0.5-wide buckets from 0.5 to 5.0.
 * Single series, so it wears the product accent (no legend needed); bars are
 * thin, rounded at the data end, anchored to a recessive baseline, 2px gaps.
 * Each bar carries its value on hover (native tooltip) and for screen readers.
 */
export default function RatingHistogram({
  dist,
  userBucket = null,
}: {
  /** Counts for buckets 0.5, 1.0, …, 5.0 (length 10). */
  dist: number[];
  /** Bucket index (0–9) of the viewer's own rating, if any. */
  userBucket?: number | null;
}) {
  const { t } = useLanguage();
  const max = Math.max(...dist, 1);

  return (
    <div className="mt-4">
      <p className="text-[10px] font-semibold tracking-[0.05em] uppercase text-muted mb-1.5">
        {t('sj.album.distribution')}
      </p>
      <div
        role="img"
        aria-label={`${t('sj.album.distribution')}: ${dist
          .map((n, i) => `${(i + 1) / 2}★ ${n}`)
          .join(', ')}`}
        className="flex items-end gap-[2px] h-14 border-b border-divider"
      >
        {dist.map((n, i) => {
          const label = ((i + 1) / 2).toFixed(1);
          const isUser = userBucket === i;
          return (
            <div
              key={i}
              title={`${label}★ — ${n}${isUser ? ` · ${t('sj.album.yourRating')}` : ''}`}
              className="group relative flex-1 flex items-end h-full cursor-default"
            >
              <div
                className={`w-full rounded-t-[3px] transition-opacity ${
                  n === 0
                    ? 'h-[2px] bg-divider'
                    : isUser
                      ? 'bg-accent'
                      : 'bg-accent/70 group-hover:bg-accent'
                }`}
                style={n > 0 ? { height: `${Math.max((n / max) * 100, 6)}%` } : undefined}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9.5px] text-muted tabular-nums">
        <span>0.5</span>
        <span>5.0</span>
      </div>
    </div>
  );
}
