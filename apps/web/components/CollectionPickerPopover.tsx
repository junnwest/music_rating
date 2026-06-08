'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListMusic, Bookmark, ArrowRightLeft } from 'lucide-react';
import { usePlaylist } from './PlaylistContext';

export interface PickerItem {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  trackTitle?: string;
  trackPosition?: number;
}

interface Props {
  item: PickerItem;
  /** Screen-space rectangle of the trigger button, used to anchor the popover. */
  anchorRect: DOMRect;
  /** Collection the item currently lives in (null = Listen Later). */
  dest: string | null;
  onDestChange: (dest: string | null) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 224;

/**
 * Confirmation + redirect popover shown right after an item is added to the open
 * collection. Reads "Added to {collection}" and lets the user re-route it to any
 * other collection via "Change to".
 */
export default function CollectionPickerPopover({
  item, anchorRect, dest, onDestChange, onClose,
}: Props) {
  const { playlists, nameForList, addItemTo, removeItemFrom } = usePlaylist();
  const ref = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  // Position: anchored to the trigger, right-aligned, flipping above when needed.
  const left = Math.max(8, Math.min(
    anchorRect.right - POPOVER_WIDTH,
    window.innerWidth - POPOVER_WIDTH - 8,
  ));
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const placeAbove = spaceBelow < 260 && anchorRect.top > spaceBelow;
  const top = placeAbove ? undefined : anchorRect.bottom + 6;
  const bottom = placeAbove ? window.innerHeight - anchorRect.top + 6 : undefined;

  // Every collection other than the current destination.
  const targets: { id: string | null; label: string }[] = [
    ...(dest !== null ? [{ id: null, label: 'Listen Later' }] : []),
    ...playlists.filter((p) => p.id !== dest).map((p) => ({ id: p.id, label: p.title })),
  ];

  const move = async (target: string | null) => {
    if (moving) return;
    setMoving(true);
    await removeItemFrom(dest, item.releaseId, item.trackPosition);
    await addItemTo(
      target, item.releaseId, item.title, item.artist, item.coverUrl,
      item.trackTitle, item.trackPosition,
    );
    onDestChange(target);
    setMoving(false);
  };

  return createPortal(
    <>
      {/* Outside-click catcher */}
      <div className="fixed inset-0 z-[60]" onClick={onClose} />

      <div
        ref={ref}
        style={{ left, top, bottom, width: POPOVER_WIDTH }}
        className="fixed z-[61] bg-page border border-divider rounded-xl shadow-xl py-1.5 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Confirmation header */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="w-5 h-5 rounded-full bg-mint flex items-center justify-center flex-shrink-0">
            <Check size={12} className="text-mint-dark" />
          </span>
          <span className="text-[12px] text-ink min-w-0">
            Added to <span className="font-bold">{nameForList(dest)}</span>
          </span>
        </div>

        {targets.length > 0 && (
          <>
            <div className="mx-3 border-t border-divider my-1" />
            <p className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase text-muted" style={{ letterSpacing: '0.5px' }}>
              <ArrowRightLeft size={11} /> Change to
            </p>
            <div className="max-h-[220px] overflow-y-auto">
              {targets.map((t) => (
                <button
                  key={t.id ?? '__ll__'}
                  onClick={() => void move(t.id)}
                  disabled={moving}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-ink text-left hover:bg-surface transition disabled:opacity-50"
                >
                  {t.id === null
                    ? <Bookmark size={14} className="text-muted flex-shrink-0" />
                    : <ListMusic size={14} className="text-muted flex-shrink-0" />}
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
