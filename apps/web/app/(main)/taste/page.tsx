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
  axes: { breadth: number; era: number; reach: number; judgment: number };
  clusters: TasteWorld[];
  disliked: { tag: string; display: string }[];
  standings: { genre: string; userAvg: number; communityAvg: number; userCount: number }[];
  stats: {
    avgScore: number | null;
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

/**
 * Taste — a single-page analysis report of the user's rating history
 * (restructured 2026-07-12 from the old snap-scroll card reel): an MBTI-style
 * taste type, four axis spectrums, taste-world clusters, stats, and community
 * comparison, all from one /api/taste/profile payload. Locked until 25
 * ratings, matching iOS.
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

const AXES: {
  key: keyof TasteReport['axes'];
  labelKey: string;
  lowKey: string; // pole at value 0
  highKey: string; // pole at value 1
}[] = [
  { key: 'breadth', labelKey: 'sj.taste.axisBreadth', lowKey: 'sj.taste.poleFocused', highKey: 'sj.taste.poleEclectic' },
  { key: 'era', labelKey: 'sj.taste.axisEra', lowKey: 'sj.taste.poleTimeless', highKey: 'sj.taste.poleCurrent' },
  { key: 'reach', labelKey: 'sj.taste.axisReach', lowKey: 'sj.taste.poleUnderground', highKey: 'sj.taste.poleMainstream' },
  { key: 'judgment', labelKey: 'sj.taste.axisJudgment', lowKey: 'sj.taste.poleSharp', highKey: 'sj.taste.poleWarm' },
];

function ReportView({ report }: { report: TasteReport }) {
  const { t, lang } = useLanguage();

  const typeName = t('sj.taste.typeName')
    .replace('{adj}', t(`sj.taste.${report.type.adjectiveKey}`))
    .replace('{noun}', t(`sj.taste.${report.type.nounKey}`));

  const leanings = AXES.map(({ key, lowKey, highKey }) =>
    t(report.axes[key] >= 0.5 ? highKey : lowKey),
  ).join(' · ');

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-7 space-y-5">
      {/* ── Type hero ── */}
      <section className="rounded-2xl bg-accent-soft/60 border border-accent/15 px-6 py-7 text-center">
        <p className="text-[10px] font-black tracking-[0.12em] uppercase text-accent-deep/70">
          {t('sj.taste.typeEyebrow')}
        </p>
        <div className="flex justify-center gap-1.5 mt-4">
          {report.type.code.split('').map((letter, i) => (
            <span
              key={i}
              className="w-9 h-9 rounded-lg bg-accent text-white text-[17px] font-black flex items-center justify-center"
            >
              {letter}
            </span>
          ))}
        </div>
        <h1 className="mt-4 text-[26px] font-black text-ink leading-tight">{typeName}</h1>
        <p className="mt-1.5 text-[13px] text-muted">{leanings}</p>
        <p className="mt-3 text-[12px] text-muted/70">
          {t('sj.taste.fromNRatings').replace('{n}', String(report.ratingCount))}
        </p>
      </section>

      {/* ── Axes ── */}
      <section className="rounded-2xl bg-surface px-5 py-5">
        <h2 className="text-[15px] font-bold text-ink mb-4">{t('sj.taste.axesHeader')}</h2>
        <div className="space-y-5">
          {AXES.map(({ key, labelKey, lowKey, highKey }) => {
            const value = report.axes[key];
            const leansHigh = value >= 0.5;
            return (
              <div key={key}>
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
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[15px] h-[15px] rounded-full bg-accent border-2 border-page shadow"
                    style={{ left: `${Math.max(4, Math.min(96, value * 100))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Worlds ── */}
      {report.clusters.length > 0 && (
        <section className="rounded-2xl bg-surface px-5 py-5">
          <h2 className="text-[15px] font-bold text-ink mb-1">{t('sj.taste.yourWorlds')}</h2>
          <p className="text-[12px] text-muted mb-4">{t('sj.taste.worldsDesc')}</p>
          <div className="space-y-5">
            {report.clusters.slice(0, 4).map((world, i) => {
              const headline =
                world.tags.length > 1
                  ? `${world.tags[0].display} × ${world.tags[1].display}`
                  : world.tags[0]?.display ?? '';
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[14px] font-bold text-ink">{headline}</h3>
                    <span className="text-[12px] font-semibold text-accent-deep tabular-nums">
                      {t('sj.taste.worldShare').replace(
                        '{share}',
                        String(Math.round(world.share * 100)),
                      )}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {world.tags.map((tag) => (
                      <div key={tag.display} className="flex items-center gap-2.5">
                        <span className="w-28 shrink-0 text-right text-[11.5px] text-muted truncate">
                          {tag.display}
                        </span>
                        <span className="flex-1 h-[6px] rounded-full bg-divider/60 overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${(tag.avg / 5) * 100}%` }}
                          />
                        </span>
                        <span className="w-8 text-[11.5px] font-bold text-accent-deep tabular-nums">
                          {tag.avg.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
              value={report.stats.avgScore != null ? report.stats.avgScore.toFixed(2) : '—'}
              label={t('sj.taste.statAvg')}
            />
            <StatTile value={String(report.stats.fiveStars)} label={t('sj.taste.perfectScores')} />
            <StatTile
              value={
                report.stats.peakMonthIndex != null
                  ? monthName(report.stats.peakMonthIndex, lang)
                  : '—'
              }
              label={t('sj.taste.statPeak')}
            >
              <div className="flex items-end gap-[2px] h-6 mt-1">
                {report.stats.months.map((count, i) => {
                  const max = Math.max(1, ...report.stats.months);
                  const isPeak = i === report.stats.peakMonthIndex;
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

// ── Lock screen (unchanged from the reel version) ───────────────────────────

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
