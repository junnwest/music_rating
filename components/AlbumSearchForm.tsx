'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AlbumCard from './AlbumCard';
import type { AlbumRelease } from '../types';
import type { SpotifyArtist, SpotifyTrack } from '../lib/spotify';

type SearchType = 'releases' | 'artists' | 'recordings';

const FILTERS: { label: string; value: SearchType }[] = [
  { label: 'Albums', value: 'releases' },
  { label: 'Artists', value: 'artists' },
  { label: 'Songs', value: 'recordings' },
];

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function AlbumSearchForm() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('releases');
  const [releases, setReleases] = useState<AlbumRelease[]>([]);
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [recordings, setRecordings] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function runSearch(q: string, t: SearchType) {
    if (!q.trim()) return;
    setError(null);
    setLoading(true);
    setSearched(true);
    setReleases([]);
    setArtists([]);
    setRecordings([]);
    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(q)}&type=${t}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      if (t === 'releases') setReleases(data.releases ?? []);
      if (t === 'artists') setArtists(data.artists ?? []);
      if (t === 'recordings') setRecordings(data.recordings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const q = searchParams.get('query') ?? '';
    if (q) {
      setQuery(q);
      runSearch(q, type);
    }
  }, [searchParams]);

  const handleTypeChange = (t: SearchType) => {
    setType(t);
    if (query.trim()) runSearch(query, t);
  };

  const hasResults =
    releases.length > 0 || artists.length > 0 || recordings.length > 0;

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-slate-100 pb-0">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleTypeChange(f.value)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
              type === f.value
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* State messages */}
      {loading && <p className="text-sm text-slate-400">Searching…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && searched && !hasResults && !error && (
        <p className="text-sm text-slate-400">No results found.</p>
      )}

      {/* Album results */}
      {releases.length > 0 && (
        <div className="divide-y divide-slate-100">
          {releases.map((release) => (
            <AlbumCard key={release.id} release={release} />
          ))}
        </div>
      )}

      {/* Artist results */}
      {artists.length > 0 && (
        <div className="divide-y divide-slate-100">
          {artists.map((artist) => (
            <div key={artist.id} className="flex items-center gap-4 py-3 px-2 -mx-2">
              <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-slate-100">
                {artist.coverUrl ? (
                  <img src={artist.coverUrl} alt={artist.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-slate-500">
                    {artist.name[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{artist.name}</p>
                {artist.genres.length > 0 && (
                  <p className="text-xs text-slate-400 truncate">{artist.genres.slice(0, 3).join(', ')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Song results */}
      {recordings.length > 0 && (
        <div className="divide-y divide-slate-100">
          {recordings.map((rec) => (
            <Link
              key={rec.id}
              href={rec.albumId ? `/album/${rec.albumId}` : '#'}
              className="flex items-center gap-4 py-3 px-2 -mx-2 hover:bg-slate-50 transition-colors rounded-lg group"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden bg-slate-100">
                {rec.coverUrl ? (
                  <img src={rec.coverUrl} alt={rec.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-slate-200" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate group-hover:text-slate-700">{rec.title}</p>
                <p className="text-xs text-slate-400 truncate">
                  {rec.artist}{rec.albumTitle && ` · ${rec.albumTitle}`}
                </p>
              </div>
              {rec.durationMs && (
                <span className="flex-shrink-0 text-xs text-slate-400 tabular-nums">
                  {formatDuration(rec.durationMs)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
