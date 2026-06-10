'use client';

import Link from 'next/link';
import type { AlbumRelease } from '../types';
import type { ReleaseStats } from './DiscographyGrid';
import QuickAddButton from './QuickAddButton';

interface Props {
  releases: AlbumRelease[];
  statsMap: Record<string, ReleaseStats>;
}

export default function TopReleases({ releases, statsMap }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[18px]">
      {releases.map((r, idx) => {
        const s = statsMap[r.id];
        return (
          <Link key={r.id} href={`/album/${r.id}`} className="block group">
            <div className="relative rounded-[8px] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
              {r.coverUrl ? (
                <img
                  src={r.coverUrl}
                  alt={r.title}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 bg-surface border border-divider" />
              )}
              <div className="absolute top-2 left-2 w-[22px] h-[22px] rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-[11px] font-bold text-white/90">
                {idx + 1}
              </div>
              {s?.avgScore && (
                <div className="absolute bottom-2 right-2 px-2 py-[3px] rounded-[5px] bg-black/60 backdrop-blur-sm text-[12px] font-bold text-white">
                  ★ {s.avgScore.toFixed(1)}
                </div>
              )}
              <div className="absolute top-2 right-2">
                <QuickAddButton
                  albumId={r.id}
                  albumTitle={r.title}
                  albumArtist={r.artist}
                  coverUrl={r.coverUrl}
                  overlay
                />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-[13px] font-semibold text-ink truncate group-hover:text-mint-dark transition">
                {r.title}
              </div>
              <div className="text-[11px] text-muted mt-0.5">
                {r.date?.slice(0, 4)}
                {s && s.count > 0 && ` · ${s.count} rating${s.count !== 1 ? 's' : ''}`}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
