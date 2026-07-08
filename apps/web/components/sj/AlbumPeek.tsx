'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import FlowerGlyph from './FlowerGlyph';
import Cover from './Cover';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { eloToScore } from '../../lib/elo';

interface PeekStats {
  avg: number | null;
  count: number;
}

const statsCache = new Map<string, PeekStats>();

/**
 * Desktop hover peek — the web's answer to iOS long-press. Wrap any album
 * card/row; after a short hover a small card shows the cover, title/artist,
 * and live community stats (fetched once per album, cached for the session).
 * Fixed-position so it escapes overflow-clipping scroll rails; hidden on
 * touch/small screens (hover: none never triggers it).
 */
export default function AlbumPeek({
  releaseId,
  title,
  artist,
  coverUrl,
  meta,
  className = '',
  children,
}: {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  /** Small third line, e.g. "Album · 2023". */
  meta?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [stats, setStats] = useState<PeekStats | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const CARD_W = 224;
  const CARD_H = 300; // approximate; used only to pick above/below

  function enter() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top > CARD_H + 72;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - CARD_W / 2, 8),
        window.innerWidth - CARD_W - 8,
      );
      setPos({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
      const hit = statsCache.get(releaseId);
      if (hit) {
        setStats(hit);
      } else {
        setStats(null);
        supabase
          ?.from('ratings')
          .select('score, elo_score')
          .eq('release_group_id', releaseId)
          .then(({ data }) => {
            const rows =
              (data as { score: number | null; elo_score: number | null }[] | null) ?? [];
            const scored = rows
              .map((r) =>
                r.score != null ? r.score : r.elo_score != null ? eloToScore(r.elo_score) : null,
              )
              .filter((s): s is number => s != null);
            const next: PeekStats = {
              avg: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
              count: rows.length,
            };
            statsCache.set(releaseId, next);
            setStats(next);
          });
      }
    }, 450);
  }

  function leave() {
    clearTimeout(timerRef.current);
    setPos(null);
  }

  // Any scroll dismisses (the fixed card would drift from its anchor)
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [pos]);

  return (
    <div ref={anchorRef} onMouseEnter={enter} onMouseLeave={leave} className={className}>
      {children}
      {pos && (
        <div
          role="tooltip"
          className="hidden md:block fixed z-50 w-56 pointer-events-none"
          style={{
            left: pos.left,
            top: pos.top,
            transform: pos.above ? 'translateY(-100%)' : undefined,
          }}
        >
          {/* animation lives on an inner element — the outer one's transform
              is positional and must not be clobbered by keyframes */}
          <div className="rounded-xl bg-surface border border-divider shadow-xl p-3 sj-pop-in">
          <Cover url={coverUrl} className="w-full aspect-square" />
          <p className="mt-2 text-[13.5px] font-bold text-ink leading-snug line-clamp-2">
            {title}
          </p>
          <p className="text-[12px] text-muted truncate">{artist}</p>
          {meta && <p className="text-[11px] text-muted/80 mt-0.5">{meta}</p>}
          <div className="flex items-center gap-1.5 mt-2 min-h-[18px]">
            {stats === null ? (
              <span className="h-3 w-24 rounded bg-divider animate-pulse" />
            ) : stats.count === 0 ? (
              <span className="text-[11.5px] text-muted">{t('sj.peek.noRatings')}</span>
            ) : (
              <>
                <FlowerGlyph size={11} className="text-accent" />
                {stats.avg != null && (
                  <span className="text-[13px] font-bold text-accent tabular-nums">
                    {stats.avg.toFixed(1)}
                  </span>
                )}
                <span className="text-[11.5px] text-muted">
                  · {t('sj.peek.ratings').replace('{n}', String(stats.count))}
                </span>
              </>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
