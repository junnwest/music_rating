'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { spectrumFill, spectrumRing } from '../../lib/sj/display';
import FlowerGlyph from '../../components/sj/FlowerGlyph';
import FlowerWatermark from '../about/FlowerWatermark';
import LangToggle from '../about/LangToggle';
import {
  usePrefersReducedMotion,
  useReveal,
  useParallax,
  useCountUp,
  revealStyle,
  ReadingProgress,
  Line,
  Divider,
} from '../about/motion';
import { PARTNERS_COPY as COPY } from './copy';

// Spans the real rating-color ramp (lib/sj/display.ts), one anchor per tech item.
const TECH_ANCHORS = [2.0, 3.4, 4.7];

export default function PartnersPage() {
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

  const statsSection = useReveal<HTMLElement>();
  const techSection = useReveal<HTMLElement>();
  const audienceSection = useReveal<HTMLElement>();
  const contactPanel = useReveal<HTMLDivElement>();
  const divider1 = useReveal<HTMLDivElement>();
  const divider2 = useReveal<HTMLDivElement>();
  const divider3 = useReveal<HTMLDivElement>();

  const [ratingsCount, setRatingsCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats/public')
      .then((res) => (res.ok ? res.json() : { ratingsCount: null }))
      .then((data) => {
        if (!cancelled && typeof data.ratingsCount === 'number') setRatingsCount(data.ratingsCount);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const liveCount = useCountUp(ratingsCount ?? 0, statsSection.shown && ratingsCount != null, reduced, 1400);

  return (
    <div className="relative min-h-screen bg-page overflow-hidden">
      <ReadingProgress reduced={reduced} />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{ transform: reduced ? undefined : `translateY(${parallaxY}px)` }}
      >
        <FlowerWatermark variant="single-right" />
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
        <div className="flex items-center gap-4">
          <Link href="/about" className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition-colors">
            <ArrowLeft size={13} />
            {lang === 'ko' ? '소개 페이지' : 'About'}
          </Link>
          <LangToggle />
        </div>
      </header>

      <main className="relative max-w-[880px] mx-auto px-6 pt-16 pb-28">
        <h1
          className="font-extrabold tracking-[-0.02em] text-ink leading-[1.08] mb-4 max-w-[620px]"
          style={{ fontSize: 'clamp(2rem, 3vw + 1.3rem, 3.25rem)' }}
        >
          <Line delay={0} mounted={mounted} reduced={reduced}>
            {COPY.heroTitle[lang]}
          </Line>
        </h1>

        <p
          className="text-[16px] leading-[1.6] text-ink/70 max-w-[480px] mb-16"
          style={
            reduced
              ? undefined
              : {
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(18px)',
                  transition: 'opacity 620ms cubic-bezier(0.16,1,0.3,1) 160ms, transform 620ms cubic-bezier(0.16,1,0.3,1) 160ms',
                }
          }
        >
          {COPY.heroSubhead[lang]}
        </p>

        {ratingsCount != null && (
          <>
            <section
              ref={statsSection.ref}
              style={revealStyle(statsSection.shown, reduced)}
              className="md:grid md:grid-cols-[160px_1fr] md:gap-14 mb-2"
            >
              <p className="text-[13px] font-semibold text-muted mb-5 md:mb-0 md:pt-1">{COPY.stats.label[lang]}</p>
              <div>
                <p
                  className="font-extrabold tracking-[-0.02em] text-ink leading-none tabular-nums mb-2"
                  style={{ fontSize: 'clamp(2rem, 3vw + 0.8rem, 2.75rem)' }}
                >
                  {liveCount.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')}
                </p>
                <p className="text-[13px] text-muted">{COPY.stats.ratingsCaption[lang]}</p>
              </div>
            </section>

            <Divider revealRef={divider1.ref} shown={divider1.shown} reduced={reduced} />
          </>
        )}

        <section
          ref={techSection.ref}
          style={revealStyle(techSection.shown, reduced)}
          className="md:grid md:grid-cols-[160px_1fr] md:gap-14"
        >
          <p className="text-[13px] font-semibold text-muted mb-5 md:mb-0 md:pt-1">{COPY.technology.label[lang]}</p>
          <div className="flex flex-col gap-8 max-w-[600px]">
            {COPY.technology.items.map((item, i) => {
              const anchor = TECH_ANCHORS[i % TECH_ANCHORS.length];
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
                    <p className="text-[13.5px] font-bold text-ink mb-1">{item.heading[lang]}</p>
                    <p className="text-[15.5px] leading-[1.65] text-ink/80">{item.body[lang]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Divider revealRef={divider2.ref} shown={divider2.shown} reduced={reduced} />

        <section
          ref={audienceSection.ref}
          style={revealStyle(audienceSection.shown, reduced)}
          className="md:grid md:grid-cols-[160px_1fr] md:gap-14"
        >
          <p className="text-[13px] font-semibold text-muted mb-5 md:mb-0 md:pt-1">{COPY.audience.label[lang]}</p>
          <p className="text-[16px] leading-[1.75] text-ink/80 max-w-[560px]">{COPY.audience.body[lang]}</p>
        </section>

        <Divider revealRef={divider3.ref} shown={divider3.shown} reduced={reduced} />

        {/* The one glass moment on this page, mirroring /about's own rule:
            used once, with intent, for the closing beat. */}
        <div
          ref={contactPanel.ref}
          style={revealStyle(contactPanel.shown, reduced)}
          className="max-w-[560px] md:ml-[216px] rounded-[28px] border border-white/25 dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-xl shadow-2xl px-7 py-9 md:px-10 md:py-11"
        >
          <p className="text-[20px] font-extrabold tracking-[-0.02em] text-ink mb-2">{COPY.contact.heading[lang]}</p>
          <p className="text-[15px] leading-[1.6] text-ink/80 mb-7 max-w-[420px]">{COPY.contact.body[lang]}</p>
          <a
            href={`mailto:${COPY.contact.email}?subject=${encodeURIComponent(lang === 'ko' ? '파트너십 문의' : 'Partnership inquiry')}`}
            className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-page text-[14px] font-semibold transition-all hover:gap-3 hover:shadow-lg active:scale-[0.97]"
          >
            <Mail size={15} />
            {COPY.contact.button[lang]}
          </a>
        </div>
      </main>
    </div>
  );
}
