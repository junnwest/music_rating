'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, MoreHorizontal } from 'lucide-react';
import { useSession } from './SessionContext';
import { useLanguage } from '../../lib/i18n';
import { markNotInterested } from '../../lib/sj/notInterested';

/**
 * The app's shared overflow (…) menu for an album, plus the menu *surface* it
 * renders into.
 *
 * `OverflowMenuSurface` is deliberately split out and positioned from a plain
 * viewport point rather than a button: the same surface backs this button menu
 * and the right-click menu, which anchors at the cursor. It portals to
 * `document.body` so a menu opened from inside a list row or a `overflow-hidden`
 * cover can't be clipped, and it clamps itself to the viewport.
 *
 * The one built-in action is **Not interested** — a negative signal for the
 * recommender (`not_interested`, migration 20260719000000). Callers pass extra
 * items via `items`; they render above the built-in one.
 */

export interface OverflowItem {
  key: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

const MENU_W = 220;
const EDGE = 8;

export function OverflowMenuSurface({
  x,
  y,
  items,
  onClose,
  align = 'right',
}: {
  /** Viewport x of the anchor edge — the menu's right edge when `align` is 'right'. */
  x: number;
  /** Viewport y the menu's top edge starts at. */
  y: number;
  items: OverflowItem[];
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Deferred so the very click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  if (typeof document === 'undefined' || items.length === 0) return null;

  // Clamp so a menu opened near an edge stays fully on screen.
  const left =
    align === 'right'
      ? Math.min(Math.max(EDGE, x - MENU_W), window.innerWidth - MENU_W - EDGE)
      : Math.min(Math.max(EDGE, x), window.innerWidth - MENU_W - EDGE);
  const maxTop = window.innerHeight - items.length * 38 - 16 - EDGE;
  const top = Math.max(EDGE, Math.min(y, maxTop));

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[120] py-1.5 rounded-xl bg-surface border border-divider shadow-xl sj-pop-in"
      style={{ left, top, width: MENU_W }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          role="menuitem"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            item.onSelect();
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition hover:bg-page ${
            item.destructive ? 'text-red-500' : 'text-ink'
          }`}
        >
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function AlbumOverflowMenu({
  releaseGroupId,
  onNotInterested,
  items = [],
  size = 26,
  className = '',
}: {
  releaseGroupId: string;
  /** Called after the row is written — the surface hides/dims the card itself. */
  onNotInterested?: () => void;
  /** Extra actions, rendered above "Not interested". */
  items?: OverflowItem[];
  size?: number;
  className?: string;
}) {
  const { userId } = useSession();
  const { t } = useLanguage();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!userId) return null;

  const menuItems: OverflowItem[] = [
    ...items,
    {
      key: 'not-interested',
      label: t('sj.notInterested.action'),
      icon: <EyeOff size={15} />,
      onSelect: () => {
        // Optimistic: the caller drops the card now, the write follows.
        onNotInterested?.();
        void markNotInterested(userId, releaseGroupId);
      },
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t('sj.common.moreOptions')}
        aria-haspopup="menu"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.right, y: rect.bottom + 6 });
        }}
        className={`flex items-center justify-center rounded-full bg-black/55 text-white shadow backdrop-blur-sm transition hover:bg-black/70 active:scale-95 ${className}`}
        style={{ width: size, height: size }}
      >
        <MoreHorizontal size={Math.round(size * 0.56)} strokeWidth={2} />
      </button>

      {anchor && (
        <OverflowMenuSurface
          x={anchor.x}
          y={anchor.y}
          items={menuItems}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
