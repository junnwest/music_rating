'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Trophy } from 'lucide-react';
import Cover from '../../../../components/sj/Cover';
import AlbumRateButton from '../../../../components/sj/AlbumRateButton';
import AlbumBookmarkButton from '../../../../components/sj/AlbumBookmarkButton';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName, formatCount } from '../../../../lib/sj/display';
import { fetchSillaLeaderboard } from '../../../../lib/sj/sillaClient';
import type {
  ChartRankedRPC,
  ChartTrendingRPC,
  SillaLeaderboardRPC,
} from '../../../../lib/db/types';

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

interface Entry {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  avgScore: number | null;
  ratingCount: number | null;
  newCount: number | null;
  releaseType: string | null;
  releaseDate: string | null;
}

type Slug = 'top-rated' | 'most-rated' | 'hidden-gems' | 'controversial' | 'trending' | 'ranking';

/**
 * Chart drill-down — web sibling of iOS ChartDetailView / RankingDetailView.
 * `ranking` = the full Silla leaderboard with genre/country filters; the
 * rest are the community chart RPCs. Podium for the top 3, list below.
 */
export default function ChartDetailPage() {
  return (
    <Suspense>
      <ChartDetailInner />
    </Suspense>
  );
}

function ChartDetailInner() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug as Slug;
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  // Deep-linkable genre (album pages link their genre pills here)
  const [genre, setGenre] = useState<string | null>(searchParams.get('genre'));
  const [country, setCountry] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [era, setEra] = useState<string | null>(null);

  const isRanking = slug === 'ranking';
  const isTrending = slug === 'trending';

  const titles: Record<Slug, string> = {
    'top-rated': t('sj.charts.topRated'),
    'most-rated': t('sj.charts.mostRated'),
    'hidden-gems': t('sj.charts.hiddenGems'),
    controversial: t('sj.charts.controversial'),
    trending: t('sj.charts.trending'),
    ranking: t('sj.charts.ranking'),
  };

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let loaded: Entry[] = [];
      if (isRanking) {
        // Via the cached API route — the RPC itself outruns the anon timeout.
        const data = await fetchSillaLeaderboard(genre, country, 100).catch(
          () => [] as SillaLeaderboardRPC[],
        );
        loaded = data.map((r) => ({
          id: r.release_id,
          title: displayName(r.title, r.native_title),
          artist: displayName(r.artist, r.artist_native),
          coverUrl: r.cover_url,
          // silla_score is [0,1]; ×5 so the badge reads on the rating axis
          avgScore: r.silla_score * 5,
          ratingCount: r.rating_count,
          newCount: null,
          releaseType: r.release_group_type ?? null,
          releaseDate: r.release_date ?? null,
        }));
      } else if (isTrending) {
        const { data } = await supabase!.rpc('get_charts_trending', { p_limit: 50 });
        loaded = ((data as ChartTrendingRPC[] | null) ?? []).map((r) => ({
          id: r.release_id,
          title: displayName(r.title, r.native_title),
          artist: displayName(r.artist, r.artist_native),
          coverUrl: r.cover_url,
          avgScore: null,
          ratingCount: null,
          newCount: r.new_count,
          releaseType: null,
          releaseDate: null,
        }));
      } else {
        const rpc =
          slug === 'top-rated'
            ? 'get_charts_top_rated'
            : slug === 'most-rated'
              ? 'get_charts_most_rated'
              : slug === 'hidden-gems'
                ? 'get_charts_hidden_gems'
                : 'get_charts_controversial';
        const { data } = await supabase!.rpc(rpc, { p_limit: 50 });
        loaded = ((data as ChartRankedRPC[] | null) ?? []).map((r) => ({
          id: r.release_id,
          title: displayName(r.title, r.native_title),
          artist: displayName(r.artist, r.artist_native),
          coverUrl: r.cover_url,
          avgScore: r.avg_score,
          ratingCount: r.rating_count,
          newCount: null,
          releaseType: null,
          releaseDate: null,
        }));
      }
      if (!cancelled) {
        setEntries(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, genre, country, isRanking, isTrending]);

  // Client-side refinements on the fetched ranking (the RPC returns
  // release_group_type + release_date since 20260706000018)
  const visible = !isRanking
    ? entries
    : entries.filter((e) => {
        if (typeFilter && (e.releaseType ?? '').toLowerCase() !== typeFilter) return false;
        if (era) {
          const year = e.releaseDate ? parseInt(e.releaseDate.slice(0, 4), 10) : NaN;
          if (Number.isNaN(year)) return false;
          if (era === 'old') {
            if (year >= 1990) return false;
          } else {
            const start = parseInt(era, 10);
            if (year < start || year > start + 9) return false;
          }
        }
        return true;
      });

  const showPodium = visible.length >= 3 && !isTrending;
  const listOffset = showPodium ? 3 : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/charts" className="text-[13px] text-muted hover:text-ink transition">
          {t('sj.charts.title')}
        </Link>
        <span className="text-muted text-[13px]">/</span>
        <h1 className="text-[20px] font-bold text-ink">{titles[slug] ?? slug}</h1>
      </div>

      {isRanking && (
        <div className="mb-4 space-y-2">
          <FilterChips
            options={[
              [t('sj.charts.all'), null],
              ...GENRES.map((g) => [g, g] as [string, string]),
              ...(genre && !GENRES.includes(genre) ? [[genre, genre] as [string, string]] : []),
            ]}
            value={genre}
            onChange={setGenre}
          />
          <FilterChips options={COUNTRIES} value={country} onChange={setCountry} />
          <FilterChips
            options={[
              [t('sj.charts.all'), null],
              [t('sj.type.album'), 'album'],
              [t('sj.type.ep'), 'ep'],
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
          <FilterChips
            options={[
              [t('sj.charts.all'), null],
              ['2020s', '2020'],
              ['2010s', '2010'],
              ['2000s', '2000'],
              ['1990s', '1990'],
              [t('sj.charts.older'), 'old'],
            ]}
            value={era}
            onChange={setEra}
          />
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-muted text-[13px]">…</div>
      ) : visible.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <Trophy size={36} className="text-divider" />
          <p className="text-[14px] text-muted">{t('sj.charts.noData')}</p>
        </div>
      ) : (
        <>
          {showPodium && <Podium entries={visible.slice(0, 3)} />}
          <ol className="mt-4 rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
            {visible.slice(listOffset).map((e, i) => (
              <li key={e.id}>
                <Link
                  href={`/album/${e.id}`}
                  className="group flex items-center gap-3 px-4 py-2.5 hover:bg-page/60 transition"
                >
                  <span className="w-7 text-right text-[12px] font-bold text-muted tabular-nums">
                    {i + listOffset + 1}
                  </span>
                  <span className="relative shrink-0">
                    <Cover url={e.coverUrl} className="w-10 h-10" rounded="rounded-md" />
                    <AlbumBookmarkButton
                      releaseGroupId={e.id}
                      size={18}
                      className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
                    />
                    <AlbumRateButton
                      release={{
                        id: e.id,
                        title: e.title,
                        artist: e.artist,
                        coverUrl: e.coverUrl,
                        releaseType: null,
                        releaseDate: null,
                        titleNative: null,
                        artistNative: null,
                      }}
                      size={20}
                      className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
                    />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {e.title}
                    </span>
                    <span className="block text-[11px] text-muted truncate">{e.artist}</span>
                  </span>
                  <span className="text-right">
                    {isTrending && e.newCount != null ? (
                      <>
                        <span className="block text-[13px] font-bold text-ink">+{e.newCount}</span>
                        <span className="block text-[9px] text-muted">
                          {t('sj.charts.thisWeek')}
                        </span>
                      </>
                    ) : e.avgScore != null ? (
                      <>
                        <span className="block text-[14px] font-bold text-ink tabular-nums">
                          {e.avgScore.toFixed(1)}
                        </span>
                        {e.ratingCount != null && (
                          <span className="block text-[9px] text-muted">
                            {formatCount(e.ratingCount)}
                          </span>
                        )}
                      </>
                    ) : e.ratingCount != null ? (
                      <>
                        <span className="block text-[13px] font-bold text-ink">
                          {formatCount(e.ratingCount)}
                        </span>
                        <span className="block text-[9px] text-muted">
                          {t('sj.album.ratings').toLowerCase()}
                        </span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function FilterChips({
  options,
  value,
  onChange,
}: {
  options: [string, string | null][];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
      {options.map(([label, optValue]) => {
        const selected = value === optValue;
        return (
          <button
            key={label}
            onClick={() => onChange(optValue)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition ${
              selected
                ? 'bg-accent text-white'
                : 'bg-surface text-muted border border-divider hover:text-ink'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Podium({ entries }: { entries: Entry[] }) {
  // #2 left (shorter) · #1 center (tallest) · #3 right
  const order = [
    { entry: entries[1], rank: 2, size: 'w-24 h-24' },
    { entry: entries[0], rank: 1, size: 'w-32 h-32' },
    { entry: entries[2], rank: 3, size: 'w-24 h-24' },
  ];
  return (
    <div className="flex items-end justify-center gap-4 py-4">
      {order.map(({ entry, rank, size }) => (
        <Link
          key={entry.id}
          href={`/album/${entry.id}`}
          className="flex flex-col items-center gap-1.5 w-32 group"
        >
          <div className="relative">
            <Cover url={entry.coverUrl} className={size} rounded="rounded-xl" />
            {rank === 1 ? (
              <span className="absolute top-1.5 left-1.5 flex w-6 h-6 rounded-md bg-accent items-center justify-center">
                <Trophy size={11} className="text-white" />
              </span>
            ) : (
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-black">
                #{rank}
              </span>
            )}
          </div>
          {entry.avgScore != null && (
            <span
              className={`text-[14px] font-black tabular-nums ${rank === 1 ? 'text-accent' : 'text-ink'}`}
            >
              {entry.avgScore.toFixed(1)}
            </span>
          )}
          <span className="text-[10.5px] font-semibold text-ink text-center truncate w-full group-hover:underline">
            {entry.title}
          </span>
          <span className="text-[9.5px] text-muted text-center truncate w-full">
            {entry.artist}
          </span>
        </Link>
      ))}
    </div>
  );
}
