'use client';

import { useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';
import { eloToScore, INSTINCT_REVEAL_THRESHOLD } from '../../lib/elo';
import { formatCount, formatScore, spectrumRing } from '../../lib/sj/display';
import type { ProfileRatingItem } from './ProfileView';

/**
 * Profile → Stats. One card system (`StatCard`), one number format
 * (`formatCount`), and one denominator: every score-derived figure here — the
 * average, the histogram, the per-artist averages — comes from the same
 * `scored` set, so the tab can't quote two different totals for "your ratings".
 *
 * Instinct (elo) ratings only join that set once the reveal threshold is met,
 * which is the same rule the rated list uses to decide whether to show a score.
 */

const BUCKETS = 10; // 0.5-wide buckets across 0.5 … 5.0

/** Bucket centre → x-position (%) inside the plot, for the average marker. */
function scoreToPct(score: number): number {
  const clamped = Math.min(Math.max(score, 0.5), 5);
  return ((clamped * 2 - 0.5) / BUCKETS) * 100;
}

export default function ProfileStats({
  items,
  instinctCount,
}: {
  items: ProfileRatingItem[];
  instinctCount: number;
}) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const revealInstinct = instinctCount >= INSTINCT_REVEAL_THRESHOLD;

    /** Displayable score for one item, under the same reveal rule as the list. */
    const scoreOf = (i: ProfileRatingItem): number | null => {
      if (i.score != null) return i.score;
      if (i.eloScore != null && revealInstinct) return eloToScore(i.eloScore);
      return null;
    };

    const albums = items.filter((i) => !i.isSong);
    const songs = items.filter((i) => i.isSong);

    const scored: number[] = [];
    const dist = Array.from({ length: BUCKETS }, () => 0);
    for (const i of items) {
      const s = scoreOf(i);
      if (s == null) continue;
      scored.push(s);
      const snapped = Math.min(5, Math.max(0.5, Math.round(s * 2) / 2));
      dist[Math.round(snapped * 2) - 1] += 1;
    }
    const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

    // Top artists — albums only, ranked by count, ties broken by average score
    // so two artists with one album each don't order arbitrarily.
    const byArtist = new Map<string, { count: number; sum: number; scored: number }>();
    for (const i of albums) {
      if (!i.releaseArtist) continue;
      const e = byArtist.get(i.releaseArtist) ?? { count: 0, sum: 0, scored: 0 };
      e.count += 1;
      const s = scoreOf(i);
      if (s != null) {
        e.sum += s;
        e.scored += 1;
      }
      byArtist.set(i.releaseArtist, e);
    }
    const topArtists = [...byArtist.entries()]
      .map(([name, e]) => ({
        name,
        count: e.count,
        avg: e.scored ? e.sum / e.scored : null,
      }))
      .sort((a, b) => b.count - a.count || (b.avg ?? 0) - (a.avg ?? 0))
      .slice(0, 8);

    return {
      albums: albums.length,
      songs: songs.length,
      artists: byArtist.size,
      scored,
      dist,
      avg,
      topArtists,
      manualCount: items.filter((i) => i.score != null).length,
      instinctTotal: items.filter((i) => i.score == null && i.eloScore != null).length,
    };
  }, [items, instinctCount]);

  if (items.length === 0) {
    return <p className="py-16 text-center text-[14px] text-muted">{t('sj.profile.noStats')}</p>;
  }

  return (
    <div className="mt-5 space-y-4">
      {/* ── Headline numbers ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiTile value={formatCount(stats.albums)} label={t('sj.profile.filterAlbums')} />
        <KpiTile value={formatCount(stats.songs)} label={t('sj.profile.filterSongs')} />
        <KpiTile value={formatCount(stats.artists)} label={t('sj.profile.statArtists')} />
        <KpiTile
          value={stats.avg != null ? stats.avg.toFixed(2) : '—'}
          label={t('sj.profile.avgScore')}
          dotColor={stats.avg != null ? spectrumRing(stats.avg) : undefined}
        />
      </div>

      {/* ── Score distribution ── */}
      <StatCard
        title={t('sj.artist.scoreDistribution')}
        hint={
          stats.scored.length > 0
            ? t('sj.profile.fromNScored').replace('{n}', formatCount(stats.scored.length))
            : undefined
        }
      >
        {stats.scored.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">{t('sj.profile.noScores')}</p>
        ) : (
          <>
            <Histogram dist={stats.dist} avg={stats.avg} avgLabel={t('sj.profile.avgShort')} />
            {stats.scored.length < 10 && (
              <p className="mt-3 text-[12px] text-muted">{t('sj.profile.lowData')}</p>
            )}
          </>
        )}
      </StatCard>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* ── Top artists ── */}
        {stats.topArtists.length > 0 && (
          <StatCard title={t('sj.profile.topArtists')}>
            <ul className="space-y-2">
              {stats.topArtists.map((a) => (
                <li key={a.name} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{a.name}</span>
                  {a.avg != null && (
                    <span
                      className="hidden sm:inline text-[11.5px] font-semibold tabular-nums"
                      style={{ color: spectrumRing(a.avg) }}
                      title={t('sj.profile.avgScore')}
                    >
                      {formatScore(Math.round(a.avg * 10) / 10)}
                    </span>
                  )}
                  <span className="w-16 sm:w-20 h-1.5 rounded-full bg-divider/60 overflow-hidden shrink-0">
                    <span
                      className="block h-full rounded-full bg-accent/70"
                      style={{ width: `${(a.count / stats.topArtists[0].count) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right text-[12px] font-semibold text-muted tabular-nums">
                    {formatCount(a.count)}
                  </span>
                </li>
              ))}
            </ul>
          </StatCard>
        )}

        {/* ── Manual vs instinct split ── */}
        {stats.manualCount + stats.instinctTotal > 0 && (
          <StatCard title={t('sj.profile.ratingMode')}>
            <SplitBar
              segments={[
                {
                  key: 'manual',
                  value: stats.manualCount,
                  label: t('sj.onboarding.modeManual'),
                  className: 'bg-accent',
                },
                {
                  key: 'instinct',
                  value: stats.instinctTotal,
                  label: t('sj.onboarding.modeInstinct'),
                  className: 'bg-ink/40',
                },
              ]}
            />
          </StatCard>
        )}
      </div>
    </div>
  );
}

// ── Card system ─────────────────────────────────────────────────────────────

function StatCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-divider/70 bg-surface/40 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-3.5">
        <h3 className="text-[11px] font-semibold tracking-[0.05em] uppercase text-muted">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-muted tabular-nums shrink-0">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function KpiTile({
  value,
  label,
  dotColor,
}: {
  value: string;
  label: string;
  dotColor?: string;
}) {
  return (
    <div className="rounded-2xl border border-divider/70 bg-surface/40 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[21px] font-bold text-ink tabular-nums leading-none">
        {dotColor && (
          <span
            aria-hidden
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: dotColor }}
          />
        )}
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-muted truncate">{label}</p>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────

/**
 * Rating-distribution histogram. One series, so no legend — the card title
 * names it. Bars wear the app's score ramp (`spectrumRing`, the same mid-tone
 * used by ScoreBadge), which here is a *sequential* encoding of the x-axis
 * value rather than decoration: bar colour and bar position carry the same
 * fact, so a colourblind reader loses nothing. Counts are labelled selectively
 * — the tallest bucket always, every other bucket on hover.
 */
function Histogram({
  dist,
  avg,
  avgLabel,
}: {
  dist: number[];
  avg: number | null;
  avgLabel: string;
}) {
  const max = Math.max(...dist, 1);

  return (
    <div>
      <div
        role="img"
        aria-label={dist.map((n, i) => `${((i + 1) / 2).toFixed(1)}: ${n}`).join(', ')}
        className="relative flex items-end gap-[3px] h-32 sm:h-40 border-b border-divider"
      >
        {avg != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 border-l border-dashed border-ink/25 pointer-events-none"
            style={{ left: `${scoreToPct(avg)}%` }}
          >
            <span className="absolute -top-0.5 left-1 text-[9.5px] text-muted whitespace-nowrap">
              {avgLabel} {avg.toFixed(1)}
            </span>
          </span>
        )}
        {dist.map((n, i) => {
          const score = (i + 1) / 2;
          const isMax = n === max && n > 0;
          return (
            <div
              key={score}
              title={`${score.toFixed(1)} — ${n}`}
              className="group relative flex-1 flex flex-col justify-end h-full cursor-default"
            >
              <span
                className={`h-3.5 text-center text-[10px] leading-[14px] tabular-nums text-muted transition-opacity ${
                  isMax ? '' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {n > 0 ? n : ''}
              </span>
              {n > 0 ? (
                <span
                  className="w-full rounded-t-[4px] opacity-85 group-hover:opacity-100 transition-opacity"
                  style={{
                    height: `${Math.max((n / max) * 100, 4)}%`,
                    background: spectrumRing(score),
                  }}
                />
              ) : (
                <span className="w-full h-[2px] rounded-t-[1px] bg-divider" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {dist.map((_, i) => {
          const score = (i + 1) / 2;
          return (
            <span key={score} className="flex-1 text-center text-[9.5px] text-muted tabular-nums">
              {Number.isInteger(score) ? score : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Two-segment share bar with a legend — identity is never colour-alone, since
 * each segment is also named and counted below.
 */
function SplitBar({
  segments,
}: {
  segments: { key: string; value: number; label: string; className: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const shown = segments.filter((s) => s.value > 0);

  return (
    <div>
      <div className="flex gap-[2px] h-2.5">
        {shown.map((s, i) => (
          <span
            key={s.key}
            className={`${s.className} h-full ${i === 0 ? 'rounded-l-full' : ''} ${
              i === shown.length - 1 ? 'rounded-r-full' : ''
            }`}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
            <span className={`${s.className} w-2 h-2 rounded-full shrink-0`} aria-hidden />
            <span className="flex-1 text-muted truncate">{s.label}</span>
            <span className="font-semibold text-ink tabular-nums">{formatCount(s.value)}</span>
            <span className="w-10 text-right text-muted tabular-nums">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
