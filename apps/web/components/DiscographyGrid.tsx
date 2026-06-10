'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AlbumRelease } from '../types';
import QuickAddButton from './QuickAddButton';

type FilterType = 'All' | 'Albums' | 'EPs' | 'Singles';
const FILTERS: FilterType[] = ['All', 'Albums', 'EPs', 'Singles'];

export interface ReleaseStats {
  avgScore: number | null;
  count: number;
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-[14px] py-[10px] rounded-full text-[12px] font-semibold border transition ${
        active
          ? 'bg-mint-dark border-mint-dark text-white'
          : 'bg-surface border-divider text-muted hover:text-mid'
      }`}
    >
      {children}
    </button>
  );
}

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-divider text-[12px] font-medium text-muted">
      {children}
    </span>
  );
}

interface Props {
  initialReleases: AlbumRelease[];
  initialNextCursor: string | null;
  stats?: Record<string, ReleaseStats>;
}

export default function DiscographyGrid({ initialReleases, initialNextCursor, stats }: Props) {
  const [releases, setReleases] = useState<AlbumRelease[]>(initialReleases);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('All');
  const [seen] = useState(
    () => new Set(initialReleases.map((r) => `${r.title.toLowerCase()}::${r.releaseType}`))
  );

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/artist-albums?cursor=${encodeURIComponent(nextCursor)}`);
      const data = await res.json();
      const fresh = (data.releases as AlbumRelease[]).filter((r) => {
        const key = `${r.title.toLowerCase()}::${r.releaseType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setReleases((prev) => [...prev, ...fresh].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  };

  const filtered = releases.filter((r) => {
    if (filter === 'All') return true;
    if (filter === 'Albums') return r.releaseType === 'Album';
    if (filter === 'EPs') return r.releaseType === 'EP';
    if (filter === 'Singles') return r.releaseType === 'Single';
    return true;
  });

  return (
    <div>
      <div className="flex gap-2 items-center mb-7 flex-wrap">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </Chip>
        ))}
        <span className="ml-auto text-[12px] text-muted">{filtered.length} releases</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">
          {releases.length === 0
            ? 'Discography temporarily unavailable. Check back soon.'
            : 'No releases in this category.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-[22px]">
          {filtered.map((release) => {
            const releaseStats = stats?.[release.id];
            return (
              <Link key={release.id} href={`/album/${release.id}`} className="block min-w-0 group">
                <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: '1 / 1' }}>
                  {release.coverUrl ? (
                    <img
                      src={release.coverUrl}
                      alt={release.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-surface border border-divider" />
                  )}
                  {releaseStats?.avgScore && (
                    <div className="absolute bottom-2 right-2 px-[7px] py-[3px] rounded-[5px] bg-black/60 backdrop-blur-sm text-[11px] font-bold text-white">
                      ★ {releaseStats.avgScore.toFixed(1)}
                    </div>
                  )}
                  <div className="absolute top-[6px] right-[6px]">
                    <QuickAddButton
                      albumId={release.id}
                      albumTitle={release.title}
                      albumArtist={release.artist}
                      coverUrl={release.coverUrl}
                      overlay
                    />
                  </div>
                </div>
                <div className="mt-[9px]">
                  <div className="text-[13px] font-semibold text-ink truncate group-hover:text-mint-dark transition-colors">{release.title}</div>
                  <div className="text-[12px] text-muted mt-0.5 flex items-center gap-1.5">
                    <span>{release.date?.slice(0, 4) ?? '—'}</span>
                    {releaseStats && releaseStats.count > 0 && (
                      <span className="text-subtle">· {releaseStats.count}</span>
                    )}
                  </div>
                  <div className="mt-[5px]">
                    <TypePill>{release.releaseType}</TypePill>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="mt-9 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border border-divider px-6 py-[10px] text-[13px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50 disabled:cursor-wait"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
