'use client';

import RatingForm from './RatingForm';
import type { AlbumRelease } from '../types';

interface AlbumCardProps {
  release: AlbumRelease;
}

export default function AlbumCard({ release }: AlbumCardProps) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg shadow-slate-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-brand-300">{release.releaseType}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{release.title}</h2>
          <p className="mt-1 text-slate-400">{release.artist}</p>
        </div>
        <p className="text-sm text-slate-500">{release.date ?? 'Unknown release date'}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-400">
        <span className="rounded-full border border-slate-700 px-3 py-1">MusicBrainz ID: {release.id.slice(0, 8)}...</span>
        {release.country && <span className="rounded-full border border-slate-700 px-3 py-1">{release.country}</span>}
      </div>

      <div className="mt-6">
        <RatingForm release={release} />
      </div>
    </div>
  );
}
