'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { spectrumFill, spectrumRing } from '../../lib/sj/display';
import FlowerGlyph from '../../components/sj/FlowerGlyph';
import FlowerWatermark from './FlowerWatermark';
import LangToggle from './LangToggle';
import { COPY } from './copy';
import {
  usePrefersReducedMotion,
  useReveal,
  useParallax,
  useCountUp,
  revealStyle,
  ReadingProgress,
  Line,
  Divider,
} from './motion';

// Spectrum anchor scores for the "How it actually works" icons — spans the
// real rating-color ramp (lib/sj/display.ts) rather than a new palette.
const MECHANIC_ANCHORS = [3.0, 4.5];

export default function AboutPage() {
  const { lang } = useLanguage();
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const parallaxY = useParallax(0.08, reduced);

  const philosophySection = useReveal<HTMLElement>();
  const mechanicsSection = useReveal<HTMLElement>();
  const closingPanel = useReveal<HTMLDivElement>();
  const divider3 = useReveal<HTMLDivElement>();
  const dividerFinal = useReveal<HTMLDivElement>();

  const [ratingsCount, setRatingsCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats/public')
      .then((res) => (res.ok ? res.json() : { ratingsCount: null }))
      .then((data) => {
        if (!cancelled && typeof data.ratingsCount === 'number') setRatingsCount(data.ratingsCount);
      })
      .catch(() => {
        /* live stat is a nice-to-have — the closing panel still works without it */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const liveCount = useCountUp(ratingsCount ?? 0, closingPanel.shown && ratingsCount != null, reduced, 1400);

  return (
    <div className="relative min-h-screen bg-page overflow-hidden">
      <ReadingProgress reduced={reduced} />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{ transform: reduced ? undefined : `translateY(${parallaxY}px)` }}
      >
        <FlowerWatermark />
      </div>

      <header
        className={`sticky top-0 z-40 flex items-center justify-between max-w-[880px] mx-auto px-6 transition-[padding,background-color,backdrop-filter,border-color] duration-300 ${
          scrolled
            ? 'py-3.5 bg-page/85 backdrop-blur-md border-b border-divider'
            : 'py-6 border-b border-transparent'
        }`}
      >
        <Link href="/" className="flex items-center gap-2">
          <FlowerGlyph size={20} className="text-ink" />
          <span className="text-[14px] font-bold tracking-tight text-ink">sillajuku</span>
        </Link>
        <LangToggle />
      </header>

      <main className="relative max-w-[880px] mx-auto px-6 pt-16 pb-28">
        <h1
          className="font-extrabold tracking-[-0.02em] text-ink leading-[1.02] mb-6 max-w-[560px]"
          style={{ fontSize: 'clamp(2.6rem, 4vw + 1.6rem, 4rem)' }}
        >
          <Line delay={0} mounted={mounted} reduced={reduced}>
            {lang === 'ko' ? '당신이 사랑했던' : 'Every record'}
          </Line>
          <Line delay={90} mounted={mounted} reduced={reduced}>
            {lang === 'ko' ? '모든 음반.' : "you've loved."}
          </Line>
        </h1>

        <p
          className="text-[17px] leading-[1.6] text-ink/70 max-w-[480px] mb-20"
          style={
            reduced
              ? undefined
              : {
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(18px)',
                  transition: 'opacity 620ms cubic-bezier(0.16,1,0.3,1) 200ms, transform 620ms cubic-bezier(0.16,1,0.3,1) 200ms',
                }
          }
        >
          {COPY.heroSubhead[lang]}
        </p>

        <section
          ref={philosophySection.ref}
          style={revealStyle(philosophySection.shown, reduced)}
          className="md:grid md:grid-cols-[160px_1fr] md:gap-14"
        >
          <p className="text-[13px] font-semibold text-muted mb-5 md:mb-0 md:pt-1">{COPY.philosophy.label[lang]}</p>
          <p className="text-[17px] leading-[1.75] text-ink/80 max-w-[560px]">{COPY.philosophy.body[lang]}</p>
        </section>

        <Divider revealRef={divider3.ref} shown={divider3.shown} reduced={reduced} />

        <section
          ref={mechanicsSection.ref}
          style={revealStyle(mechanicsSection.shown, reduced)}
          className="md:grid md:grid-cols-[160px_1fr] md:gap-14"
        >
          <p className="text-[13px] font-semibold text-muted mb-5 md:mb-0 md:pt-1">{COPY.mechanics.label[lang]}</p>
          <div className="flex flex-col gap-8 max-w-[560px]">
            {COPY.mechanics.items.map((item, i) => {
              const anchor = MECHANIC_ANCHORS[i % MECHANIC_ANCHORS.length];
              return (
                <div key={i} className="flex gap-4 items-start">
                  <div
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                    style={{ background: spectrumFill(anchor), boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.5), 0 1px 3px rgba(0,0,0,0.1)' }}
                  >
                    <span style={{ color: spectrumRing(anchor) }}>
                      <FlowerGlyph src="/icon-flower.svg" size={16} />
                    </span>
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-ink mb-1">{item.heading[lang]}</p>
                    <p className="text-[16px] leading-[1.65] text-ink/80">{item.body[lang]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Divider revealRef={dividerFinal.ref} shown={dividerFinal.shown} reduced={reduced} />

        {/* The one glass moment on the page — used with intent for the
            closing beat, not repeated as a card pattern elsewhere. Leads with
            the live ratings count (real, /api/stats/public) rather than a
            promise — the panel still works fine if that fetch fails. */}
        <div
          ref={closingPanel.ref}
          style={revealStyle(closingPanel.shown, reduced)}
          className="max-w-[560px] md:ml-[216px] rounded-[28px] border border-white/25 dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-xl shadow-2xl px-7 py-9 md:px-10 md:py-11"
        >
          {ratingsCount != null && (
            <>
              <p
                className="font-extrabold tracking-[-0.02em] text-ink leading-none tabular-nums mb-2"
                style={{ fontSize: 'clamp(2.6rem, 4vw + 1rem, 3.75rem)' }}
              >
                {liveCount.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')}
              </p>
              <p className="text-[13px] font-semibold text-muted mb-6">{COPY.liveStat.caption[lang]}</p>
            </>
          )}
          <p className="text-[16px] leading-[1.75] text-ink/80 mb-8 max-w-[440px]">{COPY.liveStat.closingLine[lang]}</p>
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-page text-[14px] font-semibold transition-all hover:gap-3 hover:shadow-lg active:scale-[0.97]"
          >
            {COPY.cta[lang]}
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <p className="max-w-[560px] md:ml-[216px] mt-8 text-[12px] text-muted">
          {lang === 'ko' ? (
            <>파트너 및 업계 문의는 <Link href="/partners" className="underline hover:text-ink transition-colors">여기</Link>에서.</>
          ) : (
            <>Press &amp; industry inquiries <Link href="/partners" className="underline hover:text-ink transition-colors">here</Link>.</>
          )}
        </p>
      </main>
    </div>
  );
}
