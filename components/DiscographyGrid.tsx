'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AlbumRelease } from '../types';

type FilterType = 'All' | 'Albums' | 'EPs' | 'Singles';
const FILTERS: FilterType[] = ['All', 'Albums', 'EPs', 'Singles'];

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

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

interface Props {
  initialReleases: AlbumRelease[];
  initialNextCursor: string | null;
}

export default function DiscographyGrid({ initialReleases, initialNextCursor }: Props) {
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
        <p className="text-sm text-muted">No releases found.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-[22px]">
          {filtered.map((release) => (
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
                <div className="text-[11px] text-muted mt-0.5">{release.date?.slice(0, 4) ?? '—'}</div>
                <div className="mt-[5px]">
                  <TypePill>{release.releaseType}</TypePill>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-9 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border border-[#EBEBEB] px-6 py-[10px] text-[13px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50 disabled:cursor-wait"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
