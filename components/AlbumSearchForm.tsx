'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { AlbumRelease } from '../types';
import type { SpotifyArtist } from '../lib/spotify';

type FilterType = 'All' | 'Albums' | 'EPs' | 'Singles' | 'Live';
const FILTERS: FilterType[] = ['All', 'Albums', 'EPs', 'Singles', 'Live'];

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-[11px] font-medium text-muted">
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
          : 'bg-surface border-[#EBEBEB] text-muted hover:text-mid'
      }`}
    >
      {children}
    </button>
  );
}

export default function AlbumSearchForm() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('All');
  const [releases, setReleases] = useState<AlbumRelease[]>([]);
  const [artistMatch, setArtistMatch] = useState<SpotifyArtist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setError(null);
    setLoading(true);
    setSearched(true);
    setReleases([]);
    setArtistMatch(null);

    try {
      const [relRes, artRes] = await Promise.all([
        fetch(`/api/search?query=${encodeURIComponent(q)}&type=releases`),
        fetch(`/api/search?query=${encodeURIComponent(q)}&type=artists`),
      ]);
      const relData = await relRes.json();
      const artData = await artRes.json();

      const allReleases: AlbumRelease[] = relData.releases ?? [];
      setReleases(allReleases);
      setTotalCount(allReleases.length);

      const artists: SpotifyArtist[] = artData.artists ?? [];
      if (artists.length > 0) setArtistMatch(artists[0]);
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
      {/* Search bar area */}
      <div className="bg-surface border-b border-[#EBEBEB] px-0 py-6">
        <div className="max-w-[1440px] mx-auto px-5">
          {/* Active search bar */}
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
            className="mb-4"
          >
            <div
              className="flex items-center gap-3 bg-white rounded-full px-5 py-[11px] max-w-[520px]"
              style={{ border: `1.5px solid ${query ? '#111111' : '#EBEBEB'}` }}
            >
              <span className="text-muted" style={{ fontSize: 16 }}>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search albums, artists…"
                className="flex-1 bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-[#C0C0BE]"
              />
            </div>
          </form>

          {/* Artist match card */}
          {artistMatch && (
            <Link
              href={`/artist/${artistMatch.id}`}
              className="inline-flex items-center gap-[14px] mb-4 px-[18px] py-3 rounded-[10px] hover:opacity-90 transition"
              style={{ background: '#EDFFF9', border: '1.5px solid #3DFFD1' }}
            >
              <div
                className="w-[42px] h-[42px] rounded-full flex-shrink-0 flex items-center justify-center font-bold text-mint-dark text-[16px] overflow-hidden"
                style={{ background: '#EDFFF9', border: '2px solid #3DFFD1' }}
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
                View artist page →
              </div>
            </Link>
          )}

          {/* Filter chips */}
          <div className="flex gap-2 items-center flex-wrap">
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f}
              </Chip>
            ))}
            <div className="flex-1" />
            {searched && !loading && (
              <span className="text-[12px] text-muted">{filteredReleases.length} results</span>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        {loading && <p className="text-sm text-muted">Searching…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && searched && filteredReleases.length === 0 && !error && (
          <p className="text-sm text-muted">No results found.</p>
        )}

        {filteredReleases.length > 0 && (
          <div className="grid gap-[22px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
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
                    <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
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
