'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import type { AlbumRelease } from '../types';
import { usePlaylist } from './PlaylistContext';
import CollectionPickerPopover from './CollectionPickerPopover';

const CARD_WIDTH = 180;
const CARD_GAP = 18;
const SCROLL_CARDS = 4;
const SCROLL_PX = (CARD_WIDTH + CARD_GAP) * SCROLL_CARDS;
function BookmarkOverlay({ albumId }: { albumId: string }) {
  const { userId } = usePlaylist();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const key = userId ? `sillajuku:listen-later:${userId}` : 'sillajuku:listen-later';
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    setSaved(ids.includes(albumId));
  }, [albumId, userId]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = userId ? `sillajuku:listen-later:${userId}` : 'sillajuku:listen-later';
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    const next = ids.includes(albumId) ? ids.filter((id) => id !== albumId) : [...ids, albumId];
    localStorage.setItem(key, JSON.stringify(next));
    setSaved(!saved);
  };

  return (
    <button
      onClick={toggle}
      title={saved ? 'Remove from Listen Later' : 'Save to Listen Later'}
      className={`w-7 h-7 rounded-full flex items-center justify-center transition backdrop-blur-sm ${
        saved ? 'bg-[#E8A020] text-white shadow-sm' : 'bg-black/40 text-white/80 hover:bg-black/60'
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}

function QuickAdd({ album }: { album: AlbumRelease }) {
  const { addToActive, activeListName, activeListId, userId } = usePlaylist();
  const [added, setAdded] = useState(false);
  const [picker, setPicker] = useState<{ rect: DOMRect; dest: string | null } | null>(null);

  if (!userId) return null;

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    await addToActive(album.id, album.title, album.artist, album.coverUrl);
    setAdded(true);
    setPicker({ rect, dest: activeListId });
  };

  return (
    <>
      <button
        onClick={(e) => void handleAdd(e)}
        title={`Add to ${activeListName}`}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition backdrop-blur-sm ${
          added
            ? 'bg-[#E8A020] text-white shadow-sm'
            : 'bg-black/40 text-white/80 hover:bg-black/60'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          {added ? (
            <polyline points="20 6 9 17 4 12" />
          ) : (
            <>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </>
          )}
        </svg>
      </button>
      {picker && (
        <CollectionPickerPopover
          item={{ releaseId: album.id, title: album.title, artist: album.artist, coverUrl: album.coverUrl }}
          anchorRect={picker.rect}
          dest={picker.dest}
          onDestChange={(dest) => setPicker((p) => (p ? { ...p, dest } : p))}
          onClose={() => { setPicker(null); setAdded(false); }}
        />
      )}
    </>
  );
}

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
        className="absolute left-0 top-[90px] z-10 -translate-x-1/2 -translate-y-1/2 hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-page border border-divider shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
        aria-label="Scroll left"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div ref={scrollRef} className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-[18px] pb-2">
          {albums.map((album) => (
            <Link
              key={album.id}
              href={`/album/${album.id}`}
              className="flex-shrink-0 w-[140px] md:w-[180px] group/card"
            >
              <div className="relative w-[140px] h-[140px] md:w-[180px] md:h-[180px] flex-shrink-0 rounded-[7px] overflow-hidden">
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-surface border border-divider" />
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                  <span className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold">
                    Rate →
                  </span>
                </div>
                {/* Top-right: bookmark + add buttons */}
                <div
                  className="absolute top-[6px] right-[6px] flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity"
                  onClick={(e) => e.preventDefault()}
                >
                  <QuickAdd album={album} />
                  <BookmarkOverlay albumId={album.id} />
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
        className="absolute right-0 top-[90px] z-10 translate-x-1/2 -translate-y-1/2 hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-page border border-divider shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
        aria-label="Scroll right"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
