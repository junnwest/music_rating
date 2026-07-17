'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, Star, BarChart3, Drama, AudioWaveform } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

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
  charts: {
    decades: { decade: number; count: number }[];
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

// Categorical series slots for worlds and scenes — a fixed-order palette
// validated (CVD separation, lightness band, contrast) against both app
// surfaces; light/dark steps swap via the .taste-report CSS vars below.
// Identity never rides on color alone: every use is paired with a named
// legend or a direct label.
const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)'];
const VIZ_VARS = `
.taste-report{--viz-1:#2a78d6;--viz-2:#1baf7a;--viz-3:#eda100;--viz-4:#008300;--viz-5:#4a3aa7;}
.dark .taste-report{--viz-1:#3987e5;--viz-2:#199e70;--viz-3:#c98500;--viz-4:#008300;--viz-5:#9085e9;}
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
 * Taste — a graphical analysis report of the user's rating history: how the
 * taste splits into worlds (with sub-genre breakdowns), a release-decade
 * histogram, the score distribution, scene mix, canon reach, activity, and
 * community comparison. Every chart carries a plain-language sentence
 * explaining what it says. Locked until 25 ratings.
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
  const { stats, clusters, charts } = report;

  const worldName = (w: TasteWorld) =>
    w.tags.length > 1 ? `${w.tags[0].display} × ${w.tags[1].display}` : w.tags[0]?.display ?? '';

  const headline =
    clusters.length >= 2
      ? t('sj.taste.worldsTitle').replace('{n}', String(clusters.length))
      : t('sj.taste.worldsTitleOne');

  // ── era histogram ──
  const decades = charts.decades;
  const eraText =
    stats.meanYear == null
      ? ''
      : ((stats.sdYears ?? 0) >= 12 ? t('sj.taste.eraWideText') : t('sj.taste.eraNarrowText'))
          .replace('{year}', String(stats.meanYear))
          .replace('{sd}', String(Math.round(stats.sdYears ?? 0)));
  const decadeSpan = decades.length > 0 ? decades[decades.length - 1].decade + 10 - decades[0].decade : 0;
  const decadePeak = decades.reduce((best, d, i) => (d.count > decades[best]?.count ? i : best), 0);

  // ── score distribution ──
  const scoreDist = charts.scoreDist;
  const scoreTotal = scoreDist.reduce((s, x) => s + x, 0);
  const scorePeak = scoreDist.reduce((best, x, i) => (x > scoreDist[best] ? i : best), 0);
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

  return (
    <div className="taste-report mx-auto max-w-3xl px-4 md:px-6 py-7 space-y-5">
      <style>{VIZ_VARS}</style>

      {/* ── Header ── */}
      <section className="rounded-2xl bg-accent-soft/60 border border-accent/15 px-6 py-6">
        <p className="text-[10px] font-black tracking-[0.12em] uppercase text-accent-deep/70">
          {t('sj.taste.analysisTitle')}
        </p>
        <h1 className="mt-2 text-[24px] font-black text-ink leading-tight whitespace-pre-line">
          {headline}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted">
          {t('sj.taste.analysisMeta')
            .replace('{n}', String(report.ratingCount))
            .replace('{g}', String(report.totalTags))
            .replace('{w}', String(clusters.length))}
        </p>
      </section>

      {/* ── Taste territory: worlds as area-scaled bubbles competing for space ── */}
      {clusters.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.territoryHeader')}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{t('sj.taste.territorySub')}</p>
          <TasteTerritory
            worlds={clusters.map((w, i) => ({
              share: w.share,
              primary: w.tags[0]?.display ?? '',
              full: worldName(w),
              avg: w.avgScore,
            }))}
            colorFor={(i) => SERIES[i % SERIES.length]}
          />
        </section>
      )}

      {/* ── World cards: sub-genre breakdowns ── */}
      {clusters.map((world, i) => {
        const color = SERIES[i % SERIES.length];
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
              <span className="text-[12px] font-semibold tabular-nums text-muted">
                {t('sj.taste.worldShare').replace('{share}', String(Math.round(world.share * 100)))}
              </span>
            </div>
            <WorldClassification world={world} />
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
                  <span className="w-8 text-[11.5px] font-bold tabular-nums text-ink">
                    {tag.avg.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* ── Across the decades ── */}
      {decades.length > 0 && stats.meanYear != null && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.eraHeader')}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{eraText}</p>
          <ColumnChart
            bins={decades.map((d) => d.count)}
            xLabels={decades.map((d, i) =>
              decades.length <= 7 || i % 2 === 0 ? String(d.decade) : null,
            )}
            peakIndex={decadePeak}
            mean={
              decadeSpan > 0
                ? {
                    pos: (stats.meanYear - decades[0].decade) / decadeSpan,
                    label: `${t('sj.taste.meanLabel')} ${stats.meanYear}`,
                  }
                : null
            }
            titleFor={(i) => `${decades[i].decade}s · ${decades[i].count}`}
          />
        </section>
      )}

      {/* ── Score distribution ── */}
      {scoreTotal > 0 && stats.avgScore != null && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.scoreHeader')}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{scoreText}</p>
          <ColumnChart
            bins={scoreDist}
            xLabels={scoreDist.map((_, i) => (i % 2 === 1 ? String((i + 1) / 2) : null))}
            peakIndex={scorePeak}
            mean={{
              pos: (stats.avgScore - 0.25) / 5,
              label: `${t('sj.taste.meanLabel')} ${stats.avgScore.toFixed(2)}`,
            }}
            titleFor={(i) => `${((i + 1) / 2).toFixed(1)}★ · ${scoreDist[i]}`}
          />
        </section>
      )}

      {/* ── Scene mix + canon reach ── */}
      <div className="grid sm:grid-cols-2 gap-5">
        {scenes && sceneLead && (
          <section className="rounded-2xl bg-surface px-5 py-5">
            <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.sceneHeader')}</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              {t('sj.taste.sceneLeadText')
                .replace('{scene}', t(SCENE_KEYS[sceneLead.scene]))
                .replace('{pct}', String(Math.round(sceneLead.share * 100)))}
            </p>
            <StackedBar
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
          </section>
        )}
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.canonHeader')}</h2>
          <p className="mt-3 text-[28px] font-black text-ink leading-none">
            {Math.round((stats.prestigeShare ?? 0) * 100)}%
          </p>
          <div className="mt-3 h-[10px] rounded-full bg-accent-soft overflow-hidden">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, (stats.prestigeShare ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{reachText}</p>
        </section>
      </div>

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
              value={peakMonth ? monthName(parseInt(peakMonth.month.slice(5), 10) - 1, lang) : '—'}
              label={t('sj.taste.statPeak')}
            >
              <div className="flex items-end gap-[2px] h-6 mt-1">
                {charts.timeline.map((m, i) => {
                  const max = Math.max(1, ...charts.timeline.map((x) => x.count));
                  const isPeak = i === charts.peakMonthIndex;
                  return (
                    <span
                      key={m.month}
                      title={`${m.month} · ${m.count}`}
                      className={`flex-1 rounded-sm ${isPeak ? 'bg-accent' : 'bg-divider'}`}
                      style={{ height: Math.max(2, (m.count / max) * 24) }}
                    />
                  );
                })}
              </div>
            </StatTile>
          </div>
        </div>
      </section>

      {/* ── Community comparison (dumbbell per genre) ── */}
      {report.standings.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[15px] font-bold text-ink">{t('sj.taste.standingsHeader')}</h2>
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
                  <Dumbbell
                    user={s.userAvg}
                    community={s.communityAvg}
                    title={`${t('sj.taste.you')} ${s.userAvg.toFixed(2)} · ${t('sj.taste.community')} ${s.communityAvg.toFixed(2)}`}
                  />
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

// ── Chart primitives ────────────────────────────────────────────────────────

/**
 * Single-hue column chart: ≤24px columns with a 4px rounded top and square
 * baseline, 2px gaps, hairline baseline, the peak column direct-labeled, an
 * optional mean marker, and per-column native tooltips.
 */
function ColumnChart({
  bins,
  xLabels,
  peakIndex,
  mean,
  titleFor,
}: {
  bins: number[];
  xLabels: (string | null)[];
  peakIndex: number | null;
  mean: { pos: number; label: string } | null;
  titleFor: (i: number) => string;
}) {
  const max = Math.max(1, ...bins);
  return (
    <div className={mean ? 'mt-8' : 'mt-3'}>
      <div className="relative">
        <div className="flex items-end gap-[2px] h-24 border-b border-divider">
          {bins.map((count, i) => (
            <div
              key={i}
              title={titleFor(i)}
              className="flex-1 h-full flex flex-col items-center justify-end min-w-0"
            >
              {i === peakIndex && count > 0 && (
                <span className="text-[10px] font-semibold text-muted mb-0.5 tabular-nums">
                  {count}
                </span>
              )}
              <span
                className="w-full max-w-[24px] rounded-t bg-accent"
                style={{ height: count > 0 ? Math.max(3, Math.round((count / max) * 76)) : 0 }}
              />
            </div>
          ))}
        </div>
        {mean && (
          <>
            <span
              className="absolute -top-1 bottom-0 w-px bg-ink/35 pointer-events-none"
              style={{ left: `${Math.max(2, Math.min(98, mean.pos * 100))}%` }}
            />
            <span
              className="absolute -top-6 -translate-x-1/2 text-[10px] font-semibold text-muted whitespace-nowrap pointer-events-none"
              style={{ left: `${Math.max(10, Math.min(90, mean.pos * 100))}%` }}
            >
              {mean.label}
            </span>
          </>
        )}
      </div>
      <div className="flex gap-[2px] mt-1">
        {xLabels.map((label, i) => (
          <span
            key={i}
            className="flex-1 min-w-0 text-center text-[10px] text-muted/70 tabular-nums"
          >
            {label ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Part-to-whole stacked bar with 2px surface gaps between segments. */
function StackedBar({
  segments,
}: {
  segments: { share: number; color: string; title: string }[];
}) {
  return (
    <div className="mt-4 flex h-[14px] rounded-full overflow-hidden gap-[2px]">
      {segments.map((s, i) => (
        <span
          key={i}
          title={s.title}
          className="min-w-[6px]"
          style={{ flex: `${s.share} 1 0px`, background: s.color }}
        />
      ))}
    </div>
  );
}

/** You-vs-community dumbbell on a fixed 0.5–5.0 track; dots wear surface rings. */
function Dumbbell({ user, community, title }: { user: number; community: number; title: string }) {
  const pos = (v: number) => Math.max(2, Math.min(98, ((v - 0.5) / 4.5) * 100));
  const lo = Math.min(pos(user), pos(community));
  const hi = Math.max(pos(user), pos(community));
  return (
    <div className="relative h-[18px]" title={title}>
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-divider/70" />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-muted/40"
        style={{ left: `${lo}%`, width: `${hi - lo}%` }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[10px] h-[10px] rounded-full bg-muted/50 ring-2 ring-surface"
        style={{ left: `${pos(community)}%` }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[10px] h-[10px] rounded-full bg-accent ring-2 ring-surface"
        style={{ left: `${pos(user)}%` }}
      />
    </div>
  );
}

// ── Taste territory (packed bubbles) ─────────────────────────────────────────

interface Packed<T> {
  item: T;
  x: number;
  y: number;
}

/**
 * Greedy circle packing for a handful of bubbles: largest at the centre, then
 * each next placed at the free spot (tangent to an existing bubble) closest to
 * the centre — so they cluster tight and "compete for land". Deterministic:
 * same shares in → same layout out, no jitter between renders. O(n² · angles),
 * trivial for the ≤8 worlds a taste profile ever has.
 */
function packCircles<T extends { r: number }>(items: T[]): Packed<T>[] {
  const placed: Packed<T>[] = [];
  const order = [...items].sort((a, b) => b.r - a.r);
  const EPS = 0.5;
  const overlaps = (x: number, y: number, r: number) =>
    placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.item.r + r - EPS);

  order.forEach((item, idx) => {
    if (idx === 0) {
      placed.push({ item, x: 0, y: 0 });
      return;
    }
    let best: { x: number; y: number; d: number } | null = null;
    for (const p of placed) {
      const ring = p.item.r + item.r;
      for (let a = 0; a < 360; a += 6) {
        const rad = (a * Math.PI) / 180;
        const x = p.x + ring * Math.cos(rad);
        const y = p.y + ring * Math.sin(rad);
        if (overlaps(x, y, item.r)) continue;
        const d = Math.hypot(x, y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    placed.push(best ? { item, x: best.x, y: best.y } : { item, x: 0, y: 0 });
  });
  return placed;
}

interface TerritoryWorld {
  share: number;
  primary: string;
  full: string;
  avg: number | null;
}

/** Each world is a bubble whose AREA is its share of your ratings (r ∝ √share),
 *  packed so the big worlds crowd out the small ones. */
function TasteTerritory({
  worlds,
  colorFor,
}: {
  worlds: TerritoryWorld[];
  colorFor: (i: number) => string;
}) {
  const layout = useMemo(() => {
    const items = worlds.map((w, i) => ({ r: Math.sqrt(Math.max(w.share, 0.0001)) * 100, i, w }));
    const placed = packCircles(items);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of placed) {
      minX = Math.min(minX, p.x - p.item.r);
      minY = Math.min(minY, p.y - p.item.r);
      maxX = Math.max(maxX, p.x + p.item.r);
      maxY = Math.max(maxY, p.y + p.item.r);
    }
    const pad = 5;
    return {
      placed,
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [worlds]);

  return (
    <div>
      <svg
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="mt-4 w-full"
        style={{ maxHeight: 320 }}
        role="img"
      >
        {layout.placed.map((p) => {
          const { i, w } = p.item;
          const color = colorFor(i);
          const pct = Math.round(w.share * 100);
          const showName = p.item.r > 26;
          return (
            <g key={i}>
              <title>{`${w.full} · ${pct}%${w.avg != null ? ` · ${w.avg.toFixed(2)}★` : ''}`}</title>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.item.r}
                fill={color}
                className="stroke-surface"
                strokeWidth={2}
              />
              {showName ? (
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.22)"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  <tspan x={p.x} dy="-0.15em" style={{ fontSize: Math.min(p.item.r * 0.32, 15), fontWeight: 800 }}>
                    {w.primary}
                  </tspan>
                  <tspan x={p.x} dy="1.2em" style={{ fontSize: Math.min(p.item.r * 0.3, 13), fontWeight: 800 }} opacity={0.9}>
                    {pct}%
                  </tspan>
                </text>
              ) : p.item.r > 11 ? (
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.22)"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  style={{ fontSize: Math.min(p.item.r * 0.5, 13), fontWeight: 800 }}
                >
                  {pct}%
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {worlds.map((w, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(i) }} />
            <span className="font-semibold text-ink">{w.full}</span>
            <span className="tabular-nums">{Math.round(w.share * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Mostly 2010s · Korean scene" chips under a world's header. */
function WorldClassification({ world }: { world: TasteWorld }) {
  const { t } = useLanguage();
  const parts: string[] = [];
  if (world.meanYear != null) {
    const decade = Math.floor(world.meanYear / 10) * 10;
    parts.push(
      (world.sdYears ?? 0) >= 12
        ? t('sj.taste.worldEraSpread')
        : t('sj.taste.worldEraDecade').replace('{decade}', String(decade)),
    );
  }
  const sceneKey = world.dominantScene ? SCENE_KEYS[world.dominantScene] : 'sj.taste.sceneMixed';
  parts.push(t(sceneKey));
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 text-[11.5px] font-semibold text-muted/80 tracking-wide">
      {parts.join(' · ')}
    </p>
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
