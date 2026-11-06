'use client';

/**
 * Four schematic styles side by side on the same map (lib/tasteMap/styles.ts),
 * to choose a direction for the 2D schematic: tile map, contour ink, taste
 * fingerprint, similarity tree. Static SVG in the site's print look (paper,
 * ink, hairlines, italic serif names); hover a mark for its artist. A prototype:
 * English only, no zoom.
 */
import { useMemo } from 'react';
import { oklabToRgb, rgbCss } from '../../../lib/tasteMap/color';
import type { Atlas } from '../../../lib/tasteMap/regions';
import { schematicLayout } from '../../../lib/tasteMap/schematic';
import { similarityLookup } from '../../../lib/tasteMap/similarity';
import { contourInk, dendrogram, fingerprint, hexTiles, type StyleNode } from '../../../lib/tasteMap/styles';
import type { NodeKey, TasteMapPayload, Vec2 } from '../../../lib/tasteMap/types';

const INK = 'rgb(var(--color-ink))';
const MID = 'rgb(var(--color-mid))';
const MUTED = 'rgb(var(--color-muted))';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const TAU = Math.PI * 2;

const hueRgb = (hue: number | null, L = 0.62, C = 0.13) =>
  hue == null ? null : oklabToRgb(L, C * Math.cos((hue * Math.PI) / 180), C * Math.sin((hue * Math.PI) / 180));
const hueCss = (hue: number | null, alpha = 1, L?: number, C?: number) => {
  const c = hueRgb(hue, L, C);
  return c ? rgbCss(c, alpha) : alpha >= 1 ? MID : `rgb(var(--color-mid) / ${alpha})`;
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Props {
  payload: TasteMapPayload;
  atlas: Atlas;
  visible: Set<NodeKey>;
}

export default function SchematicCompare({ payload, atlas, visible }: Props) {
  const data = useMemo(() => {
    const solid = payload.nodes.filter((n) => visible.has(n.key) && !n.ghost);
    const sch = schematicLayout(
      solid.map((n) => ({ key: n.key, pos2d: n.pos2d, mass: n.mass })),
      payload.neighbors,
    );
    const nodes: StyleNode[] = solid.map((n) => {
      const country = atlas.countryOf.get(n.key) ?? -1;
      return {
        key: n.key,
        label: n.eraLabel ? `${n.label} ’${n.eraLabel.slice(2, 4)}` : n.label,
        mass: n.mass,
        avgScore: n.avgScore,
        pos: sch.pos.get(n.key) ?? n.pos2d,
        realm: country >= 0 ? (atlas.countries[country]?.realm ?? -1) : -1,
        country,
      };
    });
    const lookup = similarityLookup(payload);
    return {
      nodes,
      byKey: new Map(nodes.map((n) => [n.key, n])),
      tiles: hexTiles(nodes),
      ink: contourInk(nodes),
      print: fingerprint(nodes),
      tree: dendrogram(nodes, (a, b) => lookup.get(a, b) ?? 0),
    };
  }, [payload, atlas, visible]);

  const realmName = (r: number) => atlas.realms[r]?.name ?? '';
  const realmHue = (r: number) => (r >= 0 ? (atlas.realms[r]?.hue ?? null) : null);
  const ctx = { data, realmName, realmHue };

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          n={5}
          title="Fingerprint"
          formula="r(θ) = 1 + 2 Σ (1 − k⁄K+1) Re cₖ e^{ikθ}"
          note="Your bearings around you as a Fourier series; dashed = fewer harmonics."
        >
          <FingerprintView {...ctx} />
        </Panel>
        <Panel n={3} title="Contour ink" formula="f(x) = Σ wᵢ exp(−|x − xᵢ|² ⁄ 2h²)" note="Density of the stars as isolines only; ▲ = each genre's summit.">
          <ContourView {...ctx} />
        </Panel>
        <Panel
          n={1}
          title="Tile map"
          formula="min Σ |xᵢ − c_σ(i)|²  over cells σ"
          note="One hexagon per artist, placed by optimal assignment; shade = your rating."
        >
          <TileView {...ctx} />
        </Panel>
        <Panel
          n={6}
          title="Similarity tree"
          formula="s(A, B) = mean s(a, b),  a ∈ A, b ∈ B"
          note="Average-linkage clustering; a branch joins at the similarity on the ruler."
        >
          <TreeView {...ctx} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ n, title, formula, note, children }: { n: number; title: string; formula: string; note: string; children: React.ReactNode }) {
  return (
    <figure className="rounded-2xl border border-divider bg-surface p-4">
      <figcaption className="mb-1 flex items-baseline gap-2">
        <span className="text-[11px] font-bold tabular-nums text-muted">{n}</span>
        <span className="text-[14px] font-extrabold tracking-tight text-ink">{title}</span>
        <span className="ml-auto truncate text-[11.5px] italic text-mid" style={{ fontFamily: SERIF }}>
          {formula}
        </span>
      </figcaption>
      {children}
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </figure>
  );
}

interface ViewProps {
  data: {
    nodes: StyleNode[];
    byKey: Map<NodeKey, StyleNode>;
    tiles: ReturnType<typeof hexTiles>;
    ink: ReturnType<typeof contourInk>;
    print: ReturnType<typeof fingerprint>;
    tree: ReturnType<typeof dendrogram>;
  };
  realmName: (r: number) => string;
  realmHue: (r: number) => number | null;
}

/** Fit points into a W×H box with a margin; returns the mapping and the scale. */
function fitBox(pts: Vec2[], W: number, H: number, margin: number, pad = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  }
  const k = Math.min((W - 2 * margin) / Math.max(x1 - x0, 1e-9), (H - 2 * margin) / Math.max(y1 - y0, 1e-9));
  const ox = (W - (x1 - x0) * k) / 2;
  const oy = (H - (y1 - y0) * k) / 2;
  return {
    k,
    at: ([x, y]: Vec2): Vec2 => [ox + (x - x0) * k, oy + (y - y0) * k],
  };
}

/**
 * Keep a caption inside the panel and off earlier captions: returns its x
 * (anchor 'start') after clamping, or null when it can't be placed by moving
 * outward up to `tries` steps along (dx, dy).
 */
function placeCaption(
  placed: { x: number; y: number; w: number; h: number }[],
  x: number,
  y: number,
  w: number,
  anchor: 'start' | 'middle' | 'end',
  W: number,
  H: number,
  step: [number, number] = [0, 0],
  tries = 4,
) {
  for (let t = 0; t <= tries; t++) {
    let left = (anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2) + step[0] * t;
    left = Math.max(4, Math.min(W - 4 - w, left));
    const top = Math.max(4, Math.min(H - 16, y + step[1] * t - 10));
    const box = { x: left - 2, y: top, w: w + 4, h: 13 };
    if (!placed.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) {
      placed.push(box);
      return { x: left, y: top + 10 };
    }
  }
  return null;
}
/** Rough width of spaced italic capitals. */
const capsWidth = (text: string, size: number, spacing: number) => text.length * (size * 0.68 + spacing);

const ringPath = (pts: Vec2[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z';

// ── 1. Tile map ──────────────────────────────────────────────────────────────

function TileView({ data, realmName, realmHue }: ViewProps) {
  const W = 420;
  const H = 360;
  const { tiles, edges, side } = data.tiles;
  if (!tiles.length) return null;
  const { k, at } = fitBox(
    tiles.map((t) => [t.x, t.y]),
    W,
    H,
    46,
    side,
  );
  const hex = (x: number, y: number, s: number) =>
    ringPath(
      Array.from({ length: 6 }, (_, i) => [x + s * Math.cos(((-90 + 60 * i) * Math.PI) / 180), y + s * Math.sin(((-90 + 60 * i) * Math.PI) / 180)] as Vec2),
    );
  // Realm labels: outside the land, along the line from the center through the realm.
  const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
  const cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  const realms = [...new Set(tiles.map((t) => data.byKey.get(t.key)!.realm))].filter((r) => r >= 0);
  const labels = realms.map((r) => {
    const ts = tiles.filter((t) => data.byKey.get(t.key)!.realm === r);
    const mx = ts.reduce((s, t) => s + t.x, 0) / ts.length;
    const my = ts.reduce((s, t) => s + t.y, 0) / ts.length;
    let dx = mx - cx;
    let dy = my - cy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    if (Math.hypot(mx - cx, my - cy) < 0.5) [dx, dy] = [0, -1];
    const far = Math.max(...ts.map((t) => (t.x - mx) * dx + (t.y - my) * dy));
    const from = at([mx + dx * (far + side), my + dy * (far + side)]);
    const to = at([mx + dx * (far + side * 2.4), my + dy * (far + side * 2.4)]);
    return {
      r,
      from,
      to,
      anchor: (dx > 0.3 ? 'start' : dx < -0.3 ? 'end' : 'middle') as 'start' | 'end' | 'middle',
      below: dy > 0.3,
    };
  });
  // Captions avoid the tiles too.
  const captions = tiles.map((t) => {
    const [x, y] = at([t.x, t.y]);
    const r = side * k;
    return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Tile map">
      {tiles.map((t) => {
        const n = data.byKey.get(t.key)!;
        const [x, y] = at([t.x, t.y]);
        const shade = n.avgScore == null ? 0.25 : 0.12 + 0.13 * n.avgScore;
        const hue = realmHue(n.realm);
        return (
          <g key={t.key}>
            <title>{`${n.label} · ${realmName(n.realm)}${n.avgScore != null ? ` · ★ ${n.avgScore.toFixed(1)}` : ''}`}</title>
            <path d={hex(x, y, side * k * 0.93)} fill={hueCss(hue, shade, 0.7, 0.12)} />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(9, (1.5 * side * k) / (0.62 * Math.min(n.label.length, 7)))}
              fontWeight={600}
              fill={INK}
            >
              {short(n.label, 7)}
            </text>
          </g>
        );
      })}
      {edges.map((e, i) => {
        const [ax, ay] = at(e.a);
        const [bx, by] = at(e.b);
        return (
          <line
            key={i}
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke={INK}
            strokeOpacity={e.kind === 'province' ? 0.35 : 0.85}
            strokeWidth={e.kind === 'province' ? 0.7 : 1.3}
            strokeDasharray={e.kind === 'province' ? '2 2.5' : undefined}
            strokeLinecap="round"
          />
        );
      })}
      {labels.map((L) => {
        const text = realmName(L.r).toUpperCase();
        const at = placeCaption(captions, L.to[0], L.to[1] + (L.below ? 9 : -3), capsWidth(text, 11, 1.6), L.anchor, W, H, [0, L.below ? 12 : -12]);
        if (!at) return null;
        return (
          <g key={L.r}>
            {/* The leader only while the caption sits where it points. */}
            {Math.hypot(
              at.x - (L.anchor === 'start' ? L.to[0] : L.anchor === 'end' ? L.to[0] - capsWidth(text, 11, 1.6) : L.to[0] - capsWidth(text, 11, 1.6) / 2),
              at.y - (L.to[1] + (L.below ? 9 : -3)),
            ) < 6 && <line x1={L.from[0]} y1={L.from[1]} x2={L.to[0]} y2={L.to[1]} stroke={INK} strokeOpacity={0.4} strokeWidth={0.6} />}
            <text
              x={at.x}
              y={at.y}
              textAnchor="start"
              fontFamily={SERIF}
              fontStyle="italic"
              fontSize={11}
              letterSpacing={1.6}
              fill={hueCss(realmHue(L.r), 1, 0.5, 0.12)}
            >
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 3. Contour ink ───────────────────────────────────────────────────────────

function ContourView({ data, realmName, realmHue }: ViewProps) {
  const W = 420;
  const H = 360;
  const { levels, summits, box } = data.ink;
  if (!levels.length) return null;
  const { at } = fitBox(
    [
      [box.x0, box.y0],
      [box.x1, box.y1],
    ],
    W,
    H,
    4,
  );
  // Star labels: heaviest first, skipped where they would collide.
  const boxes: { x: number; y: number; w: number; h: number }[] = summits.map((s) => {
    const [x, y] = at([s.x, s.y]);
    const w = realmName(s.realm).length * 7.4;
    return { x: x - w / 2, y: y - 22, w, h: 14 };
  });
  const placed = [...data.nodes]
    .sort((a, b) => b.mass - a.mass || (a.key < b.key ? -1 : 1))
    .flatMap((n) => {
      const [x, y] = at(n.pos);
      const b = { x: x + 4, y: y - 5, w: n.label.length * 4.9, h: 10 };
      if (b.x + b.w > W - 2 || boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) return [];
      boxes.push(b);
      return [n.key];
    });
  const shown = new Set(placed);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Contour map">
      {levels.map((L, i) => (
        <path
          key={i}
          d={L.rings.map((r) => ringPath(r.map((p) => at(p)))).join('')}
          fill="none"
          stroke={INK}
          strokeOpacity={i === 0 ? 0.55 : 0.14 + (0.32 * i) / levels.length}
          strokeWidth={i === 0 ? 1.1 : i % 4 === 0 ? 0.9 : 0.55}
        />
      ))}
      {data.nodes.map((n) => {
        const [x, y] = at(n.pos);
        return (
          <g key={n.key}>
            <title>{`${n.label} · ${realmName(n.realm)}`}</title>
            <circle cx={x} cy={y} r={1.4 + 0.9 * Math.sqrt(n.mass)} fill={INK} />
            {shown.has(n.key) && (
              <text x={x + 4} y={y + 3} fontSize={8.5} fill={MID}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
      {summits.map((s) => {
        const [x, y] = at([s.x, s.y]);
        const color = hueCss(realmHue(s.realm), 1, 0.5, 0.13);
        return (
          <g key={s.realm}>
            <path d={`M${x},${y - 12}l4.5,7h-9z`} fill={color} />
            <text x={x} y={y - 16} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontSize={10.5} letterSpacing={1.5} fill={color}>
              {realmName(s.realm).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 5. Fingerprint ───────────────────────────────────────────────────────────

function FingerprintView({ data, realmName, realmHue }: ViewProps) {
  const W = 420;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = 96;
  const { curves, samples, harmonics, bearing, arcs, lean } = data.print;
  const polar = (t: number, r: number): Vec2 => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  const curve = (rs: number[]) => ringPath(rs.map((r, i) => polar((TAU * i) / samples, r * R)));
  const last = curves[curves.length - 1];
  const arcPath = (from: number, to: number, r: number) => {
    const [x0, y0] = polar(from, r);
    const [x1, y1] = polar(to, r);
    return `M${x0},${y0}A${r},${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const c1 = harmonics[0] ?? 0;
  const c2 = harmonics[1] ?? 0;
  const captions: { x: number; y: number; w: number; h: number }[] = [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Taste fingerprint">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={f * R} fill="none" stroke={INK} strokeOpacity={0.08} strokeWidth={0.6} />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = polar((TAU * i) / 12, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={INK} strokeOpacity={0.06} strokeWidth={0.6} />;
      })}
      {curves.slice(0, -1).map((c, i) => (
        <path key={c.k} d={curve(c.r)} fill="none" stroke={INK} strokeOpacity={0.18 + 0.12 * i} strokeWidth={0.7} strokeDasharray="2 3" />
      ))}
      <path d={curve(last.r)} fill={INK} fillOpacity={0.06} stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      {/* The lean: the first harmonic as an arrow from you. */}
      <line x1={cx} y1={cy} x2={polar(lean, c1 * R * 1.6)[0]} y2={polar(lean, c1 * R * 1.6)[1]} stroke={INK} strokeWidth={1} />
      <circle cx={cx} cy={cy} r={2.4} fill={INK} />
      {/* Rug: one tick per star at its bearing. */}
      {data.nodes.map((n) => {
        const t = bearing.get(n.key)!;
        const [x0, y0] = polar(t, R + 6);
        const [x1, y1] = polar(t, R + 6 + 4 + 2 * Math.sqrt(n.mass));
        return (
          <line key={n.key} x1={x0} y1={y0} x2={x1} y2={y1} stroke={hueCss(realmHue(n.realm), 1, 0.55, 0.13)} strokeWidth={1.2}>
            <title>{`${n.label} · ${realmName(n.realm)}`}</title>
          </line>
        );
      })}
      {arcs.map((a) => {
        const color = hueCss(realmHue(a.realm), 1, 0.5, 0.13);
        const text = realmName(a.realm).toUpperCase();
        const [lx, ly] = polar(a.mid, R + 30);
        const anchor = Math.cos(a.mid) > 0.25 ? 'start' : Math.cos(a.mid) < -0.25 ? 'end' : 'middle';
        // Crowded labels step outward along their bearing.
        const at = placeCaption(captions, lx, ly + 3, capsWidth(text, 10, 1.2), anchor, W, H, [Math.cos(a.mid) * 6, Math.sin(a.mid) * 13], 6);
        return (
          <g key={a.realm}>
            {a.to - a.from > 0.02 && <path d={arcPath(a.from, a.to, R + 20)} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />}
            {at && (
              <text x={at.x} y={at.y} textAnchor="start" fontFamily={SERIF} fontStyle="italic" fontSize={10} letterSpacing={1.2} fill={color}>
                {text}
              </text>
            )}
          </g>
        );
      })}
      <text x={8} y={H - 8} fontFamily={SERIF} fontStyle="italic" fontSize={11} fill={MID}>
        {`|c₁| = ${c1.toFixed(2)}   |c₂| = ${c2.toFixed(2)}   K = ${curves.map((c) => c.k).join(', ')}`}
      </text>
    </svg>
  );
}

// ── 6. Similarity tree ───────────────────────────────────────────────────────

function TreeView({ data, realmName, realmHue }: ViewProps) {
  const { root, order } = data.tree;
  if (!root) return null;
  const W = 420;
  const row = 11.5;
  const top = 10;
  const H = top + order.length * row + 34;
  const left = 14;
  const right = W - 128;
  // The lowest join sets the ruler's left end, rounded down to a tenth.
  let lo = 1;
  const walk = (t: typeof root) => {
    lo = Math.min(lo, t.height);
    t.children.forEach(walk);
  };
  walk(root);
  lo = Math.max(0, Math.floor(lo * 10) / 10);
  const X = (h: number) => left + ((h - lo) / Math.max(1 - lo, 1e-9)) * (right - left);
  const Y = (i: number) => top + (i + 0.5) * row;
  const yOf = (t: typeof root): number => (t.key != null ? Y(t.span[0]) : (yOf(t.children[0]) + yOf(t.children[t.children.length - 1])) / 2);
  const lines: React.ReactNode[] = [];
  const draw = (t: typeof root, parentX: number | null) => {
    const x = X(t.height);
    const y = yOf(t);
    const color = t.realm >= 0 ? hueCss(realmHue(t.realm), 1, 0.55, 0.13) : INK;
    if (parentX != null)
      lines.push(<line key={`h${lines.length}`} x1={parentX} y1={y} x2={x} y2={y} stroke={color} strokeWidth={0.9} strokeOpacity={t.realm >= 0 ? 1 : 0.7} />);
    if (t.children.length) {
      lines.push(
        <line
          key={`v${lines.length}`}
          x1={x}
          y1={yOf(t.children[0])}
          x2={x}
          y2={yOf(t.children[t.children.length - 1])}
          stroke={color}
          strokeWidth={0.9}
          strokeOpacity={t.realm >= 0 ? 1 : 0.7}
        />,
      );
      t.children.forEach((c) => draw(c, x));
    }
  };
  draw(root, null);
  const ticks = Array.from({ length: Math.round((1 - lo) * 10) + 1 }, (_, i) => +(lo + i / 10).toFixed(1));
  const axisY = top + order.length * row + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Similarity tree">
      {lines}
      {order.map((k, i) => {
        const n = data.byKey.get(k)!;
        return (
          <g key={k}>
            <title>{`${n.label} · ${realmName(n.realm)}`}</title>
            <circle cx={right + 6} cy={Y(i)} r={2.2} fill={hueCss(realmHue(n.realm), 1, 0.6, 0.13)} />
            <text x={right + 12} y={Y(i) + 3} fontSize={8.5} fill={INK}>
              {short(n.label, 22)}
            </text>
          </g>
        );
      })}
      <line x1={left} y1={axisY} x2={right} y2={axisY} stroke={INK} strokeOpacity={0.5} strokeWidth={0.6} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t)} y1={axisY} x2={X(t)} y2={axisY + 3} stroke={INK} strokeOpacity={0.5} strokeWidth={0.6} />
          <text x={X(t)} y={axisY + 13} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontSize={9} fill={MUTED}>
            {t}
          </text>
        </g>
      ))}
      <text x={right} y={axisY + 25} textAnchor="end" fontFamily={SERIF} fontStyle="italic" fontSize={9} fill={MUTED}>
        similarity s
      </text>
    </svg>
  );
}
