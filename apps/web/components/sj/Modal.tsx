'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Centered dialog — the desktop translation of iOS's presentation sheets.
 * Mobile used bottom sheets as its default navigation container; on web a
 * modal is reserved for genuinely transient actions (rating, comments, mix
 * picking, reporting). Esc / backdrop click dismiss.
 */
export default function Modal({
  open,
  onClose,
  children,
  title,
  maxWidth = 'max-w-md',
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  maxWidth?: string;
  showClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Portal to <body> so the dialog escapes whatever stacking context / transform
  // it was rendered from. Without this, a Modal opened from inside a card (e.g.
  // AlbumRateButton's Instinct sheet, nested in a feed card's <Link>) is trapped
  // in that card's context and the card's own score badges / titles paint over it.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      // A portal moves the DOM to <body>, but React still bubbles events through
      // the *component* tree — so a click inside a modal opened from within a
      // card's <Link> would bubble to that Link and navigate (e.g. closing the
      // Instinct sheet jumped to the album page). Stop every click here so no
      // modal ever leaks interactions to whatever rendered it.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/45 sj-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${maxWidth} bg-page rounded-t-2xl sm:rounded-2xl shadow-2xl border border-divider max-h-[88vh] overflow-y-auto scrollbar-hide sj-modal-in`}
      >
        {(title || showClose) && (
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-page border-b border-divider">
            <h2 className="text-[15px] font-semibold text-ink">{title ?? ''}</h2>
            {showClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 -mr-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
