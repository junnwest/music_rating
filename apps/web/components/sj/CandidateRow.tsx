'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';

/**
 * A horizontally scrolling shelf with paging arrows — the row primitive behind
 * Quick Add's per-artist and per-genre groups.
 *
 * The arrows are driven by measured overflow, not by item count: a row of four
 * covers doesn't overflow on desktop and does on a phone, and only the element
 * knows which. They're hidden (not disabled) at each end so the control never
 * advertises an action that does nothing, and they sit *outside* the scroller's
 * padding so they never cover a cover.
 *
 * Native scrolling stays on — the arrows are an addition to swipe/trackpad, and
 * `snap-x` keeps a paged flick landing on a card edge rather than mid-cover.
 */
export default function CandidateRow({
  title,
  subtitle,
  onSeeMore,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onSeeMore?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 2px of slack: sub-pixel layout means scrollLeft rarely hits the exact end.
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Children arriving (a page of candidates landing) changes scrollWidth
    // without resizing the scroller itself.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  function page(dir: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  }

  // ── Drag-to-scroll ──────────────────────────────────────────────────────
  // Grab-and-drag anywhere on the shelf pans it horizontally. The rate flower
  // stops pointer propagation on its own press, so a drag that starts on the
  // gauge rates instead of scrolling; a drag that starts on a cover pans, and
  // we swallow the click it would otherwise fire so it doesn't open a peek.
  const drag = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture?.(e.pointerId);
    }
    el.scrollLeft = d.startLeft - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (el) el.releasePointerCapture?.(e.pointerId);
    // Keep `moved` around for the click that follows so we can cancel it, then
    // clear on the next tick.
    if (drag.current?.moved) setTimeout(() => (drag.current = null), 0);
    else drag.current = null;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return (
    <section className="mt-5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-[14.5px] font-bold text-ink truncate">{title}</h2>
        {subtitle && <span className="text-[12px] text-muted truncate">{subtitle}</span>}
        <span className="flex-1" />
        {onSeeMore && (
          <button
            onClick={onSeeMore}
            className="shrink-0 text-[12.5px] font-semibold text-accent hover:opacity-80 transition"
          >
            {t('sj.quickAdd.seeMore')} →
          </button>
        )}
      </div>

      <div className="relative mt-2 group/row">
        <div
          ref={ref}
          onScroll={measure}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
          className="flex gap-3 overflow-x-auto snap-x pb-2.5 shelf-scroll cursor-grab active:cursor-grabbing select-none"
        >
          {children}
        </div>

        <Arrow
          dir={-1}
          onClick={() => page(-1)}
          disabled={atStart}
          label={t('sj.quickAdd.scrollLeft')}
        />
        <Arrow
          dir={1}
          onClick={() => page(1)}
          disabled={atEnd}
          label={t('sj.quickAdd.scrollRight')}
        />
      </div>
    </section>
  );
}

function Arrow({
  dir,
  onClick,
  disabled,
  label,
}: {
  dir: -1 | 1;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  const Icon = dir === -1 ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`absolute top-1/2 -translate-y-1/2 z-10 grid place-items-center w-8 h-8 rounded-full bg-page/90 border border-divider text-ink shadow-sm transition
        outline-none focus-visible:ring-2 focus-visible:ring-accent/50
        ${disabled ? 'opacity-0 pointer-events-none' : 'opacity-90 hover:opacity-100 hover:bg-page'}
        ${dir === -1 ? '-left-1' : '-right-1'}`}
    >
      <Icon size={16} />
    </button>
  );
}
