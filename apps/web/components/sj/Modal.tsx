'use client';

import { useEffect, type ReactNode } from 'react';
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        className={`relative w-full ${maxWidth} bg-page rounded-t-2xl sm:rounded-2xl shadow-2xl border border-divider max-h-[88vh] overflow-y-auto scrollbar-hide`}
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
    </div>
  );
}
