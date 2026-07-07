'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flame, Trophy, Gem, Zap } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import FlowerGlyph from '../../../components/sj/FlowerGlyph';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName, formatCount } from '../../../lib/sj/display';
import type {
  ChartRankedRPC,
  ChartTrendingRPC,
  ChartsPulseRPC,
  RankingsUnlockStatusRPC,
  SillaLeaderboardRPC,
  SongChartRPC,
  TrendingSongRPC,
} from '../../../lib/db/types';

type ChartMode = 'albums' | 'songs';

const GENRES = ['Hip Hop', 'K-Pop', 'Jazz', 'Electronic', 'Classical', 'Metal', 'R&B', 'Pop'];
const COUNTRIES: [string, string | null][] = [
  ['Global', null],
  ['KR', 'kr'],
  ['JP', 'jp'],
  ['US', 'us'],
  ['UK', 'uk'],
  ['FR', 'fr'],
  ['LA', 'la'],
];

/**
 * Charts hub — web sibling of iOS ChartsView. Albums/Songs modes, each
 * behind the collective unlock gauge (get_rankings_unlock_status; the
 * server-side coverage floor never surfaces here — one plain counter only).
 */
export default function ChartsPage() {
  const { t } = useLanguage();
  const { userId } = useSession();
  const [mode, setMode] = useState<ChartMode>('albums');
  const [unlock, setUnlock] = useState<RankingsUnlockStatusRPC | null>(null);
  const [pulse, setPulse] = useState<ChartsPulseRPC | null>(null);
  const [mostRated, setMostRated] = useState<ChartRankedRPC[]>([]);
  const [trendingGlobal, setTrendingGlobal] = useState<ChartTrendingRPC[]>([]);
  const [trendingForYou, setTrendingForYou] = useState<ChartTrendingRPC[]>([]);
  const [trendingMode, setTrendingMode] = useState<'global' | 'forYou'>('forYou');
  const [topSongs, setTopSongs] = useState<SongChartRPC[]>([]);
  const [mostRatedSongs, setMostRatedSongs] = useState<SongChartRPC[]>([]);
  const [trendingSongs, setTrendingSongs] = useState<TrendingSongRPC[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const tasks: PromiseLike<unknown>[] = [
        supabase!.rpc('get_rankings_unlock_status').then(({ data }) => {
          if (!cancelled) setUnlock(((data as RankingsUnlockStatusRPC[] | null) ?? [])[0] ?? null);
        }),
        supabase!.rpc('get_charts_pulse').then(({ data }) => {
          if (!cancelled) setPulse(((data as ChartsPulseRPC[] | null) ?? [])[0] ?? null);
        }),
        supabase!.rpc('get_charts_most_rated', { p_limit: 20 }).then(({ data }) => {
          if (!cancelled) setMostRated((data as ChartRankedRPC[] | null) ?? []);
        }),
        supabase!.rpc('get_charts_trending', { p_limit: 5 }).then(({ data }) => {
          if (!cancelled) setTrendingGlobal((data as ChartTrendingRPC[] | null) ?? []);
        }),
        supabase!.rpc('get_charts_top_rated_songs', { p_limit: 20 }).then(({ data }) => {
          if (!cancelled) setTopSongs((data as SongChartRPC[] | null) ?? []);
        }),
        supabase!.rpc('get_charts_most_rated_songs', { p_limit: 20 }).then(({ data }) => {
          if (!cancelled) setMostRatedSongs((data as SongChartRPC[] | null) ?? []);
        }),
        supabase!.rpc('get_charts_trending_songs', { p_limit: 10 }).then(({ data }) => {
          if (!cancelled) setTrendingSongs((data as TrendingSongRPC[] | null) ?? []);
        }),
      ];
      // "For You" trending via top genres
      if (userId) {
        tasks.push(
          (async () => {
            const { data: genreRows } = await supabase!.rpc('get_user_top_genres', {
              p_user_id: userId,
              p_limit: 3,
            });
            const genres = ((genreRows as { genre: string }[] | null) ?? [])
              .map((g) => g.genre.trim())
              .filter(Boolean);
            if (genres.length === 0) return;
            const { data } = await supabase!.rpc('get_charts_trending_for_genres', {
              p_genres: genres,
              p_limit: 5,
            });
            if (!cancelled) setTrendingForYou((data as ChartTrendingRPC[] | null) ?? []);
          })(),
        );
      }
      await Promise.all(tasks);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const activeTrending =
    trendingMode === 'forYou' && trendingForYou.length > 0 ? trendingForYou : trendingGlobal;

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-6">
      {/* Mode switch */}
      <div className="flex items-center gap-6 mb-6">
        {(['albums', 'songs'] as ChartMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[17px] transition ${
              mode === m ? 'font-bold text-ink' : 'font-normal text-muted hover:text-ink'
            }`}
          >
            {m === 'albums' ? t('sj.charts.albums') : t('sj.charts.songs')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="h-64 rounded-2xl bg-surface" />
          <div className="h-40 rounded-2xl bg-surface" />
        </div>
      ) : mode === 'albums' ? (
        unlock && !unlock.album_unlocked ? (
          <LockedView
            events={unlock.album_events}
            target={unlock.album_events_target}
            kind="album"
          />
        ) : (
          <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
            <div className="space-y-6">
              <RankingBlock />
              <ChartHorizSection
                title={t('sj.charts.mostRated')}
                entries={mostRated}
                slug="most-rated"
                showScore={false}
              />
            </div>
            <div className="space-y-5">
              <TrendingCard
                entries={activeTrending}
                mode={trendingMode}
                onMode={setTrendingMode}
                hasForYou={trendingForYou.length > 0}
              />
              <div className="grid grid-cols-2 gap-3">
                <InsightCard
                  icon={<Gem size={17} className="text-accent" />}
                  title={t('sj.charts.hiddenGems')}
                  subtitle={t('sj.charts.hiddenGemsSub')}
                  slug="hidden-gems"
                />
                <InsightCard
                  icon={<Zap size={17} className="text-accent" />}
                  title={t('sj.charts.controversial')}
                  subtitle={t('sj.charts.controversialSub')}
                  slug="controversial"
                />
              </div>
              <PulseCard pulse={pulse} />
            </div>
          </div>
        )
      ) : unlock && !unlock.song_unlocked ? (
        <LockedView
          events={unlock.song_events}
          target={unlock.song_events_target}
          kind="song"
        />
      ) : (
        <div className="space-y-8">
          <SongHorizSection
            title={t('sj.charts.topRated')}
            entries={topSongs}
            showScore
          />
          <SongHorizSection
            title={t('sj.charts.mostRatedSongs')}
            entries={mostRatedSongs}
            showScore={false}
          />
          <TrendingSongsSection entries={trendingSongs} />
        </div>
      )}
    </div>
  );
}

// ── Collective unlock gauge ─────────────────────────────────────────────────

function LockedView({
  events,
  target,
  kind,
}: {
  events: number;
  target: number;
  kind: 'album' | 'song';
}) {
  const { t } = useLanguage();
  const fraction = Math.min(Math.max(events / Math.max(target, 1), 0), 1);
  return (
    <div className="flex flex-col items-center py-24 px-6 text-center">
      <FlowerGlyph size={36} className="text-accent" />
      <h2 className="mt-5 text-[17px] font-bold text-ink">
        {kind === 'album' ? t('sj.charts.lockedAlbumTitle') : t('sj.charts.lockedSongTitle')}
      </h2>
      <p className="mt-1.5 text-[13px] text-muted max-w-sm">
        {kind === 'album' ? t('sj.charts.lockedAlbumDesc') : t('sj.charts.lockedSongDesc')}
      </p>
      <div className="w-full max-w-sm mt-7">
        <div className="h-2.5 rounded-full bg-divider overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <p className="mt-2.5 text-[13px] font-semibold text-ink tabular-nums">
          {t('sj.charts.gaugeLabel')
            .replace('{n}', formatCount(events))
            .replace('{target}', formatCount(target))}
        </p>
      </div>
    </div>
  );
}

// ── Silla RankingBlock ──────────────────────────────────────────────────────

function RankingBlock() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<SillaLeaderboardRPC[]>([]);
  const [genre, setGenre] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc('get_silla_leaderboard', {
        p_genre: genre,
        p_country: country,
        p_limit: 10,
        p_offset: 0,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setEntries((data as SillaLeaderboardRPC[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [genre, country]);

  return (
    <section className="rounded-2xl bg-surface border border-divider/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Trophy size={14} className="text-accent" />
        <h2 className="text-[15px] font-bold text-ink">{t('sj.charts.ranking')}</h2>
      </div>

      {/* Filters */}
      <div className="px-4 pt-3">
        <FilterRow
          label={t('sj.charts.genre')}
          options={[[t('sj.charts.all'), null], ...GENRES.map((g) => [g, g] as [string, string])]}
          value={genre}
          onChange={setGenre}
        />
        <FilterRow
          label={t('sj.charts.country')}
          options={COUNTRIES}
          value={country}
          onChange={setCountry}
        />
      </div>

      <div className="h-px bg-divider mt-3" />

      {loading ? (
        <p className="py-10 text-center text-[13px] text-muted">…</p>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted">{t('sj.charts.noData')}</p>
      ) : (
        <ol className="divide-y divide-divider">
          {entries.map((e, i) => {
            const score = e.silla_score * 5;
            return (
              <li key={e.release_id}>
                <Link
                  href={`/album/${e.release_id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-page/60 transition"
                >
                  <span
                    className={`w-6 text-center text-[15px] font-black tabular-nums ${
                      i < 3 ? 'text-accent' : 'text-divider'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <Cover url={e.cover_url} className="w-11 h-11" rounded="rounded-lg" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {displayName(e.title, e.native_title)}
                    </span>
                    <span className="block text-[12px] text-muted truncate">
                      {displayName(e.artist, e.artist_native)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="px-2 py-0.5 rounded-full bg-accent text-white text-[11px] font-bold tabular-nums">
                      {score.toFixed(1)}
                    </span>
                    <span className="text-[9.5px] text-muted">{t('sj.charts.avg')}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <div className="h-px bg-divider" />
      <Link
        href="/charts/ranking"
        className="block py-3 text-center text-[13.5px] font-semibold text-accent hover:bg-page/60 transition"
      >
        {t('sj.charts.seeFullRanking')} →
      </Link>
    </section>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string | null][];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="mb-2">
      <p className="text-[10px] font-semibold tracking-[0.05em] uppercase text-muted mb-1.5">
        {label}
      </p>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
        {options.map(([optLabel, optValue]) => {
          const selected = value === optValue;
          return (
            <button
              key={`${optLabel}`}
              onClick={() => onChange(optValue)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition ${
                selected
                  ? 'bg-accent text-white'
                  : 'bg-page text-muted border border-divider hover:text-ink'
              }`}
            >
              {optLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Trending card ───────────────────────────────────────────────────────────

function TrendingCard({
  entries,
  mode,
  onMode,
  hasForYou,
}: {
  entries: ChartTrendingRPC[];
  mode: 'global' | 'forYou';
  onMode: (m: 'global' | 'forYou') => void;
  hasForYou: boolean;
}) {
  const { t } = useLanguage();
  return (
    <section className="rounded-2xl bg-surface border border-divider/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink">
          <Flame size={14} className="text-accent" />
          {t('sj.charts.trending')}
        </h2>
        {hasForYou && (
          <div className="flex rounded-lg bg-ink/[0.06] p-0.5">
            {(['global', 'forYou'] as const).map((m) => (
              <button
                key={m}
                onClick={() => onMode(m)}
                className={`px-2 py-1 rounded-md text-[10px] font-bold transition ${
                  mode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted'
                }`}
              >
                {m === 'global' ? t('sj.charts.global') : t('sj.charts.forYou')}
              </button>
            ))}
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">{t('sj.charts.noData')}</p>
      ) : (
        <ol className="divide-y divide-divider">
          {entries.slice(0, 5).map((e, i) => (
            <li key={e.release_id}>
              <Link
                href={`/album/${e.release_id}`}
                className="flex items-center gap-2.5 py-2 group"
              >
                <span className="w-4 text-right text-[12px] font-bold text-muted">{i + 1}</span>
                <Cover url={e.cover_url} className="w-[46px] h-[46px]" rounded="rounded-lg" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-ink truncate group-hover:underline">
                    {displayName(e.title, e.native_title)}
                  </span>
                  <span className="block text-[11px] text-muted truncate">
                    {displayName(e.artist, e.artist_native)}
                    {e.new_count != null &&
                      ` · +${e.new_count} ${t('sj.charts.thisWeek')}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <Link
        href="/charts/trending"
        className="block mt-2 text-center text-[12px] font-semibold text-accent hover:opacity-80"
      >
        {t('sj.charts.viewAll')}
      </Link>
    </section>
  );
}

// ── Insight cards ───────────────────────────────────────────────────────────

function InsightCard({
  icon,
  title,
  subtitle,
  slug,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  slug: string;
}) {
  return (
    <Link
      href={`/charts/${slug}`}
      className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-surface border border-divider/60 hover:border-muted transition"
    >
      {icon}
      <span className="text-[13px] font-bold text-ink">{title}</span>
      <span className="text-[10.5px] text-muted leading-snug">{subtitle}</span>
    </Link>
  );
}

// ── Pulse ───────────────────────────────────────────────────────────────────

function PulseCard({ pulse }: { pulse: ChartsPulseRPC | null }) {
  const { t } = useLanguage();
  return (
    <section className="flex rounded-2xl bg-surface border border-divider/60 py-3.5">
      <PulseStat value={formatCount(pulse?.total_ratings)} label={t('sj.charts.totalRatings')} />
      <span className="w-px bg-divider" />
      <PulseStat
        value={pulse?.avg_score != null ? pulse.avg_score.toFixed(2) : '—'}
        label={t('sj.charts.communityAvg')}
      />
      <span className="w-px bg-divider" />
      <PulseStat value={formatCount(pulse?.today_count)} label={t('sj.charts.ratedToday')} />
    </section>
  );
}

function PulseStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 text-center">
      <p className="text-[16px] font-black text-accent tabular-nums">{value}</p>
      <p className="text-[9.5px] text-muted mt-0.5">{label}</p>
    </div>
  );
}

// ── Horizontal album section ────────────────────────────────────────────────

function ChartHorizSection({
  title,
  entries,
  slug,
  showScore,
}: {
  title: string;
  entries: ChartRankedRPC[];
  slug: string;
  showScore: boolean;
}) {
  const { t } = useLanguage();
  if (entries.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        <Link
          href={`/charts/${slug}`}
          className="text-[12px] font-semibold text-accent hover:opacity-80"
        >
          {t('sj.charts.viewAll')}
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {entries.slice(0, 20).map((e, i) => (
          <Link key={e.release_id} href={`/album/${e.release_id}`} className="w-28 shrink-0 group">
            <div className="relative">
              <Cover url={e.cover_url} className="w-28 h-28" rounded="rounded-[10px]" />
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-black">
                #{i + 1}
              </span>
              {showScore && e.avg_score != null && (
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-accent text-white text-[10px] font-black tabular-nums">
                  {e.avg_score.toFixed(1)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] font-semibold text-ink truncate group-hover:underline">
              {displayName(e.title, e.native_title)}
            </p>
            <p className="text-[10px] text-muted truncate">
              {displayName(e.artist, e.artist_native)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Song sections ───────────────────────────────────────────────────────────

function SongHorizSection({
  title,
  entries,
  showScore,
}: {
  title: string;
  entries: SongChartRPC[];
  showScore: boolean;
}) {
  const { t } = useLanguage();
  return (
    <section>
      <h2 className="text-[15px] font-bold text-ink mb-2.5">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted">{t('sj.charts.noData')}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
          {entries.slice(0, 20).map((e, i) => {
            const albumTitle = displayName(e.album_title, e.album_title_native);
            return (
              <Link
                key={`${e.release_id}-${e.track_position}`}
                href={`/album/${e.release_id}`}
                className="w-28 shrink-0 group"
              >
                <div className="relative">
                  <Cover url={e.cover_url} className="w-28 h-28" rounded="rounded-[10px]" />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-black">
                    #{i + 1}
                  </span>
                  {showScore && e.avg_score != null && (
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-accent text-white text-[10px] font-black tabular-nums">
                      {e.avg_score.toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] font-semibold text-ink truncate group-hover:underline">
                  {e.track_title}
                </p>
                <p className="text-[10px] text-muted truncate">
                  {displayName(e.artist, e.artist_native)}
                </p>
                <p className="text-[9px] text-muted/70 truncate">{albumTitle}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TrendingSongsSection({ entries }: { entries: TrendingSongRPC[] }) {
  const { t } = useLanguage();
  return (
    <section className="max-w-2xl">
      <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink mb-2.5">
        <Flame size={14} className="text-accent" />
        {t('sj.charts.trending')}
      </h2>
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted">{t('sj.charts.noData')}</p>
      ) : (
        <ol className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
          {entries.slice(0, 10).map((e, i) => (
            <li key={`${e.release_id}-${e.track_position}`}>
              <Link
                href={`/album/${e.release_id}`}
                className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-page/60 transition"
              >
                <span className="w-4 text-right text-[12px] font-bold text-muted">{i + 1}</span>
                <Cover url={e.cover_url} className="w-[38px] h-[38px]" rounded="rounded-md" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-semibold text-ink truncate">
                    {e.track_title}
                  </span>
                  <span className="block text-[10px] text-muted truncate">
                    {displayName(e.artist, e.artist_native)} ·{' '}
                    {displayName(e.album_title, e.album_title_native)}
                  </span>
                </span>
                {e.new_count != null && (
                  <span className="text-right">
                    <span className="block text-[11px] font-bold text-ink">+{e.new_count}</span>
                    <span className="block text-[8px] text-muted">{t('sj.charts.thisWeek')}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
