'use client';

import { useRef } from 'react';
import Link from 'next/link';
import type { AlbumRelease } from '../types';

const CARD_WIDTH = 180;
const CARD_GAP = 18;
const SCROLL_CARDS = 4;
const SCROLL_PX = (CARD_WIDTH + CARD_GAP) * SCROLL_CARDS;

export default function ScrollRow({ albums }: { albums: AlbumRelease[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;

    if (direction === 'right') {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      if (atEnd) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: SCROLL_PX, behavior: 'smooth' });
      }
    } else {
      const atStart = el.scrollLeft <= 4;
      if (atStart) {
        el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: -SCROLL_PX, behavior: 'smooth' });
      }
    }
  };

  return (
    <div className="group relative">
      {/* Left arrow */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-[90px] z-10 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-[#EBEBEB] shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
        aria-label="Scroll left"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div ref={scrollRef} className="overflow-x-hidden scrollbar-hide">
        <div className="flex gap-[18px] pb-2">
          {albums.map((album) => (
            <Link
              key={album.id}
              href={`/album/${album.id}`}
              className="flex-shrink-0 w-[180px] group/card"
            >
              <div className="relative w-[180px] h-[180px] flex-shrink-0 rounded-[7px] overflow-hidden">
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
                )}
                <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                  <span className="bg-ink text-white rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold">
                    Rate →
                  </span>
                </div>
              </div>
              <div className="mt-[9px]">
                <div className="text-[13px] font-semibold text-ink truncate leading-snug">
                  {album.title}
                </div>
                <div className="text-[12px] text-muted mt-0.5 truncate">
                  {album.artist}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-[90px] z-10 translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-[#EBEBEB] shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
        aria-label="Scroll right"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
