'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
    meanYear: number | null;
    sdYears: number | null;
    prestigeShare: number | null;
  };
  topAlbum: {
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    score: number;
  } | null;
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

  const peakMonth =
    charts.peakMonthIndex != null ? charts.timeline[charts.peakMonthIndex] : null;

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

      {/* ── Numbers: #1 album + stat tiles + 12-month activity ── */}
      <Section no={nextNo()} title={t('sj.taste.statsHeader')}>
        <div className="mt-5 flex flex-col sm:flex-row gap-6">
          {report.topAlbum && (
            <Link
              href={`/album/${report.topAlbum.id}`}
              className="flex sm:flex-col items-center sm:items-start gap-4 sm:gap-2.5 sm:w-44 shrink-0 group"
            >
              <Cover
                url={report.topAlbum.coverUrl}
                thumb={false}
                className="w-24 h-24 sm:w-44 sm:h-44"
                rounded="rounded-xl"
              />
              <span className="min-w-0">
                <span className="block text-[10px] font-black tracking-[0.1em] uppercase text-accent-deep/70">
                  {t('sj.taste.topAlbum')}
                </span>
                <span className="block mt-0.5 text-[14px] font-bold text-ink line-clamp-2 group-hover:underline">
                  {report.topAlbum.title}
                </span>
                <span className="block text-[12px] text-muted truncate">
                  {report.topAlbum.artist}
                </span>
                <span
                  className="inline-block mt-1.5 rounded-md px-2 py-0.5 text-[14px] font-black tabular-nums"
                  style={{
                    background: spectrumFill(report.topAlbum.score),
                    color: spectrumNumber(report.topAlbum.score),
                  }}
                >
                  {report.topAlbum.score.toFixed(1)}
                </span>
              </span>
            </Link>
          )}
          <div className="flex-1 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
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
                value={peakMonth ? monthName(parseInt(peakMonth.month.slice(5), 10) - 1, lang) : '—'}
                label={t('sj.taste.statPeak')}
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

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-page border border-divider/60 px-4 py-3.5">
      <p className="text-[22px] font-black text-ink leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-muted mt-0.5">{label}</p>
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
