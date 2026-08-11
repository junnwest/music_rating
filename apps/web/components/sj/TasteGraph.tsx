'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import Cover from './Cover';
import { useLanguage } from '../../lib/i18n';
import { spectrumColor, spectrumNumber } from '../../lib/sj/display';

/**
 * The taste map: one soft bubble per taste world, area ∝ the user's mass in it,
 * positioned by embedding similarity, coloured by how highly they rate it — then
 * a Prezi-style zoom into a world to see its sub-genres as their own bubbles.
 *
 * Design notes:
 * - **Area, not radius, carries magnitude** (r ∝ √share), which is the only
 *   honest way to size a circle.
 * - **Colour is the app's score ramp** (`spectrumColor`, #2's OKLCh spectrum), so
 *   a bubble's warmth means the same thing here as a score badge anywhere else.
 *   It's redundant with the labels and the panel, never the sole encoding, and a
 *   legend states the scale.
 * - **The camera is one CSS transform on a single `<g>`**, so the zoom is
 *   GPU-composited rather than a per-frame React render; the drift is a CSS
 *   keyframe per bubble for the same reason. Both are disabled under
 *   `prefers-reduced-motion`.
 * - Layout is deterministic (fixed-seed ring init, no RNG): the same profile
 *   always draws the same map, so a refresh doesn't reshuffle the user's world.
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

const VIEW = 100;
const PANEL_ALBUMS = 10;

interface Node {
  x: number;
  y: number;
  r: number;
}

/**
 * Stress-relaxation layout: pairs are pulled toward a distance that grows with
 * embedding *dis*similarity and can never fall below their radii, so similar
 * genres end up adjacent and nothing overlaps. Deterministic — the ring init is
 * index-based, there is no jitter — and O(iterations · n²) on n ≤ 8.
 */
function layoutBySimilarity(radii: number[], sim: number[][]): { x: number; y: number }[] {
  const n = radii.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const sumR = radii.reduce((s, r) => s + r, 0);
  const avgR = sumR / n;
  const ring = sumR / Math.PI + avgR;
  const pts = radii.map((_, i) => ({
    x: Math.cos((2 * Math.PI * i) / n) * ring,
    y: Math.sin((2 * Math.PI * i) / n) * ring,
  }));
  const target = (i: number, j: number) => {
    const s = Math.max(0, Math.min(1, sim[i]?.[j] ?? 0));
    return (radii[i] + radii[j]) * 1.12 + 1.5 * avgR * (1 - s);
  };

  for (let step = 0; step < 240; step += 1) {
    const damp = 0.25 * (1 - step / 320);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy) || 0.001;
        const k = ((d - target(i, j)) / d) * damp;
        pts[i].x += dx * k;
        pts[i].y += dy * k;
        pts[j].x -= dx * k;
        pts[j].y -= dy * k;
      }
    }
    // Weak pull to the origin so the field stays compact instead of drifting apart.
    for (const p of pts) {
      p.x *= 0.996;
      p.y *= 0.996;
    }
  }

  // Hard separation pass — similarity is a preference, overlap is not allowed.
  for (let step = 0; step < 60; step += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = radii[i] + radii[j] + 0.05 * avgR;
        if (d >= min) continue;
        const k = ((min - d) / d) * 0.5;
        pts[i].x -= dx * k;
        pts[i].y -= dy * k;
        pts[j].x += dx * k;
        pts[j].y += dy * k;
      }
    }
  }
  return pts;
}

/** Scale a raw layout into a `size`-square box with `pad` breathing room. */
function fitToBox(
  pts: { x: number; y: number }[],
  radii: number[],
  size = VIEW,
  pad = 4,
): Node[] {
  if (pts.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pts.forEach((p, i) => {
    minX = Math.min(minX, p.x - radii[i]);
    minY = Math.min(minY, p.y - radii[i]);
    maxX = Math.max(maxX, p.x + radii[i]);
    maxY = Math.max(maxY, p.y + radii[i]);
  });
  const w = Math.max(maxX - minX, 0.001);
  const h = Math.max(maxY - minY, 0.001);
  const k = (size - pad * 2) / Math.max(w, h);
  const offX = (size - w * k) / 2 - minX * k;
  const offY = (size - h * k) / 2 - minY * k;
  return pts.map((p, i) => ({ x: p.x * k + offX, y: p.y * k + offY, r: radii[i] * k }));
}

const KEYFRAMES = `
@keyframes taste-drift-a{from{transform:translate(0,0)}to{transform:translate(0.9px,-0.7px)}}
@keyframes taste-drift-b{from{transform:translate(0,0)}to{transform:translate(-0.8px,0.8px)}}
@keyframes taste-drift-c{from{transform:translate(0,0)}to{transform:translate(0.6px,0.9px)}}
.taste-bubble{animation-duration:7s;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.taste-bubble:hover{filter:brightness(1.05) saturate(1.1)}
@media (prefers-reduced-motion: reduce){
  .taste-bubble{animation:none!important}
  .taste-camera{transition:none!important}
}
`;

export default function TasteGraph({ data }: { data: TasteGraphData }) {
  const { t } = useLanguage();
  const uid = useId().replace(/:/g, '');
  const [world, setWorld] = useState<number | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const worlds = data.worlds;

  const nodes = useMemo(() => {
    const radii = worlds.map((w) => Math.sqrt(Math.max(w.share, 0.004)));
    return fitToBox(
      layoutBySimilarity(
        radii,
        worlds.map((w) => w.sim),
      ),
      radii,
    );
  }, [worlds]);

  // Sub-genre bubbles for the open world, packed inside its circle.
  const subNodes = useMemo(() => {
    if (world == null || !worlds[world] || !nodes[world]) return [];
    const w = worlds[world];
    const radii = w.tags.map((tg) => Math.sqrt(Math.max(tg.share, 0.01)));
    const local = fitToBox(layoutBySimilarity(radii, w.tagSim), radii, VIEW, 6);
    const parent = nodes[world];
    // Scale by the furthest bubble EDGE from the centre, not by the box's half
    // width — a square box's corner sits 1.41× further out than its edge, and a
    // sub-genre poking out of its parent circle would read as a sibling.
    const reach = Math.max(
      ...local.map((n) => Math.hypot(n.x - VIEW / 2, n.y - VIEW / 2) + n.r),
      0.001,
    );
    const k = (parent.r * 0.94) / reach;
    return local.map((n) => ({
      x: parent.x + (n.x - VIEW / 2) * k,
      y: parent.y + (n.y - VIEW / 2) * k,
      r: n.r * k,
    }));
  }, [world, worlds, nodes]);

  const camera = useMemo(() => {
    if (world == null || !nodes[world]) return { k: 1, tx: 0, ty: 0 };
    const n = nodes[world];
    const k = Math.min(14, (VIEW / 2) / Math.max(n.r * 1.15, 0.001));
    return { k, tx: VIEW / 2 - k * n.x, ty: VIEW / 2 - k * n.y };
  }, [world, nodes]);

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

  const openWorld = world != null ? worlds[world] : null;
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

  const colorAt = (avg: number | null) => spectrumColor(avg ?? 3, 0.62, 1);

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_264px]">
      <style>{KEYFRAMES}</style>

      {/* ── The map ── */}
      <div
        className="relative rounded-2xl bg-page border border-divider/60 overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(rgb(var(--color-divider)) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="block w-full touch-manipulation"
          style={{ aspectRatio: '1 / 1', maxHeight: 500 }}
          role="img"
          aria-label={t('sj.taste.mapHeader')}
        >
          <defs>
            <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
            {worlds.map((w, i) => (
              <radialGradient key={i} id={`${uid}-w${i}`} cx="38%" cy="34%" r="72%">
                <stop offset="0%" stopColor={spectrumColor(w.avg ?? 3, 0.82, 0.75)} />
                <stop offset="100%" stopColor={spectrumColor(w.avg ?? 3, 0.56, 1)} />
              </radialGradient>
            ))}
            {(openWorld?.tags ?? []).map((tg, i) => (
              <radialGradient key={tg.tag} id={`${uid}-t${i}`} cx="38%" cy="34%" r="72%">
                <stop offset="0%" stopColor={spectrumColor(tg.avg, 0.86, 0.7)} />
                <stop offset="100%" stopColor={spectrumColor(tg.avg, 0.6, 1)} />
              </radialGradient>
            ))}
          </defs>

          <g
            className="taste-camera"
            style={{
              transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.k})`,
              transformOrigin: '0 0',
              transition: 'transform 760ms cubic-bezier(0.22, 0.61, 0.36, 1)',
              willChange: 'transform',
            }}
          >
            {nodes.map((n, i) => {
              const w = worlds[i];
              const dimmed = world != null && world !== i;
              const isOpen = world === i;
              const pct = Math.round(w.share * 100);
              return (
                <g
                  key={w.key}
                  className="taste-bubble"
                  style={{
                    animationName: ['taste-drift-a', 'taste-drift-b', 'taste-drift-c'][i % 3],
                    animationDuration: `${6.5 + i * 0.9}s`,
                    animationDelay: `${i * 0.4}s`,
                    opacity: dimmed ? 0.18 : 1,
                    transition: 'opacity 500ms ease',
                    cursor: isOpen ? 'default' : 'pointer',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${w.label} · ${pct}%`}
                  onClick={() => {
                    setTag(null);
                    setWorld(isOpen ? null : i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setTag(null);
                    setWorld(isOpen ? null : i);
                  }}
                >
                  <title>{`${w.label} · ${pct}%${w.avg != null ? ` · ${w.avg.toFixed(2)}★` : ''}`}</title>
                  {/* Soft halo — the "organic" edge, drawn under the solid body. */}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r * 0.98}
                    fill={colorAt(w.avg)}
                    opacity={0.38}
                    filter={`url(#${uid}-soft)`}
                  />
                  <circle cx={n.x} cy={n.y} r={n.r} fill={`url(#${uid}-w${i})`} />
                  {!isOpen && n.r > 6 && (
                    <text
                      x={n.x}
                      y={n.y}
                      textAnchor="middle"
                      fill="#fff"
                      stroke="rgba(0,0,0,0.24)"
                      strokeWidth={n.r * 0.06}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    >
                      <tspan
                        x={n.x}
                        dy="-0.1em"
                        style={{
                          fontSize: Math.min(n.r * 0.3, (n.r * 1.9) / Math.max(6, w.primary.length)),
                          fontWeight: 800,
                        }}
                      >
                        {w.primary}
                      </tspan>
                      <tspan
                        x={n.x}
                        dy="1.25em"
                        opacity={0.9}
                        style={{ fontSize: Math.min(n.r * 0.26, 5), fontWeight: 800 }}
                      >
                        {pct}%
                      </tspan>
                    </text>
                  )}
                </g>
              );
            })}

            {/* Sub-genres of the open world, revealed inside its circle. */}
            {openWorld && (
              <g style={{ transition: 'opacity 400ms ease 200ms' }}>
                {subNodes.map((n, i) => {
                  const tg = openWorld.tags[i];
                  if (!tg) return null;
                  const selected = tag === tg.tag;
                  return (
                    <g
                      key={tg.tag}
                      role="button"
                      tabIndex={0}
                      aria-label={`${tg.display} · ${tg.avg.toFixed(1)}`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTag(selected ? null : tg.tag);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        e.stopPropagation();
                        setTag(selected ? null : tg.tag);
                      }}
                    >
                      <title>{`${tg.display} · ${tg.avg.toFixed(2)}★`}</title>
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        fill={`url(#${uid}-t${i})`}
                        stroke={selected ? '#fff' : 'transparent'}
                        strokeWidth={n.r * 0.07}
                        opacity={tag && !selected ? 0.45 : 1}
                        style={{ transition: 'opacity 300ms ease' }}
                      />
                      {n.r > 1.2 && (
                        <text
                          x={n.x}
                          y={n.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#fff"
                          stroke="rgba(0,0,0,0.26)"
                          strokeWidth={n.r * 0.05}
                          paintOrder="stroke"
                          strokeLinejoin="round"
                          pointerEvents="none"
                          style={{
                            // Long tag names shrink to fit their bubble rather
                            // than spilling over the neighbours.
                            fontSize: Math.min(n.r * 0.34, (n.r * 1.7) / Math.max(4, tg.display.length)),
                            fontWeight: 800,
                          }}
                        >
                          {tg.display}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        </svg>

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
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-surface/85 border border-divider px-2.5 py-1 backdrop-blur">
          <span className="text-[10px] text-muted tabular-nums">1</span>
          <span
            className="h-[6px] w-16 rounded-full"
            style={{
              background: `linear-gradient(to right, ${[1, 2, 3, 4, 5]
                .map((s) => spectrumColor(s, 0.62, 1))
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
                      style={{ background: colorAt(w.avg) }}
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
                        background: colorAt(w.avg),
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
