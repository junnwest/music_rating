'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import FlowerGlyph from './FlowerGlyph';
import { Skeleton } from './Loading';
import { useAlbumContextMenu } from './AlbumContextMenu';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import type { SJRelease } from '../../lib/sj/data';

interface PeekStats {
  avg: number | null;
  count: number;
}
interface PeekTrack {
  position: number;
  title: string;
  durationMs: number | null;
}

const statsCache = new Map<string, PeekStats>();
const tracksCache = new Map<string, PeekTrack[]>();

const CARD_W = 300;
// Tall enough for the worst case (2-line title + meta + MAX_TRACKS rows + the
// "+N" line ≈ 455px) — it doubles as the content's max-height, so a shorter
// value visibly clipped the tracklist of long albums. Used for vertical
// clamping too; still comfortably inside any desktop viewport.
const CARD_H = 460;
const MAX_TRACKS = 14;

function fmtDur(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Desktop hover peek — wrap any album card/row. After a short hover a large,
 * translucent rounded bezel appears in the blank space to the LEFT of the cover
 * (flipping right only if there's no room), showing the album's info, community
 * rating, and tracklist. Data is fetched once per album and cached for the
 * session. Fixed-position + portalled so it escapes overflow-clipping rails;
 * desktop only (hover: none never triggers it) and never intercepts clicks.
 *
 * It also carries the album **right-click menu**. This component already wraps
 * every album cover in the app, so hanging `useAlbumContextMenu` off its
 * existing root node is what makes that menu global — no per-page wiring, and no
 * extra DOM that could disturb a cover's layout.
 */
export default function AlbumPeek({
  releaseId,
  title,
  artist,
  coverUrl,
  meta,
  release,
  onNotInterested,
  className = '',
  children,
}: {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  /** Small third line, e.g. "Album · 2023". */
  meta?: string | null;
  /**
   * Full record for the right-click menu's rating modal. Optional — where a page
   * only has display strings, one is synthesized from them.
   */
  release?: SJRelease;
  /** Forwarded to the menu's "Not interested" so the surface can drop the card. */
  onNotInterested?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [stats, setStats] = useState<PeekStats | null>(null);
  const [tracks, setTracks] = useState<PeekTrack[] | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const { onContextMenu, menu: contextMenu } = useAlbumContextMenu({
    release: release ?? {
      id: releaseId,
      title,
      artist,
      coverUrl: coverUrl ?? null,
      releaseType: null,
      releaseDate: null,
      // `title`/`artist` here are already display strings (native name resolved
      // by the caller), so the native fields must stay null or they'd double up.
      titleNative: null,
      artistNative: null,
    },
    onNotInterested,
  });

  function enter() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Prefer the blank space to the LEFT of the cover; flip right if cramped.
      let left = rect.left - CARD_W - 14;
      if (left < 8) left = Math.min(rect.right + 14, window.innerWidth - CARD_W - 8);
      const top = Math.min(
        Math.max(rect.top + rect.height / 2 - CARD_H / 2, 8),
        window.innerHeight - CARD_H - 8,
      );
      setPos({ left, top });

      // Community stats (cached)
      const sHit = statsCache.get(releaseId);
      if (sHit) setStats(sHit);
      else {
        setStats(null);
        supabase
          ?.from('ratings')
          .select('score')
          .eq('release_group_id', releaseId)
          .then(({ data }) => {
            const rows = (data as { score: number | null }[] | null) ?? [];
            const scored = rows.map((r) => r.score).filter((s): s is number => s != null);
            const next: PeekStats = {
              avg: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
              count: rows.length,
            };
            statsCache.set(releaseId, next);
            setStats(next);
          });
      }

      // Tracklist (cached): canonical release → its tracks, like the album page
      const tHit = tracksCache.get(releaseId);
      if (tHit) setTracks(tHit);
      else {
        setTracks(null);
        (async () => {
          if (!supabase) return;
          const { data: canonical } = await supabase
            .from('releases')
            .select('id')
            .eq('release_group_id', releaseId)
            .eq('is_canonical', true)
            .limit(1);
          const cid = (canonical as { id: string }[] | null)?.[0]?.id;
          if (!cid) {
            tracksCache.set(releaseId, []);
            setTracks([]);
            return;
          }
          const { data: rows } = await supabase
            .from('release_tracks')
            .select('position, recordings(title, duration_ms)')
            .eq('release_id', cid)
            .order('position')
            .limit(60);
          const loaded: PeekTrack[] = ((rows as any[] | null) ?? []).map((r) => ({
            position: r.position,
            title: r.recordings?.title ?? '',
            durationMs: r.recordings?.duration_ms ?? null,
          }));
          tracksCache.set(releaseId, loaded);
          setTracks(loaded);
        })();
      }
    }, 400);
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

  const shown = tracks ? tracks.slice(0, MAX_TRACKS) : [];
  const extra = tracks ? tracks.length - shown.length : 0;

  return (
    <div
      ref={anchorRef}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onContextMenu={(e) => {
        leave(); // the peek would otherwise hang around behind the menu
        onContextMenu(e);
      }}
      className={className}
    >
      {children}
      {contextMenu}
      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className="hidden md:block fixed z-[90] pointer-events-none"
            style={{ left: pos.left, top: pos.top, width: CARD_W }}
          >
            {/* Translucent glass bezel — both the panel and its text are see-through */}
            <div className="sj-pop-in rounded-2xl border border-white/25 dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="p-4 opacity-90" style={{ maxHeight: CARD_H }}>
                <p className="text-[15px] font-black text-ink leading-tight line-clamp-2">{title}</p>
                <p className="text-[12.5px] text-muted truncate">{artist}</p>
                {meta && <p className="text-[11px] text-muted/80 mt-0.5">{meta}</p>}

                <div className="flex items-center gap-1.5 mt-2 min-h-[18px]">
                  {stats === null ? (
                    <Skeleton className="h-3 w-24 rounded" />
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

                <div className="h-px bg-ink/10 my-2.5" />

                {tracks === null ? (
                  <div className="space-y-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-3 rounded" />
                    ))}
                  </div>
                ) : tracks.length === 0 ? (
                  <p className="text-[11.5px] text-muted/80">{artist}</p>
                ) : (
                  <ol className="space-y-1">
                    {shown.map((tr) => (
                      <li key={tr.position} className="flex items-baseline gap-2 text-[12px]">
                        <span className="w-4 shrink-0 text-right text-muted/70 tabular-nums">
                          {tr.position}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-ink/90">{tr.title}</span>
                        {fmtDur(tr.durationMs) && (
                          <span className="shrink-0 text-muted/70 tabular-nums">
                            {fmtDur(tr.durationMs)}
                          </span>
                        )}
                      </li>
                    ))}
                    {extra > 0 && (
                      <li className="pl-6 pt-0.5 text-[11px] text-muted/70">+{extra}</li>
                    )}
                  </ol>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
