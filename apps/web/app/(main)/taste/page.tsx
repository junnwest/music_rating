'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Star, BarChart3, Drama, AudioWaveform } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

const UNLOCK_THRESHOLD = 25;

interface WorldTag {
  display: string;
  avg: number;
  n: number;
}

interface TasteWorld {
  share: number;
  avgScore: number | null;
  tags: WorldTag[];
}

interface TasteReport {
  ratingCount: number;
  albumRatingCount: number;
  totalTags: number;
  type: { code: string; adjectiveKey: string; nounKey: string };
  axes: {
    breadth: { value: number | null; clusterCount: number; topShare: number | null };
    era: { value: number | null; low: number | null; high: number | null; meanYear: number | null; sdYears: number | null };
    reach: { value: number | null; prestigeShare: number | null };
    judgment: { value: number | null; low: number | null; high: number | null; mean: number | null; sd: number | null };
  };
  clusters: TasteWorld[];
  disliked: { tag: string; display: string }[];
  standings: { genre: string; userAvg: number; communityAvg: number; userCount: number }[];
  stats: {
    avgScore: number | null;
    sdScore: number | null;
    fiveStars: number;
    months: number[];
    peakMonthIndex: number | null;
    peakMonthCount: number;
  };
  topAlbum: {
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    score: number;
  } | null;
}

// One color per taste world, used consistently in the composition bar,
// world cards, and legend (accent first, then the app's chart hues).
const WORLD_COLORS = ['#E8A020', '#61adff', '#b98ae8', '#5fbf8a', '#d96161'];

/**
 * Taste — a graphical analysis report of the user's rating history: how the
 * taste splits into worlds (multi-modal, with sub-genre breakdowns), four
 * interpreted dials (with ±1σ ranges where the underlying stat has a spread),
 * headline numbers, and community comparison. Every chart carries a plain-
 * language sentence explaining what the stat says. Locked until 25 ratings.
 */
export default function TastePage() {
  const { userId, ready } = useSession();
  const [report, setReport] = useState<TasteReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !supabase) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase!.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('no session');
        const res = await fetch('/api/taste/profile?refresh=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`taste ${res.status}`);
        const payload: TasteReport = await res.json();
        if (!cancelled) setReport(payload);
      } catch {
        // report unavailable — lock view renders with count 0
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-8 animate-pulse space-y-5">
        <div className="h-40 rounded-2xl bg-surface" />
        <div className="h-64 rounded-2xl bg-surface" />
        <div className="h-40 rounded-2xl bg-surface" />
      </div>
    );
  }

  if (!userId || !report || report.ratingCount < UNLOCK_THRESHOLD) {
    return <LockView ratingCount={report?.ratingCount ?? 0} signedIn={!!userId} />;
  }

  return <ReportView report={report} />;
}

// ── Report ──────────────────────────────────────────────────────────────────

function ReportView({ report }: { report: TasteReport }) {
  const { t, lang } = useLanguage();
  const { axes, stats, clusters } = report;

  const typeName = t('sj.taste.typeName')
    .replace('{adj}', t(`sj.taste.${report.type.adjectiveKey}`))
    .replace('{noun}', t(`sj.taste.${report.type.nounKey}`));

  const worldName = (w: TasteWorld) =>
    w.tags.length > 1 ? `${w.tags[0].display} × ${w.tags[1].display}` : w.tags[0]?.display ?? '';

  // ── per-axis interpretation sentences (rule-based) ──
  const rangeText =
    (axes.breadth.value ?? 0) >= 0.5
      ? t('sj.taste.rangeEclecticText')
          .replace('{n}', String(axes.breadth.clusterCount))
          .replace('{share}', String(Math.round((axes.breadth.topShare ?? 0) * 100)))
      : t('sj.taste.rangeFocusedText')
          .replace('{name}', worldName(clusters[0] ?? { share: 0, avgScore: null, tags: [] }))
          .replace('{share}', String(Math.round((axes.breadth.topShare ?? 1) * 100)));

  const eraText =
    axes.era.meanYear == null
      ? ''
      : ((axes.era.sdYears ?? 0) >= 12 ? t('sj.taste.eraWideText') : t('sj.taste.eraNarrowText'))
          .replace('{year}', String(axes.era.meanYear))
          .replace('{sd}', String(Math.round(axes.era.sdYears ?? 0)));

  const reachText = t('sj.taste.reachText').replace(
    '{pct}',
    String(Math.round((axes.reach.prestigeShare ?? 0) * 100)),
  );

  const scoreText =
    axes.judgment.mean == null
      ? ''
      : ((axes.judgment.sd ?? 0) >= 0.9 ? t('sj.taste.scoreWideText') : t('sj.taste.scoreNarrowText'))
          .replace('{avg}', axes.judgment.mean.toFixed(2))
          .replace('{sd}', (axes.judgment.sd ?? 0).toFixed(2));

  const dials: {
    labelKey: string;
    lowKey: string;
    highKey: string;
    value: number | null;
    low?: number | null;
    high?: number | null;
    text: string;
  }[] = [
    { labelKey: 'sj.taste.axisBreadth', lowKey: 'sj.taste.poleFocused', highKey: 'sj.taste.poleEclectic', value: axes.breadth.value, text: rangeText },
    { labelKey: 'sj.taste.axisEra', lowKey: 'sj.taste.poleTimeless', highKey: 'sj.taste.poleCurrent', value: axes.era.value, low: axes.era.low, high: axes.era.high, text: eraText },
    { labelKey: 'sj.taste.axisReach', lowKey: 'sj.taste.poleUnderground', highKey: 'sj.taste.poleMainstream', value: axes.reach.value, text: reachText },
    { labelKey: 'sj.taste.axisJudgment', lowKey: 'sj.taste.poleSharp', highKey: 'sj.taste.poleWarm', value: axes.judgment.value, low: axes.judgment.low, high: axes.judgment.high, text: scoreText },
  ];

  const compositionText = (
    clusters.length >= 2 ? t('sj.taste.compositionMulti') : t('sj.taste.compositionFocused')
  )
    .replace('{n}', String(clusters.length))
    .replace('{name}', worldName(clusters[0] ?? { share: 0, avgScore: null, tags: [] }))
    .replace('{share}', String(Math.round((clusters[0]?.share ?? 0) * 100)));

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-7 space-y-5">
      {/* ── Header + type ── */}
      <section className="rounded-2xl bg-accent-soft/60 border border-accent/15 px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-accent-deep/70">
              {t('sj.taste.analysisTitle')}
            </p>
            <h1 className="mt-2 text-[24px] font-black text-ink leading-tight">{typeName}</h1>
            <p className="mt-1.5 text-[12.5px] text-muted">
              {t('sj.taste.analysisMeta')
                .replace('{n}', String(report.ratingCount))
                .replace('{g}', String(report.totalTags))
                .replace('{w}', String(clusters.length))}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {report.type.code.split('').map((letter, i) => (
              <span
                key={i}
                className="w-9 h-9 rounded-lg bg-accent text-white text-[17px] font-black flex items-center justify-center"
              >
                {letter}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Composition: the multi-modal split ── */}
      {clusters.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.compositionHeader')}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{compositionText}</p>
          <div className="mt-4 flex h-[14px] rounded-full overflow-hidden">
            {clusters.map((w, i) => (
              <span
                key={i}
                style={{
                  width: `${Math.max(3, w.share * 100)}%`,
                  background: WORLD_COLORS[i % WORLD_COLORS.length],
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {clusters.map((w, i) => (
              <span key={i} className="flex items-center gap-1.5 text-[12px] text-muted">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: WORLD_COLORS[i % WORLD_COLORS.length] }}
                />
                <span className="font-semibold text-ink">{worldName(w)}</span>
                <span className="tabular-nums">{Math.round(w.share * 100)}%</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── World cards: sub-genre breakdowns ── */}
      {clusters.map((world, i) => {
        const color = WORLD_COLORS[i % WORLD_COLORS.length];
        const diff = world.avgScore != null && stats.avgScore != null ? world.avgScore - stats.avgScore : null;
        const diffText =
          diff == null
            ? ''
            : Math.abs(diff) < 0.1
              ? t('sj.taste.worldVsUsualClose')
              : (diff > 0 ? t('sj.taste.worldVsUsualAbove') : t('sj.taste.worldVsUsualBelow')).replace(
                  '{diff}',
                  Math.abs(diff).toFixed(2),
                );
        return (
          <section key={i} className="rounded-2xl bg-surface px-5 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-bold text-ink flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                {worldName(world)}
              </h2>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color }}>
                {t('sj.taste.worldShare').replace('{share}', String(Math.round(world.share * 100)))}
              </span>
            </div>
            {world.avgScore != null && (
              <p className="mt-1 text-[12.5px] text-muted">
                {t('sj.taste.worldAvgLine').replace('{avg}', world.avgScore.toFixed(2))} {diffText}
              </p>
            )}
            <p className="mt-3 text-[10px] font-bold tracking-[0.08em] uppercase text-muted/60">
              {t('sj.taste.subGenres')}
            </p>
            <div className="mt-2 space-y-1.5">
              {world.tags.map((tag) => (
                <div key={tag.display} className="flex items-center gap-2.5">
                  <span className="w-32 shrink-0 text-right text-[11.5px] text-muted truncate">
                    {tag.display}
                  </span>
                  <span className="flex-1 h-[6px] rounded-full bg-divider/60 overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(tag.avg / 5) * 100}%`, background: color }}
                    />
                  </span>
                  <span className="w-8 text-[11.5px] font-bold tabular-nums" style={{ color }}>
                    {tag.avg.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* ── Dials: interpreted axes with ±1σ bands ── */}
      <section className="rounded-2xl bg-surface px-5 py-5">
        <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.axesHeader')}</h2>
        <p className="mt-1 text-[11.5px] text-muted/70">{t('sj.taste.bandCaption')}</p>
        <div className="mt-5 space-y-6">
          {dials.map(({ labelKey, lowKey, highKey, value, low, high, text }) => {
            const v = value ?? 0.5;
            const leansHigh = v >= 0.5;
            return (
              <div key={labelKey}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className={`text-[12px] font-semibold ${!leansHigh ? 'text-accent-deep' : 'text-muted/60'}`}>
                    {t(lowKey)}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-muted/50 font-bold">
                    {t(labelKey)}
                  </span>
                  <span className={`text-[12px] font-semibold ${leansHigh ? 'text-accent-deep' : 'text-muted/60'}`}>
                    {t(highKey)}
                  </span>
                </div>
                <div className="relative h-[7px] rounded-full bg-divider/60">
                  {low != null && high != null && high > low && (
                    <span
                      className="absolute top-0 h-full rounded-full bg-accent/25"
                      style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%` }}
                    />
                  )}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[15px] h-[15px] rounded-full bg-accent border-2 border-page shadow"
                    style={{ left: `${Math.max(4, Math.min(96, v * 100))}%` }}
                  />
                </div>
                {text && <p className="mt-2 text-[12.5px] text-muted">{text}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Numbers: #1 album + stat tiles ── */}
      <section className="rounded-2xl bg-surface px-5 py-5">
        <h2 className="text-[15px] font-bold text-ink mb-4">{t('sj.taste.statsHeader')}</h2>
        <div className="flex flex-col sm:flex-row gap-5">
          {report.topAlbum && (
            <Link
              href={`/album/${report.topAlbum.id}`}
              className="flex sm:flex-col items-center sm:items-start gap-4 sm:gap-2 sm:w-40 shrink-0 group"
            >
              <Cover
                url={report.topAlbum.coverUrl}
                thumb={false}
                className="w-24 h-24 sm:w-40 sm:h-40"
                rounded="rounded-xl"
              />
              <span>
                <span className="block text-[10px] font-black tracking-[0.1em] uppercase text-accent-deep/70">
                  {t('sj.taste.topAlbum')}
                </span>
                <span className="block mt-0.5 text-[13.5px] font-bold text-ink line-clamp-2 group-hover:underline">
                  {report.topAlbum.title}
                </span>
                <span className="block text-[12px] text-muted">{report.topAlbum.artist}</span>
                <span className="block mt-0.5 text-[15px] font-black text-accent-deep">
                  {report.topAlbum.score.toFixed(1)}
                </span>
              </span>
            </Link>
          )}
          <div className="flex-1 grid grid-cols-2 gap-3">
            <StatTile value={String(report.ratingCount)} label={t('sj.taste.statRated')} />
            <StatTile
              value={stats.avgScore != null ? stats.avgScore.toFixed(2) : '—'}
              label={
                stats.sdScore != null
                  ? `${t('sj.taste.statAvg')} (±${stats.sdScore.toFixed(2)})`
                  : t('sj.taste.statAvg')
              }
            />
            <StatTile value={String(stats.fiveStars)} label={t('sj.taste.perfectScores')} />
            <StatTile
              value={stats.peakMonthIndex != null ? monthName(stats.peakMonthIndex, lang) : '—'}
              label={t('sj.taste.statPeak')}
            >
              <div className="flex items-end gap-[2px] h-6 mt-1">
                {stats.months.map((count, i) => {
                  const max = Math.max(1, ...stats.months);
                  const isPeak = i === stats.peakMonthIndex;
                  return (
                    <span
                      key={i}
                      className={`flex-1 rounded-sm ${isPeak ? 'bg-accent' : 'bg-divider'}`}
                      style={{ height: Math.max(2, (count / max) * 24) }}
                    />
                  );
                })}
              </div>
            </StatTile>
          </div>
        </div>
      </section>

      {/* ── Community comparison ── */}
      {report.standings.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink mb-4">{t('sj.taste.standingsHeader')}</h2>
          <div className="space-y-4">
            {report.standings.map((s) => {
              const diff = s.userAvg - s.communityAvg;
              return (
                <div key={s.genre}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[13px] font-bold text-ink">{s.genre}</span>
                    <span
                      className={`text-[11.5px] font-semibold ${diff >= 0 ? 'text-accent-deep' : 'text-muted'}`}
                    >
                      {diff >= 0 ? '↑' : '↓'} {Math.abs(diff).toFixed(2)}{' '}
                      {t(diff >= 0 ? 'sj.taste.aboveAverage' : 'sj.taste.belowAverage')}
                    </span>
                  </div>
                  <CompareBar label={t('sj.taste.you')} value={s.userAvg} accent />
                  <CompareBar label={t('sj.taste.community')} value={s.communityAvg} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Not your thing ── */}
      {report.disliked.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink mb-3">{t('sj.taste.notYourThing')}</h2>
          <div className="flex flex-wrap gap-2">
            {report.disliked.map((d) => (
              <span
                key={d.tag}
                className="px-3 py-1.5 rounded-full bg-divider/50 text-[12.5px] text-muted line-through decoration-muted/50"
              >
                {d.display}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-[11.5px] text-muted/50 pb-6">{t('sj.taste.snapshotEnd')}</p>
    </div>
  );
}

function StatTile({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-page border border-divider/60 px-3.5 py-3">
      <p className="text-[19px] font-black text-ink leading-tight">{value}</p>
      <p className="text-[11px] text-muted mt-0.5">{label}</p>
      {children}
    </div>
  );
}

function CompareBar({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mt-1">
      <span className="w-20 shrink-0 text-right text-[11px] font-semibold text-muted">{label}</span>
      <span className="flex-1 h-[6px] rounded-full bg-divider/60 overflow-hidden">
        <span
          className={`block h-full rounded-full ${accent ? 'bg-accent' : 'bg-muted/40'}`}
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </span>
      <span
        className={`w-9 text-[11.5px] font-bold tabular-nums ${accent ? 'text-accent-deep' : 'text-muted'}`}
      >
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function monthName(index: number, lang: string): string {
  if (lang === 'ko') return `${index + 1}월`;
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index];
}

// ── Lock screen (unchanged) ─────────────────────────────────────────────────

function LockView({ ratingCount, signedIn }: { ratingCount: number; signedIn: boolean }) {
  const { t } = useLanguage();
  const remaining = Math.max(0, UNLOCK_THRESHOLD - ratingCount);
  const teasers = [
    { icon: Star, label: t('sj.taste.teaserTop') },
    { icon: BarChart3, label: t('sj.taste.teaserActivity') },
    { icon: Drama, label: t('sj.taste.teaserStyle') },
    { icon: AudioWaveform, label: t('sj.taste.teaserGenre') },
  ];
  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-14 text-center">
      <Lock size={34} className="text-accent" />
      <h1 className="mt-6 text-[24px] font-bold text-ink whitespace-pre-line">
        {t('sj.taste.lockTitle').replace('{n}', String(remaining))}
      </h1>
      <p className="mt-3 text-[15px] text-muted whitespace-pre-line">{t('sj.taste.lockDesc')}</p>

      <div className="w-full max-w-xs mt-9">
        <div className="h-1.5 rounded-full bg-accent/[0.12] overflow-hidden">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, (ratingCount / UNLOCK_THRESHOLD) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] font-semibold text-muted tabular-nums">
          {t('sj.taste.progress')
            .replace('{n}', String(ratingCount))
            .replace('{total}', String(UNLOCK_THRESHOLD))}
        </p>
      </div>

      <Link
        href={signedIn ? '/search' : '/login'}
        className="mt-6 px-6 py-2.5 rounded-[10px] bg-accent text-white text-[14px] font-semibold hover:opacity-90 transition"
      >
        {signedIn ? t('sj.taste.findReleases') : t('sj.album.signInToRate')}
      </Link>

      <div className="mt-16">
        <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted/60 mb-3">
          {t('sj.taste.comingToYou')}
        </p>
        <div className="flex gap-8">
          {teasers.map(({ icon: Icon, label }) => (
            <span key={label} className="flex flex-col items-center gap-1.5">
              <Icon size={20} className="text-accent/40" />
              <span className="text-[10px] text-muted/70">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
