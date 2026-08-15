'use client';

import { useEffect, useState } from 'react';

/**
 * Global cursor tooltip for icon-only controls. Any element with an
 * aria-label but no visible text (and no native title) gets its label shown
 * under the cursor after a short hover — one mount in the shell covers every
 * icon button in the app, current and future, with zero per-button work.
 */
export default function CursorTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    // Hover-capable pointers only — on touch this would just flash on tap
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;

    function labelFor(target: EventTarget | null): { el: HTMLElement; text: string } | null {
      if (!(target instanceof Element)) return null;
      const el = target.closest('[aria-label]') as HTMLElement | null;
      if (!el) return null;
      const text = el.getAttribute('aria-label')?.trim();
      if (!text) return null;
      if ((el.textContent ?? '').trim() !== '') return null; // has visible text
      if (el.getAttribute('title')) return null; // native tooltip already
      if (el.getAttribute('role') === 'combobox' || el.tagName === 'INPUT') return null;
      // Charts label themselves for screen readers with a full data readout
      // (e.g. the album page's rating histogram) — hovering one must not dump
      // that whole string under the cursor.
      if (el.getAttribute('role') === 'img') return null;
      return { el, text };
    }

    function onOver(e: MouseEvent) {
      const hit = labelFor(e.target);
      if (!hit) return;
      if (hit.el === current) return;
      current = hit.el;
      const { clientX, clientY } = e;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const x = Math.min(Math.max(clientX, 8), window.innerWidth - 8);
        setTip({ text: hit.text, x, y: clientY });
      }, 400);
    }

    function onOut(e: MouseEvent) {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      if (e.target instanceof Node && current.contains(e.target)) {
        current = null;
        clearTimeout(timer);
        setTip(null);
      }
    }

    function dismiss() {
      current = null;
      clearTimeout(timer);
      setTip(null);
    }

    window.addEventListener('mouseover', onOver);
    window.addEventListener('mouseout', onOut);
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="presentation"
      className="fixed z-[80] pointer-events-none px-2 py-1 rounded-md bg-ink text-page text-[11px] font-medium shadow-md whitespace-nowrap sj-fade-in -translate-x-1/2"
      style={{ left: tip.x, top: tip.y + 18 }}
    >
      {tip.text}
    </div>
  );
}
