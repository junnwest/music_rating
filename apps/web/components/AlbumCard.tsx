'use client';

import Link from 'next/link';
import type { AlbumRelease } from '../types';

export default function AlbumCard({ release }: { release: AlbumRelease }) {
  return (
    <Link
      href={`/album/${release.id}`}
      className="flex items-center gap-4 py-3 hover:bg-slate-50 transition-colors rounded-lg px-2 -mx-2 group"
    >
      {/* Cover */}
      <div className="flex-shrink-0 w-12 h-12 rounded-md overflow-hidden bg-slate-100">
        {release.coverUrl ? (
          <img
            src={release.coverUrl}
            alt={release.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-slate-200" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate group-hover:text-slate-700">{release.title}</p>
        {release.titleNative && release.titleNative.toLowerCase() !== release.title.toLowerCase() && (
          <p className="text-xs text-slate-400 truncate">{release.titleNative}</p>
        )}
        <p className="text-xs text-slate-500 truncate">
          {release.artistNative && release.artistNative.toLowerCase() !== release.artist.toLowerCase()
            ? `${release.artistNative} · ${release.artist}`
            : release.artist}
        </p>
      </div>

      {/* Meta */}
      <div className="flex-shrink-0 text-right hidden sm:block">
        <p className="text-xs text-slate-400">{release.date?.slice(0, 4) ?? '—'}</p>
        <p className="text-xs text-slate-400">{release.releaseType}</p>
      </div>
    </Link>
  );
}
