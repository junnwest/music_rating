'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * Shared scroll/reveal primitives for /about and /partners — plain
 * IntersectionObserver / rAF, matching the rest of the app's approach (see
 * FlowerRateControl, AlbumPeek) rather than pulling in an animation library.
 * Everything here degrades to its final, static state under
 * prefers-reduced-motion.
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

export function useParallax(factor: number, reduced: boolean): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const update = () => {
      setY(window.scrollY * factor);
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [factor, reduced]);
  return y;
}

export function useCountUp(target: number, active: boolean, reduced: boolean, duration = 1000): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setValue(target);
      return;
    }
    let start: number | null = null;
    let raf = 0;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, target, duration]);
  return value;
}

export function revealStyle(shown: boolean, reduced: boolean, delayMs = 0): CSSProperties {
  if (reduced) return { opacity: 1 };
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0)' : 'translateY(16px)',
    transition: `opacity 640ms cubic-bezier(0.16,1,0.3,1) ${delayMs}ms, transform 640ms cubic-bezier(0.16,1,0.3,1) ${delayMs}ms`,
  };
}

/** Thin reading-progress bar — a real editorial-UX convention (Medium et
 *  al.), not decoration; earns its place on a page that's mostly prose. */
export function ReadingProgress({ reduced }: { reduced: boolean }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setPct(scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0);
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-transparent">
      <div
        className="h-full bg-ink/60"
        style={{ width: `${pct}%`, transition: reduced ? 'none' : 'width 120ms linear' }}
      />
    </div>
  );
}

export function Line({
  children,
  delay,
  mounted,
  reduced,
}: {
  children: ReactNode;
  delay: number;
  mounted: boolean;
  reduced: boolean;
}) {
  return (
    <span
      className="block"
      style={
        reduced
          ? undefined
          : {
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(18px)',
              transition: `opacity 620ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 620ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
            }
      }
    >
      {children}
    </span>
  );
}

export function Divider({
  revealRef,
  shown,
  reduced,
}: {
  revealRef: RefObject<HTMLDivElement>;
  shown: boolean;
  reduced: boolean;
}) {
  return (
    <div ref={revealRef} className="my-16 h-px overflow-hidden">
      <div
        className="h-full bg-divider"
        style={{
          width: reduced ? '100%' : shown ? '100%' : '0%',
          transition: reduced ? 'none' : 'width 900ms cubic-bezier(0.16,1,0.3,1)',
        }}
      />
    </div>
  );
}
