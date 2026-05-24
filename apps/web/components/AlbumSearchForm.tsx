'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import type { AlbumRelease } from '../types';
import type { SpotifyArtist } from '../lib/spotify';
import { useLanguage } from '../lib/i18n';

type FilterKey = 'All' | 'Albums' | 'EPs' | 'Singles' | 'Live';
const FILTER_KEYS: FilterKey[] = ['All', 'Albums', 'EPs', 'Singles', 'Live'];

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-divider text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-[14px] py-[6px] rounded-full text-[12px] font-semibold border transition ${
        active
          ? 'bg-ink border-ink text-white'
          : 'bg-surface border-divider text-muted hover:text-mid'
      }`}
    >
      {children}
    </button>
  );
}

export default function AlbumSearchForm() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('All');
  const [releases, setReleases] = useState<AlbumRelease[]>([]);
  const [artistMatch, setArtistMatch] = useState<SpotifyArtist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [degraded, setDegraded] = useState(false);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setError(null);
    setLoading(true);
    setSearched(true);
    setReleases([]);
    setArtistMatch(null);
    setDegraded(false);

    try {
      const [relRes, artRes] = await Promise.all([
        fetch(`/api/search?query=${encodeURIComponent(q)}&type=releases`),
        fetch(`/api/search?query=${encodeURIComponent(q)}&type=artists`),
      ]);
      const relData = await relRes.json();
      const artData = await artRes.json();

      const allReleases: AlbumRelease[] = relData.releases ?? [];
      setReleases(allReleases);

      const artists: SpotifyArtist[] = artData.artists ?? [];
      if (artists.length > 0) setArtistMatch(artists[0]);

      setDegraded(Boolean(relData.degraded || artData.degraded));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const q = searchParams.get('query') ?? '';
    if (q) {
      setQuery(q);
      runSearch(q);
    }
  }, [searchParams]);

  const filterLabels: Record<FilterKey, string> = {
    All: t('search.filterAll'),
    Albums: t('search.filterAlbums'),
    EPs: t('search.filterEPs'),
    Singles: t('search.filterSingles'),
    Live: t('search.filterLive'),
  };

  const filteredReleases = releases.filter((r) => {
    if (filter === 'All') return true;
    if (filter === 'Albums') return r.releaseType === 'Album';
    if (filter === 'EPs') return r.releaseType === 'EP';
    if (filter === 'Singles') return r.releaseType === 'Single';
    if (filter === 'Live') return r.releaseType === 'Live';
    return true;
  });

  return (
    <div>
      {/* Filter bar — only shown when there are results */}
      {searched && (
      <div className="bg-surface border-b border-divider px-0 py-4">
        <div className="max-w-[1440px] mx-auto px-5">
          {/* Artist match card */}
          {artistMatch && (
            <Link
              href={`/artist/${artistMatch.id}`}
              className="inline-flex items-center gap-[14px] mb-4 px-[18px] py-3 rounded-[10px] hover:opacity-90 transition"
              style={{ background: '#FEF3DC', border: '1.5px solid #E8A020' }}
            >
              <div
                className="w-[42px] h-[42px] rounded-full flex-shrink-0 flex items-center justify-center font-bold text-mint-dark text-[16px] overflow-hidden"
                style={{ background: '#FEF3DC', border: '2px solid #E8A020' }}
              >
                {artistMatch.coverUrl ? (
                  <img src={artistMatch.coverUrl} alt={artistMatch.name} className="w-full h-full object-cover" />
                ) : (
                  artistMatch.name[0].toUpperCase()
                )}
              </div>
              <div>
                <div className="text-[14px] font-bold text-ink">{artistMatch.name}</div>
                {artistMatch.genres.length > 0 && (
                  <div className="text-[12px] text-muted mt-0.5">
                    {artistMatch.genres.slice(0, 3).join(', ')}
                  </div>
                )}
              </div>
              <div className="ml-3 text-[12px] font-semibold text-mint-dark">
                {t('search.viewArtist')}
              </div>
            </Link>
          )}

          {/* Filter chips */}
          <div className="flex gap-2 items-center flex-wrap">
            {FILTER_KEYS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {filterLabels[f]}
              </Chip>
            ))}
            <div className="flex-1" />
            {!loading && (
              <span className="text-[12px] text-muted">{filteredReleases.length} {t('search.results')}</span>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Results */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        {degraded && !loading && (
          <div
            className="mb-5 px-4 py-3 rounded-[8px] text-[13px] font-medium text-ink"
            style={{ background: '#FEF3DC', border: '1px solid #E8A020' }}
            role="status"
          >
            {t('search.degradedNotice')}
          </div>
        )}
        {!searched && !loading && (
          <div className="flex flex-col items-center py-24 text-center">
            <Search size={32} className="text-subtle mb-4" />
            <p className="text-[15px] font-semibold text-ink mb-1">{t('search.prompt')}</p>
            <p className="text-[13px] text-muted">{t('search.promptDesc')}</p>
          </div>
        )}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-[22px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i}>
                <div className="rounded-[7px] bg-surface animate-pulse aspect-square" />
                <div className="mt-[9px] space-y-1.5">
                  <div className="h-3 bg-surface animate-pulse rounded w-4/5" />
                  <div className="h-2.5 bg-surface animate-pulse rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && searched && filteredReleases.length === 0 && !error && (
          <div className="flex flex-col items-center py-20 text-center">
            <Search size={32} className="text-subtle mb-4" />
            <p className="text-[15px] font-semibold text-ink mb-1">{t('search.noResults')} &ldquo;{query}&rdquo;</p>
            <p className="text-[13px] text-muted">{t('search.noResultsDesc')}</p>
          </div>
        )}

        {filteredReleases.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-[22px]">
            {filteredReleases.map((release) => (
              <Link key={release.id} href={`/album/${release.id}`} className="block min-w-0">
                <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: '1 / 1' }}>
                  {release.coverUrl ? (
                    <img
                      src={release.coverUrl}
                      alt={release.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-surface border border-divider" />
                  )}
                </div>
                <div className="mt-[9px]">
                  <div className="text-[13px] font-semibold text-ink truncate">{release.title}</div>
                  <div className="text-[11px] text-muted mt-0.5 truncate">
                    {release.artist} · {release.date?.slice(0, 4) ?? '—'}
                  </div>
                  <div className="mt-[5px]">
                    <TypePill>{release.releaseType}</TypePill>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
