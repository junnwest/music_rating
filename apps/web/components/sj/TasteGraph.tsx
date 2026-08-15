'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import Cover from './Cover';
import { useLanguage } from '../../lib/i18n';
import { spectrumColor, spectrumFill, spectrumNumber } from '../../lib/sj/display';

/**
 * The taste map: a **cover mosaic treemap** of the user's taste worlds — one tile
 * per world, area ∝ their mass in it, and the tile itself is *tiled with the
 * album covers they rated there* (density scales with the tile's size). The avg
 * rating rides as a solid numeric chip, and the app's score ramp is demoted to a
 * thin accent frame — a redundant, glanceable heat cue that no longer flattens
 * the tile into one bland colour. Click a world and it fluidly expands into its
 * sub-genres; pick a sub-genre to focus the inspector's albums + recommendations.
 *
 * Interaction is deliberately tactile (2026-08-12): tiles lift and tilt toward
 * the pointer (a Vision-OS-style parallax "magnet"), their siblings dim, and
 * opening a world animates the clicked tile growing to fill the canvas before it
 * resolves into the sub-genre mosaic — so the drill reads as spatial, not a swap.
 *
 * Layout is deterministic (squarified treemap over a fixed value order), so the
 * same profile always draws the same map and a refresh doesn't reshuffle it. The
 * canvas grows to fill whichever column (map or inspector) is taller.
 */

export interface TasteGraphTag {
  tag: string;
  display: string;
  /** Weighted rating count carried by this tag. */
  mass: number;
  /** Share of the parent world's mass. */
  share: number;
  avg: number;
}

export interface TasteGraphWorld {
  key: string;
  label: string;
  primary: string;
  share: number;
  mass: number;
  avg: number | null;
  /** Cosine to every world, same index order. */
  sim: number[];
  tags: TasteGraphTag[];
  /** Cosine between this world's tags, same index order as `tags`. */
  tagSim: number[][];
  /** "mostly 2010s · Korean scene", composed by the page. */
  note?: string | null;
}

export interface TasteGraphAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  score: number;
  tags: string[];
}

export interface TasteGraphRec {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
}

export interface TasteGraphData {
  worlds: TasteGraphWorld[];
  albums: TasteGraphAlbum[];
  recs: Record<string, TasteGraphRec[]>;
}

const PANEL_ALBUMS = 10;
/** Time the "clicked tile expands to fill" animation runs before the sub-genre
 *  mosaic takes over. Kept in sync with the CSS transition below. */
const OPEN_MS = 380;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk 2000): pack `values` into the
 * `w`×`h` box as rectangles whose areas are proportional to the values and whose
 * aspect ratios stay as close to square as possible. Deterministic — values are
 * laid out in the given order (callers pre-sort descending).
 */
function squarify(values: number[], w: number, h: number): Rect[] {
  const n = values.length;
  if (n === 0) return [];
  const total = values.reduce((s, v) => s + v, 0) || 1;
  const scale = (w * h) / total;
  const items = values.map((v, i) => ({ area: Math.max(v, 0) * scale, i }));

  const out: Rect[] = [];
  let x = 0;
  let y = 0;
  let fw = w;
  let fh = h;

  const worst = (row: { area: number }[], side: number) => {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((s, r) => s + r.area, 0);
    let max = -Infinity;
    let min = Infinity;
    for (const r of row) {
      if (r.area > max) max = r.area;
      if (r.area < min) min = r.area;
    }
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  let idx = 0;
  while (idx < items.length) {
    const short = Math.min(fw, fh);
    const row: { area: number; i: number }[] = [items[idx]];
    let j = idx + 1;
    while (j < items.length && worst(row, short) >= worst([...row, items[j]], short)) {
      row.push(items[j]);
      j += 1;
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (fw <= fh) {
      // Horizontal strip across the top of the remaining box.
      const rh = rowArea / fw || 0;
      let rx = x;
      for (const r of row) {
        const rw = rh > 0 ? r.area / rh : 0;
        out.push({ x: rx, y, w: rw, h: rh, i: r.i });
        rx += rw;
      }
      y += rh;
      fh -= rh;
    } else {
      // Vertical strip down the left of the remaining box.
      const rw = rowArea / fh || 0;
      let ry = y;
      for (const r of row) {
        const rh = rw > 0 ? r.area / rw : 0;
        out.push({ x, y: ry, w: rw, h: rh, i: r.i });
        ry += rh;
      }
      x += rw;
      fw -= rw;
    }
    idx = j;
  }
  return out;
}

const MAP_CSS = `
@keyframes taste-open-in{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:scale(1)}}
.taste-open{animation:taste-open-in 380ms cubic-bezier(.22,.61,.36,1)}
.taste-tile-face{transition:transform 200ms cubic-bezier(.2,.7,.2,1), box-shadow 240ms ease, filter 240ms ease}
.taste-tile:hover{z-index:30}
/* Vision-OS "magnet": the hovered tile lifts (JS adds the pointer-tracked tilt on
   top of this base), and its siblings quietly dim so focus reads as a spotlight. */
.taste-tile:hover .taste-tile-face{transform:scale(1.04) translateY(-3px)}
.taste-tiles:has(.taste-tile:hover) .taste-tile:not(:hover) .taste-tile-face{filter:brightness(.78) saturate(.9)}
@media (prefers-reduced-motion: reduce){
  .taste-open{animation:none}
  .taste-tile-face{transition:none}
  .taste-tile:hover .taste-tile-face{transform:none}
}
`;

/** Largest fully-fillable cover grid for a tile of `tileW`×`tileH` px given
 *  `n` available covers. Targets ~104px cells, caps at 4×4, and never leaves an
 *  empty cell (so the collage always reads as intentional). */
function chooseGrid(tileW: number, tileH: number, n: number): { cols: number; rows: number } | null {
  if (n <= 0 || tileW < 44 || tileH < 44) return null;
  let cols = Math.max(1, Math.min(4, Math.floor(tileW / 104)));
  let rows = Math.max(1, Math.min(4, Math.floor(tileH / 104)));
  while (cols * rows > n) {
    if (cols >= rows && cols > 1) cols -= 1;
    else if (rows > 1) rows -= 1;
    else break;
  }
  return { cols, rows };
}

/** A single mosaic tile — a world at the top level, a sub-genre when drilled in. */
function MosaicTile({
  rect,
  boxW,
  boxH,
  name,
  meta,
  avg,
  covers,
  selected,
  dim,
  enterState,
  onClick,
  title,
  ariaLabel,
}: {
  rect: Rect;
  boxW: number;
  boxH: number;
  name: string;
  /** Small secondary line under the name (e.g. "42 rated · 32%") — big tiles only. */
  meta?: string;
  avg: number | null;
  covers: string[];
  selected: boolean;
  dim: boolean;
  /** During a world-open animation: 'target' = the clicked tile (grows to fill),
   *  'other' = a sibling (fades away), null = not animating. */
  enterState: 'target' | 'other' | null;
  onClick: () => void;
  title: string;
  ariaLabel: string;
}) {
  const faceRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);

  const tileW = (rect.w / 100) * boxW;
  const tileH = (rect.h / 100) * boxH;
  const score = avg ?? 3;

  const grid = chooseGrid(tileW, tileH, covers.length);
  const shown = grid ? covers.slice(0, grid.cols * grid.rows) : [];

  // Label tiers keyed to the tile's real size, so text never overflows: big gets
  // a two-line name + meta + chip, med a name + chip, small a single truncated
  // line (no chip), and tiny drops to the tooltip only.
  const big = tileW >= 178 && tileH >= 148;
  const med = !big && tileW >= 88 && tileH >= 58;
  const small = !big && !med && tileW >= 52 && tileH >= 30;
  const showLabel = big || med || small;

  const accent = spectrumColor(score, 0.62, 1);

  // Pointer-tracked parallax — the "magnet" pull. Written imperatively so the
  // pointer move doesn't re-render (which would wipe the transform).
  const onMove = (e: React.MouseEvent) => {
    if (enterState || prefersReducedMotion()) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const f = faceRef.current;
    if (f) {
      f.style.transform = `scale(1.04) translateY(-3px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg)`;
    }
    const g = glowRef.current;
    if (g) {
      g.style.opacity = '1';
      g.style.background = `radial-gradient(240px circle at ${((px + 0.5) * 100).toFixed(1)}% ${((py + 0.5) * 100).toFixed(1)}%, rgba(255,255,255,0.3), transparent 55%)`;
    }
  };
  const onLeave = () => {
    const f = faceRef.current;
    if (f) f.style.transform = '';
    const g = glowRef.current;
    if (g) g.style.opacity = '0';
  };

  const targ = enterState === 'target';

  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="taste-tile absolute block text-left cursor-pointer"
      style={{
        left: `${targ ? 0 : rect.x}%`,
        top: `${targ ? 0 : rect.y}%`,
        width: `${targ ? 100 : rect.w}%`,
        height: `${targ ? 100 : rect.h}%`,
        opacity: enterState === 'other' ? 0 : 1,
        transform: enterState === 'other' ? 'scale(0.92)' : undefined,
        transition: enterState
          ? `left ${OPEN_MS}ms cubic-bezier(.22,.61,.36,1), top ${OPEN_MS}ms cubic-bezier(.22,.61,.36,1), width ${OPEN_MS}ms cubic-bezier(.22,.61,.36,1), height ${OPEN_MS}ms cubic-bezier(.22,.61,.36,1), opacity 320ms ease, transform 320ms ease`
          : undefined,
        zIndex: targ ? 20 : undefined,
        perspective: 700,
      }}
    >
      <span
        ref={faceRef}
        className="taste-tile-face absolute inset-[3px] rounded-xl overflow-hidden block bg-divider"
        style={{
          filter: dim ? 'brightness(0.4) saturate(0.6)' : undefined,
          boxShadow: selected
            ? `0 0 0 2px #fff, 0 0 0 4px ${accent}, 0 12px 26px -8px rgba(0,0,0,0.5)`
            : `inset 0 0 0 1.5px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.14)`,
        }}
      >
        {/* Cover mosaic — or a score-ramp gradient when this corner has no art. */}
        {grid ? (
          <span
            className="absolute inset-0 grid gap-px bg-divider"
            style={{
              gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
              gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
            }}
          >
            {shown.map((url, i) => (
              <Cover key={i} url={url} className="w-full h-full" rounded="rounded-none" />
            ))}
          </span>
        ) : (
          <span
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(155deg, ${spectrumColor(
                score,
                0.68,
                0.9,
              )}, ${spectrumColor(score, 0.5, 1)})`,
            }}
          />
        )}

        {/* Bottom scrim reserves a legible band for the label over any cover. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/5"
          style={{
            backgroundImage:
              'linear-gradient(to top, rgba(0,0,0,0.72) 4%, rgba(0,0,0,0.32) 42%, transparent)',
          }}
        />

        {/* Specular highlight that tracks the pointer (the glass "sheen"). */}
        <span
          ref={glowRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ opacity: 0, transition: 'opacity 220ms ease', mixBlendMode: 'soft-light' }}
        />

        {showLabel && (
          <span
            className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2"
            style={{ padding: small ? '6px 8px' : '10px' }}
          >
            <span className="min-w-0">
              <span
                className={`block font-black text-white tracking-tight ${small ? 'truncate' : 'leading-tight line-clamp-2'}`}
                style={{
                  fontSize: big ? 15 : med ? 13 : 11,
                  textShadow: '0 1px 4px rgba(0,0,0,0.55)',
                }}
              >
                {name}
              </span>
              {big && meta && (
                <span
                  className="mt-0.5 block text-[10.5px] font-semibold text-white/75"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                >
                  {meta}
                </span>
              )}
            </span>
            {avg != null && !small && (
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-black tabular-nums shadow-sm"
                style={{ background: spectrumFill(score), color: spectrumNumber(score) }}
              >
                {avg.toFixed(1)}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export default function TasteGraph({ data }: { data: TasteGraphData }) {
  const { t } = useLanguage();
  const [world, setWorld] = useState<number | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  // The world index mid-open: its tile grows to fill the canvas before the
  // sub-genre mosaic resolves in. null except during the ~380ms transition.
  const [entering, setEntering] = useState<number | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The mosaic grid choice depends on real pixel size, so measure the canvas
  // (which now flexes to fill whichever column is taller).
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 680, h: 540 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
  }, []);

  const worlds = data.worlds;

  // Albums grouped by tag (each list stays score-descending — data.albums is).
  const albumsByTag = useMemo(() => {
    const m = new Map<string, TasteGraphAlbum[]>();
    for (const a of data.albums) {
      for (const tg of a.tags) {
        let list = m.get(tg);
        if (!list) m.set(tg, (list = []));
        list.push(a);
      }
    }
    return m;
  }, [data.albums]);

  // Per-world album roll-up (union across the world's tags, deduped, best-first)
  // — the source of each world tile's mosaic and its rated-album count.
  const worldAlbums = useMemo(
    () =>
      worlds.map((w) => {
        const seen = new Set<string>();
        const out: TasteGraphAlbum[] = [];
        for (const tg of w.tags) {
          for (const a of albumsByTag.get(tg.tag) ?? []) {
            if (!seen.has(a.id)) {
              seen.add(a.id);
              out.push(a);
            }
          }
        }
        out.sort((x, y) => y.score - x.score);
        return out;
      }),
    [worlds, albumsByTag],
  );
  const worldCovers = useMemo(
    () => worldAlbums.map((list) => list.filter((a) => a.coverUrl).map((a) => a.coverUrl as string)),
    [worldAlbums],
  );

  // Top-level tiles: one per world, area ∝ share (sorted so the treemap packs
  // largest-first, which is what keeps the aspect ratios tidy).
  const worldOrder = useMemo(
    () => worlds.map((_, i) => i).sort((a, b) => worlds[b].share - worlds[a].share),
    [worlds],
  );
  const worldRects = useMemo(() => {
    const rects = squarify(
      worldOrder.map((i) => Math.max(worlds[i].share, 0.02)),
      100,
      100,
    );
    return rects.map((r) => ({ ...r, i: worldOrder[r.i] }));
  }, [worldOrder, worlds]);

  const openWorld = world != null ? worlds[world] : null;

  // Sub-genre tags, deduped by display name (two tag keys can collapse to one
  // label) so the sub-map never shows the same genre twice.
  const openTags = useMemo(() => {
    if (!openWorld) return [];
    const seen = new Set<string>();
    return openWorld.tags.filter((tg) => {
      const key = tg.display.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [openWorld]);

  const tagOrder = useMemo(
    () => openTags.map((_, i) => i).sort((a, b) => openTags[b].share - openTags[a].share),
    [openTags],
  );
  const tagRects = useMemo(() => {
    if (openTags.length === 0) return [];
    const rects = squarify(
      tagOrder.map((i) => Math.max(openTags[i].share, 0.02)),
      100,
      100,
    );
    return rects.map((r) => ({ ...r, i: tagOrder[r.i] }));
  }, [openTags, tagOrder]);

  // Escape backs out one level — the same order the breadcrumb walks.
  useEffect(() => {
    if (world == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (tag) setTag(null);
      else setWorld(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [world, tag]);

  const openTag = openWorld && tag ? openTags.find((x) => x.tag === tag) ?? null : null;

  const focusTags = useMemo(() => {
    if (!openWorld) return null;
    return new Set(openTag ? [openTag.tag] : openTags.map((x) => x.tag));
  }, [openWorld, openTag, openTags]);

  const focusAlbums = useMemo(() => {
    if (!focusTags) return [];
    return data.albums.filter((a) => a.tags.some((x) => focusTags.has(x))).slice(0, PANEL_ALBUMS);
  }, [data.albums, focusTags]);

  // Recommendations: prefer the focused sub-genre's own pool, fall back to the
  // world pool (labelled so the shift is never silent), so the panel is never
  // inconsistently empty from one tab to the next.
  const worldRecs = openWorld ? data.recs[openWorld.key] ?? [] : [];
  const tagRecs = openTag ? data.recs[`tag:${openTag.tag}`] ?? [] : [];
  const focusRecs = openTag ? (tagRecs.length > 0 ? tagRecs : worldRecs) : worldRecs;
  const recsFallback = !!openTag && tagRecs.length === 0 && worldRecs.length > 0;

  // Open a world — animate the clicked tile filling the canvas, then swap to the
  // sub-genre mosaic. Reduced motion skips straight to the mosaic.
  const openWorldTile = (i: number) => {
    if (prefersReducedMotion()) {
      setTag(null);
      setWorld(i);
      return;
    }
    if (enterTimer.current) clearTimeout(enterTimer.current);
    setEntering(i);
    enterTimer.current = setTimeout(() => {
      setTag(null);
      setWorld(i);
      setEntering(null);
      enterTimer.current = null;
    }, OPEN_MS);
  };

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_300px] md:items-stretch">
      <style>{MAP_CSS}</style>

      {/* ── The mosaic ── */}
      <div className="relative flex flex-col rounded-2xl bg-surface border border-divider/60 overflow-hidden">
        <div ref={boxRef} className="relative w-full flex-1 min-h-[440px] sm:min-h-[540px]">
          {!openWorld ? (
            <div key="worlds" className="taste-tiles taste-open absolute inset-0">
              {worldRects.map((r) => {
                const w = worlds[r.i];
                const pct = Math.round(w.share * 100);
                const count = worldAlbums[r.i].length;
                return (
                  <MosaicTile
                    key={w.key}
                    rect={r}
                    boxW={box.w}
                    boxH={box.h}
                    name={w.primary}
                    meta={`${t('sj.taste.mapNAlbums').replace('{n}', String(count))} · ${pct}%`}
                    avg={w.avg}
                    covers={worldCovers[r.i]}
                    selected={false}
                    dim={false}
                    enterState={entering == null ? null : entering === r.i ? 'target' : 'other'}
                    onClick={() => openWorldTile(r.i)}
                    title={`${w.label} · ${count} · ${pct}%${w.avg != null ? ` · ${w.avg.toFixed(2)}★` : ''}`}
                    ariaLabel={`${w.label} · ${pct}%`}
                  />
                );
              })}
            </div>
          ) : (
            <div key={`world-${world}`} className="taste-tiles taste-open absolute inset-0">
              {tagRects.map((r) => {
                const tg = openTags[r.i];
                if (!tg) return null;
                const selected = tag === tg.tag;
                const cnt = (albumsByTag.get(tg.tag) ?? []).length;
                return (
                  <MosaicTile
                    key={tg.tag}
                    rect={r}
                    boxW={box.w}
                    boxH={box.h}
                    name={tg.display}
                    meta={t('sj.taste.mapNAlbums').replace('{n}', String(cnt))}
                    avg={tg.avg}
                    covers={(albumsByTag.get(tg.tag) ?? [])
                      .filter((a) => a.coverUrl)
                      .map((a) => a.coverUrl as string)}
                    selected={selected}
                    dim={!!tag && !selected}
                    enterState={null}
                    onClick={() => setTag(selected ? null : tg.tag)}
                    title={`${tg.display} · ${cnt} · ${tg.avg.toFixed(2)}★`}
                    ariaLabel={`${tg.display} · ${tg.avg.toFixed(1)}★`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Breadcrumb — replaces the floating Back button; each crumb walks a level. */}
        {openWorld && (
          <div className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-surface/85 border border-divider px-2.5 py-1.5 text-[12px] backdrop-blur-md shadow-sm">
            <button
              type="button"
              onClick={() => {
                setTag(null);
                setWorld(null);
              }}
              className="font-semibold text-muted hover:text-ink transition"
            >
              {t('sj.taste.mapAllWorlds')}
            </button>
            <ChevronRight size={13} className="text-muted/50 shrink-0" />
            <button
              type="button"
              onClick={() => setTag(null)}
              className={`font-semibold transition ${openTag ? 'text-muted hover:text-ink' : 'text-ink'}`}
            >
              {openWorld.primary}
            </button>
            {openTag && (
              <>
                <ChevronRight size={13} className="text-muted/50 shrink-0" />
                <span className="font-semibold text-ink">{openTag.display}</span>
              </>
            )}
          </div>
        )}

        {/* Legend in its own footer strip — the ramp is the app's score scale,
            stated — so it never sits on top of a tile's label. */}
        <div className="flex items-center justify-end gap-1.5 border-t border-divider/60 px-3 py-1.5">
          <span className="text-[10px] text-muted tabular-nums">1</span>
          <span
            className="h-[6px] w-16 rounded-full"
            style={{
              background: `linear-gradient(to right, ${[1, 2, 3, 4, 5]
                .map((s) => spectrumColor(s, 0.58, 1))
                .join(', ')})`,
            }}
          />
          <span className="text-[10px] text-muted tabular-nums">5</span>
          <span className="text-[10px] text-muted">{t('sj.taste.mapLegendScore')}</span>
        </div>
      </div>

      {/* ── Inspector ── */}
      <aside className="rounded-2xl bg-page border border-divider/60 px-4 py-4 min-h-[220px]">
        {!openWorld ? (
          <div>
            <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-muted/60">
              {t('sj.taste.mapExplore')}
            </p>
            <p className="mt-1.5 text-[12.5px] text-muted leading-relaxed">{t('sj.taste.mapHint')}</p>
            <div className="mt-3 space-y-1">
              {worldOrder.map((i) => {
                const w = worlds[i];
                const cover = worldCovers[i][0] ?? null;
                return (
                  <div
                    key={w.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => openWorldTile(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openWorldTile(i);
                      }
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-ink/[0.04] transition"
                  >
                    <Cover url={cover} className="w-9 h-9" rounded="rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">
                        {w.label}
                      </span>
                      <span className="mt-1 block h-[3px] rounded-full bg-divider/60 overflow-hidden">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(4, Math.round(w.share * 100))}%`,
                            background: spectrumColor(w.avg ?? 3, 0.58, 1),
                          }}
                        />
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                      {Math.round(w.share * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-muted/60">
              {openTag ? openWorld.label : t('sj.taste.mapWorld')}
            </p>
            <h3 className="mt-0.5 text-[15px] font-bold text-ink leading-tight">
              {openTag ? openTag.display : openWorld.label}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-muted">
              {openWorld.note && !openTag ? `${openWorld.note} · ` : ''}
              {t('sj.taste.mapAvg').replace(
                '{avg}',
                (openTag ? openTag.avg : openWorld.avg ?? 0).toFixed(2),
              )}
            </p>

            <p className="mt-4 text-[10px] font-bold tracking-[0.08em] uppercase text-muted/60">
              {t('sj.taste.mapYourAlbums')}
            </p>
            {focusAlbums.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-muted">{t('sj.taste.mapNoAlbums')}</p>
            ) : (
              <ul className="mt-2 space-y-2 max-h-[240px] overflow-y-auto pr-2.5 [scrollbar-gutter:stable]">
                {focusAlbums.map((a) => (
                  <li key={a.id}>
                    <Link href={`/album/${a.id}`} className="flex items-center gap-2 group">
                      <Cover url={a.coverUrl} className="w-8 h-8" rounded="rounded-md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-ink group-hover:underline">
                          {a.title}
                        </span>
                        <span className="block truncate text-[11px] text-muted">{a.artist}</span>
                      </span>
                      <span
                        className="text-[11.5px] font-bold tabular-nums"
                        style={{ color: spectrumNumber(a.score) }}
                      >
                        {a.score.toFixed(1)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {focusRecs.length > 0 && (
              <>
                <p className="mt-4 text-[10px] font-bold tracking-[0.08em] uppercase text-muted/60">
                  {recsFallback
                    ? t('sj.taste.mapMoreIn').replace('{world}', openWorld.primary)
                    : t('sj.taste.mapRecs')}
                </p>
                <ul className="mt-2 space-y-2">
                  {focusRecs.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <Link href={`/album/${r.id}`} className="flex items-center gap-2 group">
                        <Cover url={r.coverUrl} className="w-8 h-8" rounded="rounded-md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-ink group-hover:underline">
                            {r.title}
                          </span>
                          <span className="block truncate text-[11px] text-muted">{r.artist}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// The release-year histogram moved to TasteCharts.tsx (`YearChart`) in the
// 2026-08-10 report rebuild — it gained the era band and a real hover layer.
