'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Lock, Star, BarChart3, Drama, AudioWaveform, RotateCw } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import { useSession } from '../../../components/sj/SessionContext';
import { SkeletonBlock, SkeletonLine, FlowerSpinner } from '../../../components/sj/Loading';
import TasteGraph, {
  type TasteGraphData,
  type TasteGraphWorld,
} from '../../../components/sj/TasteGraph';
import {
  TASTE_MOTION_CSS,
  Reveal,
  CountUp,
  YearChart,
  ScoreChart,
  SceneBar,
  CanonGauge,
  DumbbellAxis,
  DumbbellRow,
  ActivitySpark,
} from '../../../components/sj/TasteCharts';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { spectrumColor, spectrumFill, spectrumNumber } from '../../../lib/sj/display';

const UNLOCK_THRESHOLD = 25;

type Scene = 'kr' | 'jp' | 'west' | 'other';

interface WorldTag {
  display: string;
  avg: number;
  n: number;
}

interface TasteWorld {
  share: number;
  avgScore: number | null;
  meanYear: number | null;
  sdYears: number | null;
  dominantScene: Scene | null;
  tags: WorldTag[];
}

interface TasteReport {
  ratingCount: number;
  albumRatingCount: number;
  totalTags: number;
  clusters: TasteWorld[];
  disliked: { tag: string; display: string }[];
  standings: { genre: string; userAvg: number; communityAvg: number; userCount: number }[];
  graph?: TasteGraphData;
  charts: {
    decades: { decade: number; count: number }[];
    years?: { year: number; above: number; below: number }[];
    scoreDist: number[];
    scenes: { counts: Record<Scene, number>; total: number } | null;
    timeline: { month: string; count: number }[];
    peakMonthIndex: number | null;
  };
  stats: {
    avgScore: number | null;
    sdScore: number | null;
    fiveStars: number;
    perfectRate: number | null;
    median: number | null;
    skew: number | null;
    effectiveGenres: number | null;
    communityDelta: number | null;
    meanYear: number | null;
    sdYears: number | null;
    prestigeShare: number | null;
  };
  topScore: number | null;
  topAlbums: TopAlbum[];
  topAlbum: TopAlbum | null;
}

interface TopAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  score: number;
}

// Categorical series slots for scenes — a fixed-order palette validated (CVD
// separation, lightness band, contrast) against both app surfaces; light/dark
// steps swap via the .taste-report CSS vars below. Identity never rides on
// color alone: every use is paired with a named legend or a direct label.
// (The taste map uses the score ramp instead — magnitude, not identity.)
const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)'];
// --tr-up / --tr-dn drive the diverging "stock" year chart: blue where a year's
// mean rating sits above your overall average, red where it falls below.
const VIZ_VARS = `
.taste-report{--viz-1:#2a78d6;--viz-2:#1baf7a;--viz-3:#eda100;--viz-4:#008300;--viz-5:#4a3aa7;--tr-up:#2a78d6;--tr-dn:#d8433d;}
.dark .taste-report{--viz-1:#3987e5;--viz-2:#199e70;--viz-3:#c98500;--viz-4:#008300;--viz-5:#9085e9;--tr-up:#4a92ea;--tr-dn:#ef655d;}
`;
/** Scenes keep fixed slots (color follows the entity, not its rank). */
const SCENE_ORDER: Scene[] = ['kr', 'jp', 'west', 'other'];
const SCENE_KEYS: Record<Scene, string> = {
  kr: 'sj.taste.sceneKr',
  jp: 'sj.taste.sceneJp',
  west: 'sj.taste.sceneWest',
  other: 'sj.taste.sceneOther',
};

/**
 * Taste — an editorial, scroll-revealed analysis report of the user's rating
 * history (2026-08-10 visual rebuild). Opens on a hero whose aurora gradient is
 * mixed from the user's own world colors, then numbered sections: the
 * interactive taste map, headline numbers + 12-month activity, release-year
 * histogram with a "your era" band, ramp-colored score distribution, scene mix,
 * canon-reach gauge, and community dumbbells with real tooltips throughout.
 * Locked until 25 ratings.
 *
 * The report is served cached (60s) by `/api/taste/profile`; the **Refresh**
 * control is the only path that passes `?refresh=1`. Do not reintroduce a
 * refresh on every load — that cache-bypass was removed on 2026-07-15 for
 * burning Vercel CPU.
 */
export default function TastePage() {
  const { userId, ready } = useSession();
  const [report, setReport] = useState<TasteReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('no session');
    const res = await fetch(`/api/taste/profile${refresh ? '?refresh=1' : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`taste ${res.status}`);
    return (await res.json()) as TasteReport;
  }, []);

  useEffect(() => {
    if (!ready || !supabase) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const payload = await load(false);
        if (!cancelled && payload) setReport(payload);
      } catch {
        // report unavailable — lock view renders with count 0
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await load(true);
      if (payload) setReport(payload);
    } catch {
      // keep the report we already have rather than blanking the page
    }
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 space-y-6">
        <div className="rounded-3xl bg-accent-soft/60 border border-accent/15 px-8 py-10 space-y-3">
          <SkeletonLine w="w-24" h="h-2.5" />
          <SkeletonLine w="w-3/5" h="h-8" />
          <SkeletonLine w="w-2/5" h="h-3" />
          <div className="flex gap-10 pt-4">
            <SkeletonLine w="w-16" h="h-7" />
            <SkeletonLine w="w-16" h="h-7" />
            <SkeletonLine w="w-16" h="h-7" />
          </div>
        </div>
        <SkeletonBlock className="h-96" />
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-48" />
      </div>
    );
  }

  if (!userId || !report || report.ratingCount < UNLOCK_THRESHOLD) {
    return <LockView ratingCount={report?.ratingCount ?? 0} signedIn={!!userId} />;
  }

  return <ReportView report={report} onRefresh={refresh} refreshing={refreshing} />;
}

// ── Report ──────────────────────────────────────────────────────────────────

function ReportView({
  report,
  onRefresh,
  refreshing,
}: {
  report: TasteReport;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t, lang } = useLanguage();
  const { stats, clusters, charts } = report;

  const headline =
    clusters.length >= 2
      ? t('sj.taste.worldsTitle').replace('{n}', String(clusters.length))
      : t('sj.taste.worldsTitleOne');

  // ── taste map ──
  // The graph's worlds carry the era/scene sentence the old world cards showed;
  // clusters and graph.worlds are built from the same array server-side, so the
  // indexes line up.
  const graph: TasteGraphData | null =
    report.graph && report.graph.worlds.length > 0
      ? {
          ...report.graph,
          worlds: report.graph.worlds.map(
            (w, i): TasteGraphWorld => ({ ...w, note: clusters[i] ? worldNote(clusters[i], t) : null }),
          ),
        }
      : null;

  // Hero aurora — radial washes mixed from the user's three biggest worlds'
  // ramp colors, one layer per theme (the ramp needs different lightness on
  // each surface, and CSS vars can't carry a JS-computed OKLCh pair).
  const auroraWorlds = (report.graph?.worlds ?? []).slice(0, 3);
  const AURORA_POS = ['14% 16%', '86% 8%', '68% 96%'];
  const aurora = (lightness: number) =>
    auroraWorlds
      .map(
        (w, i) =>
          `radial-gradient(52% 72% at ${AURORA_POS[i]}, color-mix(in srgb, ${spectrumColor(
            w.avg ?? 3,
            lightness,
            0.65,
          )} 52%, transparent), transparent 70%)`,
      )
      .join(', ');

  // ── release years ──
  const years = charts.years ?? [];
  const eraText =
    stats.meanYear == null
      ? ''
      : ((stats.sdYears ?? 0) >= 12 ? t('sj.taste.eraWideText') : t('sj.taste.eraNarrowText'))
          .replace('{year}', String(stats.meanYear))
          .replace('{sd}', String(Math.round(stats.sdYears ?? 0)));

  // ── score distribution ──
  const scoreDist = charts.scoreDist;
  const scoreTotal = scoreDist.reduce((s, x) => s + x, 0);
  const scoreText =
    stats.avgScore == null
      ? ''
      : ((stats.sdScore ?? 0) >= 0.9 ? t('sj.taste.scoreWideText') : t('sj.taste.scoreNarrowText'))
          .replace('{avg}', stats.avgScore.toFixed(2))
          .replace('{sd}', (stats.sdScore ?? 0).toFixed(2));

  // ── scene mix ──
  const scenes = charts.scenes;
  const sceneShares = scenes
    ? SCENE_ORDER.map((s, i) => ({
        scene: s,
        share: scenes.counts[s] / scenes.total,
        color: SERIES[i],
      })).filter((s) => s.share > 0)
    : [];
  const sceneLead = sceneShares.length > 0 ? sceneShares.reduce((a, b) => (b.share > a.share ? b : a)) : null;

  const reachText = t('sj.taste.reachText').replace(
    '{pct}',
    String(Math.round((stats.prestigeShare ?? 0) * 100)),
  );

  // Sorted by how far the user diverges above the community — the story the
  // section is telling — not by the RPC's row order.
  const standings = useMemo(
    () => [...report.standings].sort((a, b) => (b.userAvg - b.communityAvg) - (a.userAvg - a.communityAvg)),
    [report.standings],
  );

  const monthLabel = useCallback(
    (month: string) => {
      if (month.length < 7) return month;
      const y = month.slice(2, 4);
      const m = parseInt(month.slice(5), 10) - 1;
      return lang === 'ko' ? `${y}년 ${m + 1}월` : `${monthName(m, lang)} '${y}`;
    },
    [lang],
  );

  // Section numbers stay sequential no matter which sections this profile has.
  let sectionCount = 0;
  const nextNo = () => String(++sectionCount).padStart(2, '0');

  return (
    <div className="taste-report mx-auto max-w-5xl px-4 md:px-6 py-7 space-y-6">
      <style>{VIZ_VARS + TASTE_MOTION_CSS}</style>

      {/* ── Hero ── */}
      <header className="relative overflow-hidden rounded-3xl border border-accent/15 bg-accent-soft/60 px-6 py-8 md:px-9 md:py-10">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none dark:hidden"
          style={{ backgroundImage: aurora(0.86) }}
        />
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none hidden dark:block"
          style={{ backgroundImage: aurora(0.3) }}
        />
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[10px] font-black tracking-[0.14em] uppercase text-accent-deep/70">
              {t('sj.taste.analysisTitle')}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 shrink-0 rounded-full border border-accent/25 bg-surface/70 px-3 py-1.5 text-[12px] font-semibold text-accent-deep hover:bg-surface transition disabled:opacity-70"
            >
              {refreshing ? <FlowerSpinner size={13} /> : <RotateCw size={13} />}
              {t(refreshing ? 'sj.taste.refreshing' : 'sj.taste.refresh')}
            </button>
          </div>
          <h1 className="mt-3 text-[30px] md:text-[38px] font-black text-ink leading-[1.08] tracking-tight whitespace-pre-line">
            {headline}
          </h1>
          <p className="mt-3 max-w-lg text-[13px] md:text-[13.5px] text-mid leading-relaxed">
            {t('sj.taste.analysisMeta')
              .replace('{n}', String(report.ratingCount))
              .replace('{g}', String(report.totalTags))
              .replace('{w}', String(clusters.length))}
          </p>
          <div className="mt-7 flex items-stretch gap-6 md:gap-9">
            <HeroStat value={report.ratingCount} label={t('sj.taste.statRated')} />
            <span className="w-px bg-accent/20" aria-hidden />
            <HeroStat value={report.totalTags} label={t('sj.taste.statGenres')} />
            <span className="w-px bg-accent/20" aria-hidden />
            <HeroStat value={clusters.length} label={t('sj.taste.statWorlds')} />
          </div>
        </div>
      </header>

      {/* ── The taste map ── */}
      {graph && (
        <Section no={nextNo()} title={t('sj.taste.mapHeader')} lead={t('sj.taste.mapSub')}>
          <TasteGraph data={graph} />
        </Section>
      )}

      {/* ── Numbers: rotating #1 hall of fame + meaningful stat tiles + activity ── */}
      <Section no={nextNo()} title={t('sj.taste.statsHeader')}>
        <div className="mt-5 flex flex-col lg:flex-row gap-7 lg:gap-9">
          {report.topAlbums.length > 0 && (
            <HallOfFame albums={report.topAlbums} score={report.topScore ?? report.topAlbums[0].score} t={t} />
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                value={stats.avgScore != null ? stats.avgScore.toFixed(2) : '—'}
                label={t('sj.taste.statAvg')}
                hint={stats.sdScore != null ? `±${stats.sdScore.toFixed(2)} ${t('sj.taste.statSpread')}` : undefined}
                tip={t('sj.taste.statAvgTip')}
              />
              <StatTile
                value={stats.median != null ? stats.median.toFixed(1) : '—'}
                label={t('sj.taste.statMedian')}
                hint={skewHint(stats.skew, stats.median, stats.avgScore, t)}
                hintTone="neutral"
                tip={t('sj.taste.statMedianTip')}
              />
              <StatTile
                value={stats.effectiveGenres != null ? stats.effectiveGenres.toFixed(1) : '—'}
                label={t('sj.taste.statDiversity')}
                hint={t('sj.taste.statDiversityHint').replace('{n}', String(report.totalTags))}
                hintTone="neutral"
                tip={t('sj.taste.statDiversityTip')}
              />
              <StatTile
                value={
                  stats.communityDelta != null
                    ? `${stats.communityDelta >= 0 ? '+' : '−'}${Math.abs(stats.communityDelta).toFixed(2)}`
                    : '—'
                }
                label={t('sj.taste.statVsCrowd')}
                hint={crowdHint(stats.communityDelta, t)}
                tip={t('sj.taste.statVsCrowdTip')}
                hintTone={
                  stats.communityDelta == null || Math.abs(stats.communityDelta) < 0.05
                    ? 'neutral'
                    : stats.communityDelta > 0
                      ? 'up'
                      : 'down'
                }
              />
            </div>
            <div className="rounded-xl bg-page border border-divider/60 px-4 py-3">
              <p className="text-[11px] font-bold text-muted mb-2">
                {t('sj.taste.activityHeader')}
              </p>
              <ActivitySpark
                timeline={charts.timeline}
                peakIndex={charts.peakMonthIndex}
                monthLabel={monthLabel}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── Release years ── */}
      {years.length > 1 && stats.meanYear != null && stats.avgScore != null && (
        <Section no={nextNo()} title={t('sj.taste.yearsHeader')} lead={eraText}>
          <YearChart
            years={years}
            avgScore={stats.avgScore}
            aboveLabel={t('sj.taste.yearsAbove')}
            belowLabel={t('sj.taste.yearsBelow')}
            paceLabel={t('sj.taste.yearsTrend')}
            avgLabel={t('sj.taste.yearsBaseline')}
          />
        </Section>
      )}

      {/* ── Score distribution ── */}
      {scoreTotal > 0 && stats.avgScore != null && (
        <Section no={nextNo()} title={t('sj.taste.scoreHeader')} lead={scoreText}>
          <ScoreChart
            bins={scoreDist}
            mean={{
              pos: (stats.avgScore - 0.25) / 5,
              label: `${t('sj.taste.meanLabel')} ${stats.avgScore.toFixed(2)}`,
            }}
            legend={t('sj.taste.mapLegendScore')}
          />
        </Section>
      )}

      {/* ── Scene mix + canon reach ── */}
      <div className="grid sm:grid-cols-2 gap-6">
        {scenes && sceneLead && (
          <Section
            no={nextNo()}
            title={t('sj.taste.sceneHeader')}
            lead={t('sj.taste.sceneLeadText')
              .replace('{scene}', t(SCENE_KEYS[sceneLead.scene]))
              .replace('{pct}', String(Math.round(sceneLead.share * 100)))}
          >
            <SceneBar
              segments={sceneShares.map((s) => ({
                share: s.share,
                color: s.color,
                title: `${t(SCENE_KEYS[s.scene])} · ${Math.round(s.share * 100)}%`,
              }))}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {sceneShares.map((s) => (
                <span key={s.scene} className="flex items-center gap-1.5 text-[12px] text-muted">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="font-semibold text-ink">{t(SCENE_KEYS[s.scene])}</span>
                  <span className="tabular-nums">{Math.round(s.share * 100)}%</span>
                </span>
              ))}
            </div>
          </Section>
        )}
        <Section no={nextNo()} title={t('sj.taste.canonHeader')}>
          <div className="mt-4 flex items-center gap-5">
            <CanonGauge pct={stats.prestigeShare ?? 0} label={t('sj.taste.canonInCanon')} />
            <p className="flex-1 text-[12.5px] text-mid leading-relaxed">{reachText}</p>
          </div>
        </Section>
      </div>

      {/* ── Community comparison (dumbbell per genre) ── */}
      {standings.length > 0 && (
        <Section no={nextNo()} title={t('sj.taste.standingsHeader')} lead={t('sj.taste.standingsSub')}>
          <div className="mt-4 flex items-center justify-end">
            <span className="flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent shrink-0" />
                {t('sj.taste.you')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-muted/50 shrink-0" />
                {t('sj.taste.community')}
              </span>
            </span>
          </div>
          <DumbbellAxis />
          <div className="space-y-4">
            {standings.map((s) => {
              const diff = s.userAvg - s.communityAvg;
              return (
                <div key={s.genre}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[13px] font-bold text-ink">{s.genre}</span>
                    <span
                      className={`text-[11.5px] font-semibold tabular-nums ${diff >= 0 ? 'text-accent-deep' : 'text-muted'}`}
                    >
                      {diff >= 0 ? '↑' : '↓'} {Math.abs(diff).toFixed(2)}{' '}
                      {t(diff >= 0 ? 'sj.taste.aboveAverage' : 'sj.taste.belowAverage')}
                    </span>
                  </div>
                  <DumbbellRow
                    user={s.userAvg}
                    community={s.communityAvg}
                    tipText={`${t('sj.taste.you')} ${s.userAvg.toFixed(2)} · ${t('sj.taste.community')} ${s.communityAvg.toFixed(2)}`}
                  />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Not your thing ── */}
      {report.disliked.length > 0 && (
        <Section no={nextNo()} title={t('sj.taste.notYourThing')} lead={t('sj.taste.notYourThingSub')}>
          <div className="mt-4 flex flex-wrap gap-2">
            {report.disliked.map((d) => (
              <span
                key={d.tag}
                className="px-3 py-1.5 rounded-full bg-divider/50 text-[12.5px] text-muted line-through decoration-muted/50"
              >
                {d.display}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Reveal>
        <p className="text-center text-[11.5px] text-muted/50 pb-6">{t('sj.taste.snapshotEnd')}</p>
      </Reveal>
    </div>
  );
}

/** Numbered, scroll-revealed report section card. */
function Section({
  no,
  title,
  lead,
  children,
}: {
  no: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal>
      <section className="rounded-2xl bg-surface border border-divider/60 px-5 py-5 md:px-7 md:py-6 h-full">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-black tabular-nums text-accent/60">{no}</span>
          <h2 className="text-[17px] md:text-[19px] font-black text-ink tracking-tight">{title}</h2>
        </div>
        {lead && (
          <p className="mt-1.5 text-[13px] md:text-[13.5px] text-mid leading-relaxed max-w-prose">
            {lead}
          </p>
        )}
        {children}
      </section>
    </Reveal>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="block text-[26px] md:text-[30px] font-black text-ink leading-none">
        <CountUp value={value} />
      </span>
      <span className="block mt-1.5 text-[10.5px] font-bold tracking-[0.08em] uppercase text-muted">
        {label}
      </span>
    </span>
  );
}

/** "mostly 2010s · Korean scene" — the world's era + scene in one line. */
function worldNote(world: TasteWorld, t: (k: string) => string): string {
  const parts: string[] = [];
  if (world.meanYear != null) {
    const decade = Math.floor(world.meanYear / 10) * 10;
    parts.push(
      (world.sdYears ?? 0) >= 12
        ? t('sj.taste.worldEraSpread')
        : t('sj.taste.worldEraDecade').replace('{decade}', String(decade)),
    );
  }
  parts.push(t(world.dominantScene ? SCENE_KEYS[world.dominantScene] : 'sj.taste.sceneMixed'));
  return parts.join(' · ');
}

function StatTile({
  value,
  label,
  hint,
  hintTone = 'neutral',
  tip,
}: {
  value: string;
  label: string;
  hint?: string;
  hintTone?: 'neutral' | 'up' | 'down';
  tip?: string;
}) {
  const tone =
    hintTone === 'up'
      ? 'text-accent-deep'
      : hintTone === 'down'
        ? 'text-[color:var(--tr-dn)]'
        : 'text-muted/80';
  return (
    <div className="group relative rounded-xl bg-page border border-divider/60 px-4 py-3.5">
      <p className="text-[22px] font-black text-ink leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-muted mt-0.5">{label}</p>
      {hint && <p className={`text-[10.5px] font-semibold mt-1 tabular-nums ${tone}`}>{hint}</p>}
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-3 right-3 bottom-full z-20 mb-1.5 rounded-lg bg-ink px-3 py-2 text-[11px] leading-snug text-page opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {tip}
        </span>
      )}
    </div>
  );
}

/** Median-vs-mean skew read: which way your scale leans. */
function skewHint(
  skew: number | null,
  median: number | null,
  mean: number | null,
  t: (k: string) => string,
): string | undefined {
  if (skew == null || median == null || mean == null) return undefined;
  if (Math.abs(skew) < 0.25) return t('sj.taste.statSkewEven');
  // Negative moment-skew = a long tail of harsh scores below a generous hump.
  return t(skew < 0 ? 'sj.taste.statSkewHigh' : 'sj.taste.statSkewLow');
}

/** Turn the signed community gap into a plain-language grader read. */
function crowdHint(delta: number | null, t: (k: string) => string): string | undefined {
  if (delta == null) return undefined;
  if (Math.abs(delta) < 0.05) return t('sj.taste.statAligned');
  return t(delta > 0 ? 'sj.taste.statGenerous' : 'sj.taste.statCritical');
}

/**
 * Rotating 3D "hall of fame" for the albums tied at the user's top score. The
 * covers sit on a ring in 3D space; the ring auto-advances so each tied album
 * takes the front in turn, with its title/artist crossfading below. A single
 * top album just floats (no ring); clicking any cover brings it to the front,
 * and the front cover links to the album. All motion collapses under
 * prefers-reduced-motion — the ring snaps instead of sweeping and the front
 * album is navigable via the dots.
 */
function HallOfFame({
  albums,
  score,
  t,
}: {
  albums: TopAlbum[];
  score: number;
  t: (k: string) => string;
}) {
  const n = albums.length;
  // `turn` is an unbounded, monotonically-moving index: auto-spin and a
  // rightward drag only ever *increase* it, so the ring rotates forward past the
  // last cover into the first instead of unwinding all the way back. The album
  // shown at the front is `turn` folded into range.
  const [turn, setTurn] = useState(0);
  const active = ((turn % n) + n) % n;
  const reduced = usePrefersReducedMotion();
  // Bumped on every user interaction so the auto-spin timer restarts from zero
  // rather than firing immediately after the user just moved the ring.
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (reduced || n <= 1) return;
    const id = setInterval(() => setTurn((x) => x + 1), 3400);
    return () => clearInterval(id);
  }, [reduced, n, resetKey]);

  /** Move to a specific album by the shortest signed path, then restart timer. */
  const goTo = useCallback(
    (i: number) => {
      setTurn((x) => {
        const cur = ((x % n) + n) % n;
        let d = ((i - cur) % n + n) % n; // 0..n-1 forward
        if (d > n / 2) d -= n; // take the shorter way round
        return x + d;
      });
      setResetKey((k) => k + 1);
    },
    [n],
  );

  // ── Drag to spin ──────────────────────────────────────────────────────────
  // `turn` is read through a ref so the pointer handlers never re-create (and so
  // a press captures the *current* turn without listing it as a dep).
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const drag = useRef<{ startX: number; startTurn: number; moved: boolean } | null>(null);
  const DRAG_PX_PER_STEP = 70; // horizontal travel that advances one cover

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (n <= 1 || e.button !== 0) return;
    // Don't capture yet: capturing on press retargets pointer events off the
    // covers, which swallows their click (goTo) and nav. Capture only once a
    // real drag starts, in onPointerMove.
    drag.current = { startX: e.clientX, startTurn: turnRef.current, moved: false };
  }, [n]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < 4) return; // a click, not a drag — leave covers clickable
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setResetKey((k) => k + 1); // pause auto-spin now that a drag is underway
    }
    // Drag left → advance forward (matches the auto-spin direction).
    setTurn(d.startTurn - Math.round(dx / DRAG_PX_PER_STEP));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Keep `moved` readable through the click that immediately follows so cover
    // taps that were actually drags don't also navigate / jump.
    if (d.moved) setTimeout(() => (drag.current = null), 0);
    else drag.current = null;
  }, []);

  const front = albums[active];
  const COVER = 168; // px — fixed so the 3D ring geometry is stable
  const step = n > 0 ? 360 / n : 0;
  // Radius so neighbouring covers don't collide; ample gap for a coverflow feel.
  const radius = n <= 1 ? 0 : Math.max(150, COVER / 2 / Math.tan(Math.PI / n) + 26);

  return (
    <div className="shrink-0 w-full lg:w-1/2 flex flex-col items-center">
      <span className="self-start text-[10px] font-black tracking-[0.1em] uppercase text-accent-deep/70">
        {t('sj.taste.topAlbum')}
      </span>

      {n === 1 ? (
        <Link href={`/album/${front.id}`} className="group mt-3">
          <div className="hof-float">
            <Cover
              url={front.coverUrl}
              thumb={false}
              className="w-44 h-44 shadow-xl"
              rounded="rounded-xl"
            />
          </div>
        </Link>
      ) : (
        <div
          className="hof-stage mt-3 w-full overflow-hidden touch-pan-y select-none cursor-grab active:cursor-grabbing"
          style={{ height: COVER + 24 }}
          role="group"
          aria-roledescription="carousel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="hof-ring"
            style={{ transform: `translateZ(-${radius}px) rotateY(${-turn * step}deg)` }}
          >
            {albums.map((al, i) => {
              const dist = Math.min((i - active + n) % n, (active - i + n) % n);
              const isFront = i === active;
              const card = (
                <Cover
                  url={al.coverUrl}
                  thumb={false}
                  className={`hof-cover w-full h-full ${isFront ? 'shadow-xl ring-2 ring-accent/40' : 'shadow-md'}`}
                  rounded="rounded-xl"
                />
              );
              return (
                <div
                  key={al.id}
                  className="hof-card"
                  style={{
                    width: COVER,
                    height: COVER,
                    marginLeft: -COVER / 2,
                    transform: `rotateY(${i * step}deg) translateZ(${radius}px)`,
                    opacity: isFront ? 1 : Math.max(0.22, 1 - dist * 0.32),
                    filter: isFront ? 'none' : `brightness(${Math.max(0.55, 1 - dist * 0.16)})`,
                    zIndex: n - dist,
                  }}
                  aria-hidden={!isFront}
                >
                  {isFront ? (
                    <Link
                      href={`/album/${al.id}`}
                      className="block w-full h-full"
                      draggable={false}
                      onClick={(e) => {
                        // A drag that happened to end on the front cover shouldn't
                        // navigate.
                        if (drag.current?.moved) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                    >
                      {card}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!drag.current?.moved) goTo(i); // plain tap → bring to front
                      }}
                      className="block w-full h-full"
                      draggable={false}
                      tabIndex={-1}
                    >
                      {card}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* front album meta — crossfades as the ring turns. The title box reserves
          a fixed two-line height (leading-[1.25] × 2 = 2.5em) so a long, wrapping
          title and a short one-liner take the same vertical space — otherwise the
          meta block, and the whole "By the numbers" box, would jump height as the
          ring rotates through titles of different lengths. The title bottom-aligns
          within that box so the gap between the album name and the artist stays
          constant whether the title is one or two lines. */}
      <Link href={`/album/${front.id}`} className="group mt-4 text-center max-w-[240px]">
        <span key={front.id} className="hof-meta block">
          <span
            className="flex flex-col justify-end text-[14px] font-bold leading-[1.25] text-ink"
            style={{ height: '2.5em' }}
          >
            <span className="line-clamp-2 group-hover:underline">{front.title}</span>
          </span>
          <span className="block text-[12px] text-muted truncate">{front.artist}</span>
        </span>
      </Link>

      <span
        className="inline-block mt-2 rounded-md px-2 py-0.5 text-[14px] font-black tabular-nums"
        style={{ background: spectrumFill(score), color: spectrumNumber(score) }}
      >
        {score.toFixed(1)}
      </span>

      {n > 1 && (
        <>
          <p className="mt-2 text-[11px] text-muted">
            {t('sj.taste.hofTied')
              .replace('{n}', String(n))
              .replace('{score}', score.toFixed(1))}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5" role="tablist">
            {albums.map((al, i) => (
              <button
                key={al.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={al.title}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === active ? 'w-4 bg-accent' : 'w-1.5 bg-muted/40 hover:bg-muted/70'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** True when the user has asked the OS to reduce motion (live, not one-shot). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
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
