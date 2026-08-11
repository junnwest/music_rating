'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import Cover from './Cover';
import { useLanguage } from '../../lib/i18n';
import { spectrumColor, spectrumNumber } from '../../lib/sj/display';

/**
 * The taste map: a **treemap heatmap** of the user's taste worlds — one tile per
 * world, area ∝ their mass in it, colour ∝ how highly they rate it (the app's
 * score ramp). Click a world to drill into its sub-genres as their own tiles,
 * and pick a sub-genre to focus the side panel's albums + recommendations.
 *
 * Why a treemap replaced the old bubble field (2026-08-11): packed rectangles
 * give every world a legible, labelled area no matter how small its share is —
 * the old √share circles made minor worlds vanish into unreadable dots. The
 * colour language is unchanged (`spectrumColor`, the OKLCh score spectrum), so a
 * warm tile means the same thing as a warm score badge anywhere else; it stays
 * redundant with the label and the panel, and a legend states the scale.
 *
 * Layout is deterministic (squarified treemap over a fixed value order), so the
 * same profile always draws the same map and a refresh doesn't reshuffle it.
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
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
@keyframes taste-tiles-in{from{opacity:0}to{opacity:1}}
.taste-tiles{animation:taste-tiles-in 360ms ease}
.taste-tile{transition:filter 200ms ease, box-shadow 200ms ease, transform 200ms ease}
.taste-tile:hover{filter:brightness(1.07) saturate(1.05)}
.taste-tile:focus-visible{outline:none}
@media (prefers-reduced-motion: reduce){
  .taste-tiles{animation:none}
  .taste-tile{transition:none}
}
`;

/** A single heatmap tile — a world at the top level, a sub-genre when drilled in. */
function Tile({
  rect,
  label,
  sub,
  avg,
  selected,
  dim,
  onClick,
  title,
  ariaLabel,
}: {
  rect: Rect;
  label: string;
  sub: string;
  avg: number | null;
  selected: boolean;
  dim: boolean;
  onClick: () => void;
  title: string;
  ariaLabel: string;
}) {
  // Big enough for text? (percent thresholds — the map box is ~1:1). Tiny tiles
  // keep their colour + tooltip but drop the label rather than overflow it.
  const showLabel = rect.w > 12 && rect.h > 9;
  const showSub = showLabel && rect.w > 18 && rect.h > 16;
  const score = avg ?? 3;
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className="taste-tile absolute block text-left overflow-hidden"
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        opacity: dim ? 0.32 : 1,
        transitionProperty: 'opacity, filter, box-shadow, transform',
      }}
    >
      <span
        className="absolute inset-[3px] rounded-xl overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(155deg, ${spectrumColor(score, 0.68, 0.92)}, ${spectrumColor(
            score,
            0.5,
            1,
          )})`,
          boxShadow: selected
            ? '0 0 0 2px #fff, 0 0 0 3.5px rgba(0,0,0,0.28)'
            : 'inset 0 1px 0 rgba(255,255,255,0.14)',
        }}
      >
        {/* Bottom scrim keeps white text legible across the whole ramp. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2"
          style={{ backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.34), transparent)' }}
        />
        {showLabel && (
          <span className="absolute inset-x-0 bottom-0 p-2 sm:p-2.5">
            <span
              className="block font-black text-white leading-tight tracking-tight line-clamp-2"
              style={{ fontSize: rect.w > 24 ? 15 : 13, textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
            >
              {label}
            </span>
            {showSub && (
              <span
                className="block mt-0.5 text-[11px] font-semibold text-white/85 tabular-nums"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
              >
                {sub}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export default function TasteGraph({ data }: { data: TasteGraphData }) {
  const { t } = useLanguage();
  const [world, setWorld] = useState<number | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const worlds = data.worlds;

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
    // Map rect.i (position in worldOrder) back to the real world index.
    return rects.map((r) => ({ ...r, i: worldOrder[r.i] }));
  }, [worldOrder, worlds]);

  const openWorld = world != null ? worlds[world] : null;

  const tagOrder = useMemo(() => {
    if (!openWorld) return [];
    return openWorld.tags.map((_, i) => i).sort((a, b) => openWorld.tags[b].share - openWorld.tags[a].share);
  }, [openWorld]);
  const tagRects = useMemo(() => {
    if (!openWorld) return [];
    const rects = squarify(
      tagOrder.map((i) => Math.max(openWorld.tags[i].share, 0.02)),
      100,
      100,
    );
    return rects.map((r) => ({ ...r, i: tagOrder[r.i] }));
  }, [openWorld, tagOrder]);

  // Escape backs out one level — the same order the Back button walks.
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

  const openTag = openWorld && tag ? openWorld.tags.find((x) => x.tag === tag) ?? null : null;

  const focusTags = useMemo(() => {
    if (!openWorld) return null;
    return new Set(openTag ? [openTag.tag] : openWorld.tags.map((x) => x.tag));
  }, [openWorld, openTag]);

  const focusAlbums = useMemo(() => {
    if (!focusTags) return [];
    return data.albums.filter((a) => a.tags.some((x) => focusTags.has(x))).slice(0, PANEL_ALBUMS);
  }, [data.albums, focusTags]);

  const focusRecs =
    openTag != null
      ? data.recs[`tag:${openTag.tag}`] ?? (openWorld ? data.recs[openWorld.key] : undefined) ?? []
      : openWorld
        ? data.recs[openWorld.key] ?? []
        : [];

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_264px]">
      <style>{MAP_CSS}</style>

      {/* ── The heatmap ── */}
      <div className="relative rounded-2xl bg-surface border border-divider/60 overflow-hidden">
        <div className="relative w-full h-[360px] sm:h-[440px]">
          {!openWorld ? (
            <div key="worlds" className="taste-tiles absolute inset-0">
              {worldRects.map((r) => {
                const w = worlds[r.i];
                const pct = Math.round(w.share * 100);
                return (
                  <Tile
                    key={w.key}
                    rect={r}
                    label={w.primary}
                    sub={`${pct}%${w.avg != null ? ` · ${w.avg.toFixed(1)}★` : ''}`}
                    avg={w.avg}
                    selected={false}
                    dim={false}
                    onClick={() => {
                      setTag(null);
                      setWorld(r.i);
                    }}
                    title={`${w.label} · ${pct}%${w.avg != null ? ` · ${w.avg.toFixed(2)}★` : ''}`}
                    ariaLabel={`${w.label} · ${pct}%`}
                  />
                );
              })}
            </div>
          ) : (
            <div key={`world-${world}`} className="taste-tiles absolute inset-0">
              {tagRects.map((r) => {
                const tg = openWorld.tags[r.i];
                if (!tg) return null;
                const selected = tag === tg.tag;
                return (
                  <Tile
                    key={tg.tag}
                    rect={r}
                    label={tg.display}
                    sub={`${tg.avg.toFixed(1)}★`}
                    avg={tg.avg}
                    selected={selected}
                    dim={!!tag && !selected}
                    onClick={() => setTag(selected ? null : tg.tag)}
                    title={`${tg.display} · ${tg.avg.toFixed(2)}★`}
                    ariaLabel={`${tg.display} · ${tg.avg.toFixed(1)}★`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {world != null && (
          <button
            type="button"
            onClick={() => (tag ? setTag(null) : setWorld(null))}
            className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-surface/90 border border-divider text-[12px] font-semibold text-ink backdrop-blur hover:bg-surface transition"
          >
            <ChevronLeft size={14} />
            {t('sj.taste.mapBack')}
          </button>
        )}

        {/* Sequential legend: the ramp is the app's score scale, stated. */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-surface/90 border border-divider px-2.5 py-1 backdrop-blur">
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

      {/* ── Side panel ── */}
      <aside className="rounded-2xl bg-page border border-divider/60 px-4 py-4 min-h-[220px]">
        {!openWorld ? (
          <div>
            <p className="text-[12.5px] text-muted">{t('sj.taste.mapHint')}</p>
            <div className="mt-3 space-y-1.5">
              {worlds.map((w, i) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => {
                    setTag(null);
                    setWorld(i);
                  }}
                  className="block w-full rounded-lg px-1.5 py-1.5 text-left hover:bg-ink/[0.04] transition"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: spectrumColor(w.avg ?? 3, 0.58, 1) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                      {w.label}
                    </span>
                    <span className="text-[11.5px] tabular-nums text-muted">
                      {Math.round(w.share * 100)}%
                    </span>
                  </span>
                  <span className="mt-1 ml-[18px] block h-[3px] rounded-full bg-divider/60 overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(3, Math.round(w.share * 100))}%`,
                        background: spectrumColor(w.avg ?? 3, 0.58, 1),
                      }}
                    />
                  </span>
                </button>
              ))}
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
              <ul className="mt-2 space-y-2 max-h-[210px] overflow-y-auto pr-1">
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
                  {t('sj.taste.mapRecs')}
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
