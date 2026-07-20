'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { OverflowMenuSurface, type OverflowItem } from './AlbumOverflowMenu';

/**
 * Right-click (contextmenu) menu for the app's interactive surfaces.
 *
 * This is deliberately *not* a second popover: it renders `OverflowMenuSurface`
 * from `AlbumOverflowMenu`, which already portals to `document.body`, clamps to
 * the viewport, and dismisses on outside-click / Escape / scroll / resize. All
 * this adds is "anchor it at the cursor instead of at a button".
 *
 * Two entry points:
 * - `useContextMenu(items)` for a container that already has a DOM node of its
 *   own (`AlbumPeek`, a list row) — spread the handler, render the menu.
 * - `<ContextMenu>` when a wrapper element is acceptable.
 *
 * Only attach it to cards/links. Right-clicking plain text, a form field, or a
 * standalone image must keep the browser's own menu (Copy / Save image as…) —
 * `wantsNativeMenu` enforces the parts of that we can detect generically.
 */

function wantsNativeMenu(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  // A right-click on top of a selection is almost always "copy this".
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

/** Open an href the way a real link would, so the menu item matches ⌘-click. */
export function openInNewTab(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer');
}

export function useContextMenu(items: OverflowItem[]) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setPoint(null), []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (wantsNativeMenu(e.target)) return;
    e.preventDefault();
    // The innermost wrapper wins — a track row inside an album card shows the
    // track menu, not both.
    e.stopPropagation();
    setPoint({ x: e.clientX, y: e.clientY });
  }, []);

  const menu = point ? (
    <OverflowMenuSurface x={point.x} y={point.y} align="left" items={items} onClose={close} />
  ) : null;

  return { onContextMenu, menu, open: point !== null, close };
}

/**
 * List variant — one menu instance for a whole list instead of one hook per row
 * (which would need every row extracted into its own component). Each row passes
 * itself as the subject; `build` turns that into the row's items.
 */
export function useContextMenuFor<T>(build: (subject: T) => OverflowItem[]) {
  const [state, setState] = useState<{ x: number; y: number; subject: T } | null>(null);
  const close = useCallback(() => setState(null), []);

  const onContextMenu = useCallback((e: React.MouseEvent, subject: T) => {
    if (wantsNativeMenu(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, subject });
  }, []);

  const menu = state ? (
    <OverflowMenuSurface
      x={state.x}
      y={state.y}
      align="left"
      items={build(state.subject)}
      onClose={close}
    />
  ) : null;

  return { onContextMenu, menu, close };
}

export default function ContextMenu({
  items,
  className = '',
  children,
}: {
  items: OverflowItem[];
  className?: string;
  children: ReactNode;
}) {
  const { onContextMenu, menu } = useContextMenu(items);
  return (
    <div className={className} onContextMenu={onContextMenu}>
      {children}
      {menu}
    </div>
  );
}
