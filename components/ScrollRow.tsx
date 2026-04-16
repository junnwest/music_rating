'use client';

import { useRef } from 'react';
import Link from 'next/link';
import type { AlbumRelease } from '../types';

export default function ScrollRow({ albums }: { albums: AlbumRelease[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth;
    scrollRef.current.scrollBy({ left: direction === 'right' ? amount : -amount, behavior: 'smooth' });
  };

  return (
    <div className="group relative">
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/3 z-10 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-50"
        aria-label="Scroll left"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div ref={scrollRef} className="overflow-x-hidden scrollbar-hide">
        <div className="flex gap-4 pb-2">
          {albums.map((album) => (
            <Link key={album.id} href={`/album/${album.id}`} className="flex-shrink-0 w-[calc((100vw-22.5rem-4rem)/5)] group/card">
              <div className="space-y-2">
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.title}
                    className="aspect-square w-full object-cover rounded-sm transition group-hover/card:brightness-90"
                  />
                ) : (
                  <div className="aspect-square w-full bg-slate-200 rounded-sm" />
                )}
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-900 line-clamp-2 group-hover/card:underline">{album.title}</p>
                  <p className="text-xs text-slate-600">{album.date?.slice(0, 4)} · {album.artist}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/3 z-10 translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-50"
        aria-label="Scroll right"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

    </div>
  );
}
