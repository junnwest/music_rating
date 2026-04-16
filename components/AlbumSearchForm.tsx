'use client';

import { FormEvent, useState } from 'react';
import AlbumCard from './AlbumCard';
import type { AlbumRelease } from '../types';

export default function AlbumSearchForm() {
  const [query, setQuery] = useState('');
  const [releases, setReleases] = useState<AlbumRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'Search failed');
      }
      setReleases(data.releases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/30">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-200">
          Search MusicBrainz releases
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by album title, artist, track, or release code"
            className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex items-center justify-center rounded-2xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <div className="mt-8 space-y-4">
        {releases.length === 0 && !loading ? (
          <p className="text-slate-400">Enter a search query to preview matching releases.</p>
        ) : (
          releases.map((release: AlbumRelease) => <AlbumCard key={release.id} release={release} />)
        )}
      </div>
    </div>
  );
}
