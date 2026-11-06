'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { contourDensity, contours as gridContours } from 'd3-contour';
import { depthLightness, distortionRgb, GRAY, hueMap, nodeRgb, oklabToRgb, rgbCss, type MapLens, type Rgb } from '../../../lib/tasteMap/color';
import { colorField, spanningTree, tagGradients, type FieldPoint } from '../../../lib/tasteMap/fields';
import { egoLayout, EGO_MODES, hereQuery, VEC_H, VEC_W, whatsHere, type EgoLayout, type EgoMode, type HereSummary } from '../../../lib/tasteMap/focus';
import HereSuggestions from './HereSuggestions';
import {
  approach,
  coverAmount,
  coverHalf,
  coverThumb,
  labelBudget,
  magnify,
  parallaxShift,
  pickFocus,
  separate,
} from '../../../lib/tasteMap/lens2d';
import { dragImpact, type DragImpact } from '../../../lib/tasteMap/dragImpact';
import { toPlane } from '../../../lib/tasteMap/plane';
import { regionFields } from '../../../lib/tasteMap/regions';
import { fitName, labelRoom, LINE_HEIGHT } from '../../../lib/tasteMap/labelFit';
import { similarityLookup } from '../../../lib/tasteMap/similarity';
import type { NodeKey, TasteMapPayloadNode, Vec2 } from '../../../lib/tasteMap/types';
import { useLanguage } from '../../../lib/i18n';
import { X } from 'lucide-react';
import { InfoTip } from './ui';
import type { SceneGhost, SceneProps } from './TasteMapView';

/**
 * 2D taste map: a star chart of the payload's principal plane (`pos2d`), the
 * same canonical layout the 3D scene shows, flattened (plan D5). The stage is
 * always a dark sky, whatever the app theme; the shell around it is sillajuku.
 *
 * Layers, back to front:
 * - Graticule: a faint world-unit grid whose step snaps to 1/2/5 × 10ⁿ as you
 *   zoom, so scale stays legible.
 * - Color field (lib/tasteMap/fields colorField): a kernel-smoothed wash of the
 *   node colors under the current lens, opacity = listening density. Lens
 *   changes crossfade between two fields.
 * - Isodensity contours over every visible node (thin, topographic), and each
 *   group's outline at one density level in its own color.
 * - Constellation lines: the kNN graph's minimum spanning tree.
 * - Era trails (dashed), the selection's neighbor links (drawn on, 3b1b-style).
 * - Stars: additive glow + core, radius by mass. Color by lens (color.ts); in
 *   the genre lens, lightness = depth along the plane normal (lighter = nearer).
 * - Labels with greedy collision avoidance by priority; group names as
 *   spaced capitals at far zoom ("constellations").
 * - Compass (fields tagGradients): the directions the palette tags grow in.
 * - Countries (lib/tasteMap/regions.ts): kNN communities as density-clipped
 *   territories with a faint tint and a border. Countries sharing a genre
 *   name form one realm: one territory and one name, its countries drawn as
 *   provinces (dashed inner borders, small names of their central artists).
 *   Names are spaced italic capitals along the long axis, fitted into the
 *   territory (lib/tasteMap/labelFit.ts: tracking, then two lines, then size).
 *   Bundled arcs join countries (one per pair, width = summed link weight),
 *   bent through the bridge artist when there is one; bridges are diamonds.
 * - Labels never go under the stage's overlay controls (reserved boxes). Group
 *   names are drawn only when there are fewer than two realms.
 * - Distortion lens (honest map, lib/tasteMap/honesty.ts): stars colored by how
 *   much of their real neighborhood the plane keeps, with a fuzzy halo that
 *   widens as it tears; on select, links to torn neighbors are dashed and
 *   intruders (drawn close, not similar) get a dotted ring.
 *
 * - Schematic scale (the default; lib/tasteMap/schematic.ts): the same stars
 *   moved to an exaggerated, readable version of the plane (sounds fan out
 *   around "you", stars spread evenly, bonds pull crossovers between sounds).
 *   Every density layer (color field, contours, territories, group outlines)
 *   is computed again on the schematic positions, so overlaps emerge there
 *   too; switching scales crossfades the two sets while every star morphs
 *   between its two positions. The graticule is a scale, so only to scale.
 *   Dragging is off in the schematic (the shell sets editable).
 *
 * Interaction: pan by dragging the background, wheel / pinch to zoom, drag a
 * node to move + pin it (D5: x, y fixed, depth soft), pin badges (filled =
 * full pin, hollow = 2D pin). Draws on demand; an animation (focus, lens fade,
 * link draw-on, refocus, cursor lenses) keeps requesting frames only while it runs.
 *
 * Interactive layer (2026-11-05; lib/tasteMap/lens2d.ts + focus.ts):
 * - Cursor lenses (mouse only, off while dragging and under
 *   prefers-reduced-motion): depth parallax (stars shift against the cursor by
 *   their depth, the background stays, so the chart reads as a volume) and a
 *   soft Gaussian fisheye that spreads and grows stars near the cursor. Both
 *   ease in and out; positions are display-only, hit tests use what's drawn.
 * - Proximity reveal: stars brighten and grow as the cursor nears; the nearest
 *   gets its label, then a small card (era, albums, a depth bar), then its top
 *   sound-mix chips.
 * - Semantic zoom: a label budget that grows with zoom (shown labels keep their
 *   place, so they don't flicker), then album covers as the stars themselves
 *   (lazy, cached, thumbnails), with on-screen overlap removal.
 * - Refocus on select (Distance / Vector / Depth, or In place): the others
 *   animate, nearest first, into an ego view of the selected star; the color
 *   field is recomputed on the ego layout and crossfades; contours, territories
 *   and country names fade out; rings / axes / a horizon explain the new
 *   space. Esc, an empty click or deselect animates back to the saved view.
 * - What's here? (empty-space click with nothing selected): the field's
 *   kernel-weighted sound mix at that point and the nearest three artists.
 * - Ghost nodes (payload `ghost`): hollow, faint, dashed; never in the field,
 *   contours, territories or constellation lines; `hidden` ones aren't drawn.
 */

const GRID = 1000;
const FIELD_N = 160;
const MIN_K = 0.5;
const MAX_K = 10;
const LENS_MS = 650;
const LINK_MS = 550;
const REGION_N = 120;
const MORPH_MS = 900;
const TAU = Math.PI * 2;
/** Refocus: each star's move, and the spread of start times (nearest first). */
const EGO_MS = 760;
const EGO_STAGGER_MS = 260;
/** Proximity reveal: stars within ~2σ brighten; the nearest within CARD px gets a card, within CHIPS px its sound mix. */
const PROX_SIGMA = 55;
const PROX_CARD = 72;
const PROX_CHIPS = 28;
/** Cursor-lens smoothing time constants (ms). */
const TAU_PARALLAX = 260;
const TAU_FISHEYE = 70;
const TAU_STRENGTH = 180;
const TAU_SEPARATE = 140;
/** Parallax pivot moving to a newly focused star's depth, and its glow fading in / out. */
const TAU_PIVOT = 220;
const TAU_GLOW = 120;
const EGO_KEY = 'tasteMap.egoMode';
const INTRO_KEY = 'tasteMap.intro2d.v1';

type EgoPick = EgoMode | 'off';

const COPY2D = {
  en: {
    inPlace: 'In place',
    distance: 'Distance',
    vector: 'Vector',
    depth: 'Depth',
    inPlaceTip: 'Keep the map as it is',
    distanceTip: 'Everything else at its true similarity: rings at 0.8 / 0.6 / 0.4 / 0.2 / 0.1, bearing kept from the map',
    vectorTip: 'Left to right: less to more like the selection. Up and down: the strongest other difference among the rest',
    depthTip: 'The map seen from the side: up is in front of the selection, down is behind it',
    capDistance: (name: string) => `rings = true similarity to ${name}`,
    capVector: (name: string) => `→ more like ${name}`,
    capDepth: (name: string) => `↑ in front of ${name} · ↓ behind`,
    lessLike: 'less alike',
    more: (tag: string) => `more ${tag}`,
    toward: (name: string) => `toward ${name}`,
    inFront: (name: string) => `in front of ${name}`,
    behind: 'behind',
    front: 'front',
    back: 'back',
    mid: 'middle',
    depthWord: 'depth',
    albums: (n: number) => (n === 1 ? '1 rated album' : `${n} rated albums`),
    avg: 'avg',
    hereTitle: "What's here?",
    hereEmpty: 'Empty sky: nothing you rated is close.',
    hereSparse: 'Sparse: a few artists nearby',
    hereDense: 'Dense: a lot of your listening',
    hereNearest: 'Nearest',
    close: 'Close',
    viewModes: 'Refocus around the selection',
    info: 'About this',
    viewModesInfo:
      'When you select a star, the others can re-arrange around it. In place keeps the map. Distance puts everyone at their true similarity (the rings). Vector lines them up from less to more alike. Depth shows the map from the side.',
    hereInfo:
      'A smoothed mix of the sounds of the stars around this spot, weighted by how close they are and how much you rated them. The albums below are unrated catalog albums that would land here.',
    introTitle: 'Reading the sky',
    introHover: 'Rest the cursor near a star: it holds still and glows, and the sky turns around it. Stars that slide the same way as the cursor sit behind it; ones that slide the other way sit in front.',
    introClick: 'Click a star to select it. Click empty sky to see what sounds live there.',
    introDrag: 'In To scale, drag a star to move it where you think it belongs. A panel shows what the move changes. Ctrl+Z undoes it.',
    introTouch: 'Tap a star to select it, tap empty sky to see what lives there. Drag to pan, pinch to zoom.',
    gotIt: 'Got it',
    blockSchematic: 'Switch to To scale to move stars. The schematic is an exaggeration, so places there aren’t real.',
    blockRefocus: 'Pick In place to move stars. A refocused view isn’t the map’s real layout.',
    moving: 'Moving',
    moved: (pct: string) => `Moved ${pct} of the map`,
    soundAround: 'Sound around it',
    noSoundChange: 'Same sound neighborhood so far',
    nextTo: 'Now next to',
    leaving: 'Leaving',
    fitData: 'Fit with its most similar artists',
    fitOf: (a: number, k: number) => `${a} of ${k} nearby`,
    avgSim: 'Avg similarity to map neighbors',
    dropNote: 'Drop to pin it here. Where it disagrees with the data, Learn from my map (Weights) picks it up. Ctrl+Z undoes.',
  },
  ko: {
    inPlace: '그대로',
    distance: '거리',
    vector: '방향',
    depth: '깊이',
    inPlaceTip: '지도를 그대로 둬요',
    distanceTip: '나머지를 실제 유사도로 배치해요: 0.8 / 0.6 / 0.4 / 0.2 / 0.1 고리, 방향은 지도 그대로',
    vectorTip: '왼쪽에서 오른쪽: 선택한 아티스트와 덜 비슷한 → 더 비슷한. 위아래: 나머지 사이의 가장 큰 다른 차이',
    depthTip: '지도를 옆에서 본 모습: 위는 선택한 아티스트보다 앞, 아래는 뒤',
    capDistance: (name: string) => `고리 = ${name}와의 실제 유사도`,
    capVector: (name: string) => `→ ${name}와 더 비슷함`,
    capDepth: (name: string) => `↑ ${name}보다 앞 · ↓ 뒤`,
    lessLike: '덜 비슷함',
    more: (tag: string) => `${tag} 쪽`,
    toward: (name: string) => `${name} 쪽`,
    inFront: (name: string) => `${name}보다 앞`,
    behind: '뒤',
    front: '앞',
    back: '뒤',
    mid: '가운데',
    depthWord: '깊이',
    albums: (n: number) => `평가한 앨범 ${n}장`,
    avg: '평균',
    hereTitle: '여기엔 뭐가 있나요?',
    hereEmpty: '빈 하늘: 가까이에 평가한 아티스트가 없어요.',
    hereSparse: '드문 곳: 근처에 아티스트가 조금 있어요',
    hereDense: '밀집한 곳: 많이 듣는 곳이에요',
    hereNearest: '가장 가까운',
    close: '닫기',
    viewModes: '선택한 아티스트를 중심으로 다시 배치',
    info: '설명',
    viewModesInfo:
      '별을 선택하면 나머지를 그 별 중심으로 다시 놓을 수 있어요. 그대로는 지도를 유지해요. 거리는 모두를 실제 유사도(고리)에 놓아요. 방향은 덜 비슷한 → 더 비슷한 순으로 줄 세워요. 깊이는 지도를 옆에서 보여줘요.',
    hereInfo:
      '이 지점 주변 별들의 사운드를 거리와 평가한 앨범 수로 가중해 부드럽게 섞은 비율이에요. 아래 앨범은 여기에 놓일 만한, 아직 평가하지 않은 카탈로그 앨범이에요.',
    introTitle: '하늘 읽는 법',
    introHover: '커서를 별 가까이에 두면 그 별은 멈춰서 빛나고, 하늘이 그 별을 중심으로 돌아요. 커서와 같은 쪽으로 움직이는 별은 뒤에, 반대쪽으로 움직이는 별은 앞에 있어요.',
    introClick: '별을 클릭하면 선택돼요. 빈 하늘을 클릭하면 그곳의 사운드를 보여줘요.',
    introDrag: '실제 거리 보기에서 별을 끌어 어울리는 곳으로 옮길 수 있어요. 무엇이 바뀌는지 패널로 보여주고, Ctrl+Z로 되돌려요.',
    introTouch: '별을 탭하면 선택돼요. 빈 하늘을 탭하면 그곳에 뭐가 있는지 보여줘요. 끌어서 이동, 두 손가락으로 확대해요.',
    gotIt: '알겠어요',
    blockSchematic: '별을 옮기려면 실제 거리 보기로 바꿔주세요. 도식은 과장된 모습이라 위치가 실제가 아니에요.',
    blockRefocus: '별을 옮기려면 그대로를 골라주세요. 다시 배치한 보기는 지도의 실제 배치가 아니에요.',
    moving: '옮기는 중',
    moved: (pct: string) => `지도의 ${pct} 이동`,
    soundAround: '주변 사운드',
    noSoundChange: '아직 같은 사운드 동네예요',
    nextTo: '새 이웃',
    leaving: '멀어지는 이웃',
    fitData: '가장 비슷한 아티스트와의 일치',
    fitOf: (a: number, k: number) => `${k}명 중 ${a}명이 가까이`,
    avgSim: '지도 이웃과의 평균 유사도',
    dropNote: '놓으면 여기에 고정돼요. 데이터와 다른 부분은 내 지도로 학습(가중치)이 반영해요. Ctrl+Z로 되돌려요.',
  },
};

/** Album-cover images, shared across mounts. ok: null = loading, false = failed (the star is drawn instead). */
const coverCache = new Map<string, { img: HTMLImageElement; ok: boolean | null }>();

/** The sky. Fixed so the colors read the same in light and dark app themes. */
const SKY = {
  bg0: 'rgb(18, 21, 31)',
  bg1: 'rgb(7, 8, 13)',
  bg: 'rgb(10, 12, 18)',
  ink: 'rgb(234, 237, 245)',
  muted: 'rgb(140, 148, 168)',
  line: 'rgba(205, 218, 255, ',
};
const MATH_FONT = 'italic 11px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

interface View {
  k: number;
  tx: number;
  ty: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  key: NodeKey | null;
}

function nodeRadius(mass: number, k: number): number {
  return (2.2 + 1.9 * Math.sqrt(Math.max(mass, 0))) * Math.min(1.6, 0.8 + 0.2 * Math.sqrt(k));
}

/** 3b1b's `smooth`: an ease with zero slope at both ends. */
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lighten = (c: Rgb, t: number): Rgb => lerpRgb(c, [255, 255, 255], t);

/** A country's tint: its palette hue in OKLCh, or the sky's line color. */
const tintOf = (hue: number | null, L: number, C: number): Rgb =>
  hue == null ? [205, 218, 255] : oklabToRgb(L, C * Math.cos((hue * Math.PI) / 180), C * Math.sin((hue * Math.PI) / 180));

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A small push-pin badge at a node's upper right: filled = full pin, hollow = 2D pin (depth free). */
function drawPinBadge(ctx: CanvasRenderingContext2D, x: number, y: number, soft: boolean) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3.2, y - 3.2);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = SKY.bg;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = SKY.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 4.4, y - 4.4, 3.1, 0, Math.PI * 2);
  ctx.fillStyle = soft ? SKY.bg : SKY.ink;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = soft ? SKY.ink : SKY.bg;
  ctx.stroke();
  ctx.restore();
}

/** Nice grid step (1, 2 or 5 × 10ⁿ) at least `raw` long. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return p * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10);
}

/** A square field grid in plane units: its corner and cell size (GRID cells a side). */
interface GridFrame {
  gx0: number;
  gy0: number;
  gs: number;
}

/** A square grid over `pts` with a 25% margin for kernel falloff. */
function gridFrameOf(pts: Iterable<Vec2>): GridFrame & { mx: number; my: number; spanX: number; spanY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) {
    minX = -1;
    maxX = 1;
    minY = -1;
    maxY = 1;
  }
  const spanX = Math.max(maxX - minX, 0.2);
  const spanY = Math.max(maxY - minY, 0.2);
  const margin = Math.max(spanX, spanY) * 0.25;
  const gs = (Math.max(spanX, spanY) + 2 * margin) / GRID;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  return { mx, my, spanX, spanY, gx0: mx - (GRID * gs) / 2, gy0: my - (GRID * gs) / 2, gs };
}

/** A ghost (payload `ghost`) never weighs on the density layers; a hidden one isn't on the map at all. */
const isGhost = (n: TasteMapPayloadNode) => !!n.ghost;
const isHidden = (n: TasteMapPayloadNode) => !!n.ghost?.hidden;

/** Rounded-rect path (canvas roundRect is newer than some Safari versions). */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

function readEgoPick(): EgoPick {
  try {
    const v = window.localStorage.getItem(EGO_KEY);
    if (v === 'off' || (EGO_MODES as readonly string[]).includes(v ?? '')) return v as EgoPick;
  } catch {
    // Storage blocked: the default.
  }
  return 'distance';
}

export default function Map2D(props: SceneProps) {
  const { payload, focus, layoutVersion, busy, lens, basis, visible, honesty, atlas, scale, schematic } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const { lang } = useLanguage();
  const t2 = COPY2D[lang === 'ko' ? 'ko' : 'en'];
  const t2Ref = useRef(t2);
  t2Ref.current = t2;
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const goal = useRef<View | null>(null);
  const raf = useRef<number | null>(null);
  const labelBoxes = useRef<Box[]>([]);
  const measureCache = useRef(new Map<string, number>());

  // Lens crossfade and selection draw-on clocks (performance.now() ms).
  const lensAnim = useRef<{ from: MapLens; to: MapLens; t0: number }>({ from: lens, to: lens, t0: 0 });
  if (lensAnim.current.to !== lens) {
    lensAnim.current = { from: lensAnim.current.to, to: lens, t0: performance.now() };
  }
  const linkAnim = useRef<{ key: NodeKey | null; t0: number }>({ key: null, t0: 0 });
  if (linkAnim.current.key !== props.selectedKey) linkAnim.current = { key: props.selectedKey, t0: performance.now() };

  // Scale morph: s = 0 is the true plane, 1 the schematic. A toggle mid-morph starts from where it is.
  const sTarget = scale === 'schematic' && schematic ? 1 : 0;
  const morph = useRef({ s0: sTarget, s1: sTarget, t0: 0 });
  const morphAt = (now: number) => {
    const m = morph.current;
    return m.s0 === m.s1 ? m.s1 : m.s0 + (m.s1 - m.s0) * smooth((now - m.t0) / MORPH_MS);
  };
  if (morph.current.s1 !== sTarget) {
    const now = performance.now();
    morph.current = { s0: morphAt(now), s1: sTarget, t0: now };
  }
  // The morph as last drawn, for hit tests and drags between frames.
  const sNow = useRef(sTarget);

  // ── Interactive layer (refs: read by draw and the pointer handlers between renders) ──
  const reduced = useRef(false);
  /** The mouse on the stage (touch never sets `inside`: no hover on phones). */
  const cursor = useRef({ x: 0, y: 0, inside: false });
  /** Smoothed cursor lenses: parallax tilt (ux, uy ∈ [−1, 1]), fisheye center and strength. */
  const lensState = useRef({ ux: 0, uy: 0, fx: 0, fy: 0, str: 0 });
  const lastT = useRef(0);
  const pressing = useRef(false);
  const draggingNode = useRef(false);
  /** What was drawn last frame (after refocus and the lenses): hit tests use it. */
  const drawn = useRef(new Map<NodeKey, { x: number; y: number; r: number }>());
  /** Last frame's plane positions, refocus included: where a new refocus starts from. */
  const lastPlane = useRef(new Map<NodeKey, Vec2>());
  const sepOff = useRef(new Map<NodeKey, [number, number]>());
  /** The star the cursor is focused on (lens2d pickFocus), its glow levels, and the parallax pivot depth (σ). */
  const cursorFocus = useRef<NodeKey | null>(null);
  const glowLvl = useRef(new Map<NodeKey, number>());
  const pivot = useRef(0);
  const labelShown = useRef(new Set<NodeKey>());
  const [egoPick, setEgoPickState] = useState<EgoPick>(() => (typeof window === 'undefined' ? 'distance' : readEgoPick()));
  const setEgoPick = (m: EgoPick) => {
    setEgoPickState(m);
    try {
      window.localStorage.setItem(EGO_KEY, m);
    } catch {
      // Storage blocked: the pick lasts this visit.
    }
  };
  /** Refocus transition: every star from `from` (plane snapshot) to `to` (null = back to the map). */
  const ego = useRef<{
    from: Map<NodeKey, Vec2> | null;
    fromLayout: EgoLayout | null;
    to: EgoLayout | null;
    t0: number;
    dur: number;
    stagger: number;
  }>({ from: null, fromLayout: null, to: null, t0: 0, dur: 0, stagger: 0 });
  const preEgoView = useRef<View | null>(null);
  const [here, setHere] = useState<{ at: Vec2; summary: HereSummary; query: { keys: NodeKey[]; w: number[] }; sx: number; sy: number } | null>(null);
  const hereRef = useRef(here);
  hereRef.current = here;
  const hereCard = useRef<HTMLDivElement>(null);
  /** Drag HUD: what the move in progress changes (lib/tasteMap/dragImpact.ts). */
  const [dragHud, setDragHud] = useState<{ key: NodeKey; impact: DragImpact } | null>(null);
  const dragStart = useRef<{ key: NodeKey; start: Vec2 } | null>(null);
  /** A short hint when a star can't be moved in the current view (schematic or refocus). */
  const [grabbedSel, setGrabbedSel] = useState<NodeKey | null>(null);
  const [blockHint, setBlockHint] = useState<'schematic' | 'refocus' | null>(null);
  const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [touchOnly, setTouchOnly] = useState(false);
  useEffect(() => {
    setTouchOnly(window.matchMedia('(hover: none)').matches);
    try {
      setIntroOpen(window.localStorage.getItem(INTRO_KEY) !== '1');
    } catch {
      setIntroOpen(true);
    }
    return () => {
      if (blockTimer.current) clearTimeout(blockTimer.current);
    };
  }, []);
  const closeIntro = () => {
    setIntroOpen(false);
    try {
      window.localStorage.setItem(INTRO_KEY, '1');
    } catch {
      // Storage blocked: it shows again next visit.
    }
  };

  /** A node's plane position at morph `s`: its true `pos2d`, its schematic one, or between. */
  const placeAt = (n: { key: NodeKey; pos2d: Vec2 }, s: number): Vec2 => {
    const q = s > 0 ? propsRef.current.schematic?.pos.get(n.key) : undefined;
    if (!q) return n.pos2d;
    return s >= 1 ? q : [n.pos2d[0] + (q[0] - n.pos2d[0]) * s, n.pos2d[1] + (q[1] - n.pos2d[1]) * s];
  };
  /** The Add-artist ghost: in the schematic, moved as far as its anchors moved on average. */
  const ghostAt = (gh: SceneGhost, s: number): Vec2 => {
    const sch = propsRef.current.schematic;
    const nodes = propsRef.current.payload.nodes;
    let n = 0;
    let dx = 0;
    let dy = 0;
    for (const k of gh.anchors) {
      const q = s > 0 ? sch?.pos.get(k) : undefined;
      const t = nodes.find((m) => m.key === k);
      if (!q || !t) continue;
      dx += q[0] - t.pos2d[0];
      dy += q[1] - t.pos2d[1];
      n++;
    }
    if (!n) return gh.pos2d;
    return [gh.pos2d[0] + (dx / n) * s, gh.pos2d[1] + (dy / n) * s];
  };

  // Fixed world frame: bounds over every node (not just visible ones) so group
  // toggles never move the map. Keyed on the node array, which keeps its
  // identity while positions change in place, so drags and re-arranges don't
  // re-fit the view either.
  // Square grid cells over the bounds plus a margin for kernel falloff.
  const frame = useMemo(() => gridFrameOf(payload.nodes.map((n) => n.pos2d)), [payload.nodes]);

  const rank = useMemo(() => {
    const order = [...payload.nodes].sort((a, b) => b.mass - a.mass);
    return new Map(order.map((n, i) => [n.key, i]));
  }, [payload.nodes]);

  const hues = useMemo(() => hueMap(payload.palette), [payload.palette]);

  // Per-node color under both lenses. Genre lightness follows depth, which a
  // 3D drag or a re-arrange changes, so this follows the layout.
  const depth = useMemo(() => {
    const z = payload.nodes.map((n) => toPlane(n.pos, basis)[2]);
    const mean = z.reduce((s, x) => s + x, 0) / Math.max(1, z.length);
    const sigma = Math.sqrt(z.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, z.length));
    /** Depth in σ units (+ = in front), and the node's percentile front-to-back, 0…1. */
    const norm = new Map<NodeKey, number>();
    payload.nodes.forEach((n, i) => norm.set(n.key, sigma > 1e-9 ? (z[i] - mean) / sigma : 0));
    const sorted = [...z].sort((a, b) => a - b);
    const pct = new Map<NodeKey, number>();
    payload.nodes.forEach((n, i) => {
      let lo = 0;
      while (lo < sorted.length && sorted[lo] < z[i]) lo++;
      pct.set(n.key, sorted.length > 1 ? lo / (sorted.length - 1) : 0.5);
    });
    return { z, mean, sigma, norm, pct };
    // layoutVersion stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.nodes, basis, layoutVersion]);
  const depthRef = useRef(depth);
  depthRef.current = depth;

  const colors = useMemo(() => {
    const { z, mean, sigma } = depth;
    const out = new Map<NodeKey, Record<MapLens, Rgb>>();
    payload.nodes.forEach((n, i) => {
      out.set(n.key, {
        genre: nodeRgb(n, 'genre', hues, depthLightness(z[i] - mean, sigma, 0.74, 0.14)),
        score: nodeRgb(n, 'score', hues, 0.72),
        distortion: nodeRgb(n, 'distortion', hues, 0.72, honesty.byKey.get(n.key)?.recall),
      });
    });
    return out;
  }, [payload.nodes, hues, depth, honesty]);

  // Expensive per-layout geometry is frozen while a drag or re-arrange runs
  // (a field + contour pass per frame is too slow), then caught up.
  const [settled, setSettled] = useState(layoutVersion);
  useEffect(() => {
    if (!busy) setSettled(layoutVersion);
  }, [busy, layoutVersion]);

  type At = (n: TasteMapPayloadNode) => Vec2;
  const truePos: At = (n) => n.pos2d;
  const gridX = (x: number) => (x - frame.gx0) / frame.gs;
  const gridY = (y: number) => (y - frame.gy0) / frame.gs;

  // Color fields, one per lens, as offscreen canvases in grid space.
  const makeFields = (at: At, fr: GridFrame = frame) => {
    if (typeof document === 'undefined') return null;
    const shown = payload.nodes.filter((n) => visible.has(n.key) && !isGhost(n));
    const cell = (GRID * fr.gs) / FIELD_N;
    const grid = { x0: fr.gx0 + cell / 2, y0: fr.gy0 + cell / 2, cell, nx: FIELD_N, ny: FIELD_N };
    const bandwidth = 40 * frame.gs;
    const make = (l: MapLens) => {
      const pts: FieldPoint[] = shown.map((n) => {
        const [x, y] = at(n);
        return { x, y, w: 0.5 + 0.5 * Math.sqrt(Math.max(n.mass, 0)), rgb: colors.get(n.key)?.[l] ?? GRAY };
      });
      const data = colorField(pts, grid, bandwidth);
      const c = document.createElement('canvas');
      c.width = FIELD_N;
      c.height = FIELD_N;
      c.getContext('2d')?.putImageData(new ImageData(data, FIELD_N, FIELD_N), 0, 0);
      return c;
    };
    return { genre: make('genre'), score: make('score'), distortion: make('distortion'), fr };
  };

  // Isodensity contours over every visible node, and one outline per group.
  const makeContours = (at: At) => {
    if (typeof Path2D === 'undefined') return { all: [] as Path2D[], groups: [] as { id: string; color: string; path: Path2D | null }[] };
    const toPath = (coords: number[][][][]) => {
      const p = new Path2D();
      for (const poly of coords)
        for (const ring of poly) {
          ring.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
          p.closePath();
        }
      return p;
    };
    const shown = payload.nodes.filter((n) => visible.has(n.key) && !isGhost(n));
    const all = shown.length
      ? contourDensity<TasteMapPayloadNode>()
          .x((n) => gridX(at(n)[0]))
          .y((n) => gridY(at(n)[1]))
          .weight((n) => 0.5 + 0.5 * Math.sqrt(n.mass))
          .size([GRID, GRID])
          .cellSize(4)
          .bandwidth(36)
          .thresholds(9)(shown)
          .map((ct) => toPath(ct.coordinates))
      : [];
    const groups = payload.groups.map((g) => {
      const members = payload.nodes.filter((n) => !isGhost(n)).map((n) => ({ n, w: n.groups[g.id] ?? 0 })).filter((m) => m.w > 0.05);
      if (!members.length) return { id: g.id, color: g.color, path: null };
      const cs = contourDensity<{ n: TasteMapPayloadNode; w: number }>()
        .x((m) => gridX(at(m.n)[0]))
        .y((m) => gridY(at(m.n)[1]))
        .weight((m) => m.w * (0.5 + 0.5 * Math.sqrt(m.n.mass)))
        .size([GRID, GRID])
        .cellSize(4)
        .bandwidth(42)
        .thresholds(7)(members);
      return { id: g.id, color: g.color, path: cs[1] ? toPath(cs[1].coordinates) : null };
    });
    return { all, groups };
  };

  // Country territories (grid-unit paths) and label geometry (world units), per
  // country (province) and per realm (countries sharing a genre name).
  const makeRegions = (at: At) => {
    if (typeof Path2D === 'undefined') return { countries: [], realms: [] };
    const cell = (GRID * frame.gs) / REGION_N;
    const grid = { x0: frame.gx0 + cell / 2, y0: frame.gy0 + cell / 2, cell, nx: REGION_N, ny: REGION_N };
    const solid = payload.nodes.filter((n) => visible.has(n.key) && !isGhost(n) && atlas.countryOf.has(n.key));
    const scale = GRID / REGION_N;
    const territories = (unitOf: (k: NodeKey) => number, units: { id: number; hue: number | null }[]) => {
      const pts = solid.map((n) => ({ x: at(n)[0], y: at(n)[1], w: 0.5 + 0.5 * Math.sqrt(Math.max(n.mass, 0)), country: unitOf(n.key) }));
      const fields = regionFields(pts, grid, 48 * frame.gs, units.length);
      return units.flatMap((unit) => {
        const ms = solid.filter((n) => unitOf(n.key) === unit.id);
        if (ms.length < 2) return [];
        const f = fields[unit.id];
        const [ct] = gridContours().size([REGION_N, REGION_N]).thresholds([0])(Array.from(f));
        const path = new Path2D();
        const edge: [number, number][] = [];
        for (const poly of ct?.coordinates ?? [])
          for (const ring of poly) {
            ring.forEach(([x, y], i) => {
              if (i === 0) path.moveTo(x * scale, y * scale);
              else path.lineTo(x * scale, y * scale);
              edge.push([frame.gx0 + x * scale * frame.gs, frame.gy0 + y * scale * frame.gs]);
            });
            path.closePath();
          }
        let land = 0;
        for (let i = 0; i < f.length; i++) if (f[i] > 0) land++;
        const inside = (x: number, y: number) => {
          const i = Math.round((x - grid.x0) / cell);
          const j = Math.round((y - grid.y0) / cell);
          return i >= 0 && j >= 0 && i < REGION_N && j < REGION_N && f[j * REGION_N + i] > 0;
        };
        // Mass-weighted centroid and long axis of the members; when the centroid
        // falls outside the land (a realm in pieces), the heaviest piece's.
        const centroid = (ns: typeof ms) => {
          let sw = 0;
          let mx = 0;
          let my = 0;
          for (const n of ns) {
            sw += n.mass;
            mx += n.mass * at(n)[0];
            my += n.mass * at(n)[1];
          }
          return [mx / sw, my / sw] as const;
        };
        let [mx, my] = centroid(ms);
        let core = ms;
        if (!inside(mx, my)) {
          const byCountry = new Map<number, typeof ms>();
          for (const n of ms) {
            const c = atlas.countryOf.get(n.key)!;
            byCountry.set(c, [...(byCountry.get(c) ?? []), n]);
          }
          const heavy = [...byCountry.values()].sort((a, b) => b.reduce((t, n) => t + n.mass, 0) - a.reduce((t, n) => t + n.mass, 0))[0];
          const [hx, hy] = centroid(heavy);
          if (inside(hx, hy)) {
            [mx, my] = [hx, hy];
            core = heavy;
          }
        }
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (const n of core) {
          const dx = at(n)[0] - mx;
          const dy = at(n)[1] - my;
          sxx += n.mass * dx * dx;
          syy += n.mass * dy * dy;
          sxy += n.mass * dx * dy;
        }
        let axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        if (axis > Math.PI / 2) axis -= Math.PI;
        if (axis < -Math.PI / 2) axis += Math.PI;
        axis = Math.max(-0.45, Math.min(0.45, axis));
        const room = labelRoom(edge, mx, my, axis, 1.5 * cell);
        return [{ id: unit.id, hue: unit.hue, path, x: mx, y: my, axis, area: land * cell * cell, ...room }];
      });
    };
    return {
      countries: territories((k) => atlas.countryOf.get(k) ?? -1, atlas.countries),
      realms: territories((k) => atlas.countries[atlas.countryOf.get(k) ?? -1]?.realm ?? -1, atlas.realms),
    };
  };

  // The true plane's layers, and the same layers on the schematic positions.
  // settled stands in for the in-place position changes.
  /* eslint-disable react-hooks/exhaustive-deps */
  const geoTrue = useMemo(
    () => ({ fields: makeFields(truePos), contours: makeContours(truePos), regions: makeRegions(truePos) }),
    [atlas, payload.groups, payload.nodes, visible, frame, settled, hues],
  );
  const geoSch = useMemo(() => {
    if (!schematic) return null;
    const at: At = (n) => schematic.pos.get(n.key) ?? n.pos2d;
    return { fields: makeFields(at), contours: makeContours(at), regions: makeRegions(at) };
  }, [atlas, payload.groups, payload.nodes, visible, frame, settled, hues, schematic]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // The color field on a refocus layout, made once per layout (≈ a few ms) and
  // crossfaded in. Contours and territories don't follow: the refocus draws its
  // own guides (rings, axes, horizon) instead.
  const egoFields = useRef(new WeakMap<EgoLayout, ReturnType<typeof makeFields>>());
  const fieldsFor = (L: EgoLayout) => {
    if (!egoFields.current.has(L)) {
      const at: At = (n) => L.pos.get(n.key) ?? n.pos2d;
      egoFields.current.set(L, makeFields(at, gridFrameOf(L.pos.values())));
    }
    return egoFields.current.get(L) ?? null;
  };
  // A new color set (lens colors, visibility) invalidates them.
  useEffect(() => {
    egoFields.current = new WeakMap();
  }, [colors, visible, frame]);

  // Constellation lines join solid stars only (a ghost's neighbor list is a suggestion, not a fact).
  const solid = useMemo(() => new Set(payload.nodes.filter((n) => visible.has(n.key) && !isGhost(n)).map((n) => n.key)), [payload.nodes, visible]);
  const tree = useMemo(() => spanningTree(payload.neighbors, solid), [payload.neighbors, solid]);
  const sims = useMemo(() => similarityLookup(payload), [payload]);
  const simsRef = useRef(sims);
  simsRef.current = sims;

  const compass = useMemo(() => {
    if (!payload.palette?.length) return [];
    // On the view being shown: in the schematic, the directions sounds fan out in.
    const pts = payload.nodes
      .filter((n) => visible.has(n.key) && !isGhost(n))
      .map((n) => {
        const [x, y] = (sTarget && schematic?.pos.get(n.key)) || n.pos2d;
        return { x, y, w: Math.max(n.mass, 0.3), mix: n.mix };
      });
    return tagGradients(pts, payload.palette)
      .filter((g) => g.r2 >= 0.08)
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.palette, payload.nodes, visible, settled, sTarget, schematic]);

  // ── Geometry helpers (read refs, so they're stable) ──
  const pads = () => {
    const { w, h } = size.current;
    return { padX: Math.min(90, w * 0.14), padY: Math.min(60, h * 0.1) };
  };
  const fitScale = () => {
    const { w, h } = size.current;
    const { padX, padY } = pads();
    return Math.max(1, Math.min((w - 2 * padX) / frame.spanX, (h - 2 * padY) / frame.spanY));
  };
  /** The whole map framed: the true frame at zoom 1, or the schematic's own box. */
  const homeView = (sT: number): View => {
    const sch = propsRef.current.schematic;
    if (!sT || !sch?.pos.size) return { k: 1, tx: 0, ty: 0 };
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of sch.pos.values()) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const { w, h } = size.current;
    const { padX, padY } = pads();
    const F = fitScale();
    const k = Math.max(MIN_K, Math.min(1.5, (w - 2 * padX) / F / Math.max(x1 - x0, 1e-6), (h - 2 * padY) / F / Math.max(y1 - y0, 1e-6)));
    return { k, tx: -((x0 + x1) / 2 - frame.mx) * F * k, ty: ((y0 + y1) / 2 - frame.my) * F * k };
  };
  /** Frame plane bounds in the part of the stage not under controls (or the phone's bottom sheet). */
  const fitView = (x0: number, x1: number, y0: number, y1: number, maxK: number, extra = { left: 0, bottom: 0 }): View => {
    const { w, h } = size.current;
    const F = fitScale();
    const phone = w < 768;
    const top = phone ? 84 : 92;
    // Phone: the inspector sheet covers up to 58% of the stage; its top edge may overlap a little.
    // Phone: keep the refocus clear of the selection sheet (its peek height, from TasteMapView).
    const sheet = propsRef.current.bottomInset;
    const bottom = (phone && propsRef.current.selectedKey ? (sheet != null ? sheet + 24 : h * 0.5) : 80) + (phone ? 0 : extra.bottom);
    const side = Math.min(70, w * 0.08);
    const left = side + extra.left;
    const k = Math.max(
      MIN_K,
      Math.min(maxK, (w - side - left) / F / Math.max(x1 - x0, 1e-6), Math.max(80, h - top - bottom) / F / Math.max(y1 - y0, 1e-6)),
    );
    return {
      k,
      tx: (left - side) / 2 - ((x0 + x1) / 2 - frame.mx) * F * k,
      ty: (top - bottom) / 2 + ((y0 + y1) / 2 - frame.my) * F * k,
    };
  };
  const toScreen = (x: number, y: number, v: View, F: number): [number, number] => {
    const { w, h } = size.current;
    return [w / 2 + v.tx + (x - frame.mx) * F * v.k, h / 2 + v.ty - (y - frame.my) * F * v.k];
  };
  const toPlaneXY = (sx: number, sy: number, v: View, F: number): [number, number] => {
    const { w, h } = size.current;
    return [frame.mx + (sx - w / 2 - v.tx) / (F * v.k), frame.my - (sy - h / 2 - v.ty) / (F * v.k)];
  };

  const draw = () => {
    raf.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = propsRef.current;
    const { w, h, dpr } = size.current;
    if (w === 0 || h === 0) return;
    const now = performance.now();
    let animating = false;

    // Ease toward a pending focus goal.
    if (goal.current) {
      const g = goal.current;
      const v = view.current;
      const t = 0.18;
      v.k += (g.k - v.k) * t;
      v.tx += (g.tx - v.tx) * t;
      v.ty += (g.ty - v.ty) * t;
      if (Math.abs(g.k - v.k) < 0.002 && Math.abs(g.tx - v.tx) < 0.3 && Math.abs(g.ty - v.ty) < 0.3) {
        view.current = { ...g };
        goal.current = null;
      } else animating = true;
    }
    const v = view.current;
    const F = fitScale();
    const { theme } = p;
    const t2 = t2Ref.current;

    // Cursor lenses ease toward the mouse (and back to rest when it leaves).
    const dt = lastT.current ? Math.min(100, now - lastT.current) : 16;
    lastT.current = now;
    const cur = cursor.current;
    const ls = lensState.current;
    const lensOn = cur.inside && !pressing.current && !draggingNode.current && !reduced.current;
    const tux = lensOn ? Math.max(-1, Math.min(1, (cur.x - w / 2) / (w / 2))) : 0;
    const tuy = lensOn ? Math.max(-1, Math.min(1, (cur.y - h / 2) / (h / 2))) : 0;
    ls.ux = approach(ls.ux, tux, dt, TAU_PARALLAX);
    ls.uy = approach(ls.uy, tuy, dt, TAU_PARALLAX);
    ls.str = approach(ls.str, lensOn ? 1 : 0, dt, TAU_STRENGTH);
    if (!lensOn && ls.str < 0.01) ls.str = 0;
    if (Math.abs(ls.ux - tux) > 0.002 || Math.abs(ls.uy - tuy) > 0.002) animating = true;
    else {
      ls.ux = tux;
      ls.uy = tuy;
    }
    if ((lensOn && ls.str < 0.995) || (!lensOn && ls.str > 0)) animating = true;
    // Cursor focus (mouse only): the star the cursor rests near, picked on what
    // was drawn last frame (it holds still, so the pick is stable).
    const focusOn = cur.inside && !pressing.current && !draggingNode.current;
    const fpick = focusOn ? pickFocus(drawn.current, cur.x, cur.y, cursorFocus.current) : { key: null, d: Infinity };
    const fKey = fpick.key && p.visible.has(fpick.key) ? fpick.key : null;
    cursorFocus.current = fKey;

    // Refocus: how far each layout is shown (from → to, or back to the map).
    const e = ego.current;
    const eSpan = e.dur + e.stagger;
    const eu = eSpan > 0 ? smooth((now - e.t0) / eSpan) : 1;
    if ((e.from || e.to) && eu < 1) animating = true;
    if (!e.to && e.from && eu >= 1) {
      e.from = null;
      e.fromLayout = null;
    }
    const fromShare = e.fromLayout ? 1 - eu : 0;
    const toShare = e.to ? eu : 0;
    const baseShare = Math.max(0, 1 - fromShare - toShare);

    const la = lensAnim.current;
    const lensT = la.from === la.to ? 1 : smooth((now - la.t0) / LENS_MS);
    if (lensT < 1) animating = true;
    // 0…1: how far the distortion lens is faded in (its halos and link styles).
    const distA = la.to === 'distortion' ? lensT : la.from === 'distortion' ? 1 - lensT : 0;
    const s = morphAt(now);
    sNow.current = s;
    if (morph.current.s0 !== morph.current.s1 && now - morph.current.t0 < MORPH_MS) animating = true;
    // How much of the true plane's density layers shows.
    const tTrue = 1 - s;
    const honestOf = (key: NodeKey) => p.honesty.byKey.get(key);
    const colorOf = (key: NodeKey): Rgb => {
      const c = colors.get(key);
      if (!c) return GRAY;
      return lensT >= 1 ? c[la.to] : lerpRgb(c[la.from], c[la.to], lensT);
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    sky.addColorStop(0, SKY.bg0);
    sky.addColorStop(1, SKY.bg1);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Graticule (a scale, so only to scale).
    const unit = F * v.k;
    const step = niceStep(90 / unit);
    const [wx0, wy1] = toPlaneXY(0, 0, v, F);
    const [wx1, wy0] = toPlaneXY(w, h, v, F);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `${SKY.line}${(0.05 * tTrue).toFixed(3)})`;
    ctx.beginPath();
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
      const sx = Math.round(toScreen(x, 0, v, F)[0]) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) {
      const sy = Math.round(toScreen(0, y, v, F)[1]) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // Grid units → screen (y flipped), per layer: each field has its own grid frame.
    const gridTransform = (fr: GridFrame) => {
      const a = fr.gs * F * v.k;
      const cx = w / 2 + v.tx + (fr.gx0 - frame.mx) * F * v.k;
      const cy = h / 2 + v.ty - (fr.gy0 - frame.my) * F * v.k;
      ctx.setTransform(dpr * a, 0, 0, -dpr * a, dpr * cx, dpr * cy);
      return a;
    };
    let a = gridTransform(frame);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Thinner as you zoom in, where the stars should carry the detail.
    const fieldA = 1 / (1 + 0.35 * Math.max(0, v.k - 1));
    // Refocus layouts: only their color field, crossfading with the map's layers.
    for (const [L, share] of [
      [e.fromLayout, fromShare],
      [e.to, toShare],
    ] as const) {
      if (!L || share <= 0.002) continue;
      const fields = fieldsFor(L);
      if (!fields) continue;
      gridTransform(fields.fr);
      if (lensT < 1) {
        ctx.globalAlpha = (1 - lensT) * fieldA * share;
        ctx.drawImage(fields[la.from], 0, 0, GRID, GRID);
      }
      ctx.globalAlpha = lensT * fieldA * share;
      ctx.drawImage(fields[la.to], 0, 0, GRID, GRID);
    }
    a = gridTransform(frame);
    // Each scale's layers at its share of the morph (and of the refocus).
    for (const [geo, shareS] of [
      [geoTrue, tTrue],
      [geoSch, s],
    ] as const) {
      const share = shareS * baseShare;
      if (!geo || share <= 0.002) continue;
      const { fields } = geo;
      if (fields) {
        if (lensT < 1) {
          ctx.globalAlpha = (1 - lensT) * fieldA * share;
          ctx.drawImage(fields[la.from], 0, 0, GRID, GRID);
        }
        ctx.globalAlpha = lensT * fieldA * share;
        ctx.drawImage(fields[la.to], 0, 0, GRID, GRID);
      }
      ctx.globalAlpha = share;
      ctx.lineWidth = 1 / a;
      geo.contours.all.forEach((path, i) => {
        ctx.strokeStyle = `${SKY.line}${(0.05 + 0.012 * i).toFixed(3)})`;
        ctx.stroke(path);
      });
      // Realms are the land; provinces inside a realm only get a faint dashed border.
      for (const r of geo.regions.realms) {
        const tint = tintOf(r.hue, 0.72, 0.12);
        ctx.fillStyle = rgbCss(tint, 0.05);
        ctx.fill(r.path);
        ctx.lineWidth = 1.1 / a;
        ctx.strokeStyle = rgbCss(tint, 0.3);
        ctx.stroke(r.path);
      }
      ctx.lineWidth = 0.9 / a;
      ctx.setLineDash([2 / a, 3.5 / a]);
      for (const r of geo.regions.countries) {
        if (!atlas.countries[r.id]?.sub) continue;
        ctx.strokeStyle = rgbCss(tintOf(r.hue, 0.72, 0.12), 0.22);
        ctx.stroke(r.path);
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1.25 / a;
      ctx.setLineDash([5 / a, 4 / a]);
      for (const g of geo.contours.groups) {
        if (!g.path || p.hiddenGroups.has(g.id)) continue;
        ctx.strokeStyle = hexAlpha(g.color, 0.55);
        ctx.stroke(g.path);
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // You: the mark the schematic spreads around.
    const sch = p.schematic;
    const px = F * v.k;
    if (sch?.nucleus && s * baseShare > 0) {
      const [nx, ny] = toScreen(sch.nucleus[0], sch.nucleus[1], v, F);
      ctx.save();
      ctx.globalAlpha = s * baseShare;
      ctx.beginPath();
      ctx.arc(nx, ny, 5, 0, TAU);
      ctx.strokeStyle = `${SKY.line}0.5)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(nx, ny, 1.8, 0, TAU);
      ctx.fillStyle = SKY.ink;
      ctx.fill();
      ctx.restore();
    }

    // letterSpacing is newer canvas API; skip where it's missing.
    const setSpacing = (s: string) => {
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = s;
    };

    const nodes = p.payload.nodes;
    const sel = p.selectedKey;
    const dz = depthRef.current;

    // 1. Plane positions: the map (morphing between scales), blended into the refocus.
    const plane = new Map<NodeKey, Vec2>();
    for (const n of nodes) {
      if (!p.visible.has(n.key) || isHidden(n)) continue;
      const b = placeAt(n, s);
      if (!e.from && !e.to) {
        plane.set(n.key, b);
        continue;
      }
      const f = e.from?.get(n.key) ?? b;
      const tq = e.to?.pos.get(n.key) ?? b;
      const ord = (e.to ?? e.fromLayout)?.order.get(n.key) ?? 0.5;
      const u = e.dur > 0 ? smooth((now - e.t0 - ord * e.stagger) / e.dur) : 1;
      plane.set(n.key, u >= 1 ? tq : [f[0] + (tq[0] - f[0]) * u, f[1] + (tq[1] - f[1]) * u]);
    }
    lastPlane.current = plane;

    // 2. Screen positions, then on-screen overlap removal (eased, so zooming
    // doesn't make stars jump), depth parallax and the fisheye. Display only.
    const cf = coverAmount(v.k);
    const baseR = (n: TasteMapPayloadNode) => {
      const r = nodeRadius(n.mass, v.k);
      return cf > 0 ? r + (coverHalf(n.mass, v.k) * 1.12 - r) * cf : r;
    };
    const raw: { n: TasteMapPayloadNode; x: number; y: number; r: number }[] = [];
    for (const n of nodes) {
      const q = plane.get(n.key);
      if (!q) continue;
      const [x, y] = toScreen(q[0], q[1], v, F);
      raw.push({ n, x, y, r: baseR(n) });
    }
    const sepOn = !draggingNode.current;
    const offs = sepOn ? separate(raw, 2 + 4 * cf, 3, 8 + 16 * cf) : null;
    const sepMap = new Map<NodeKey, [number, number]>();
    raw.forEach((q, i) => {
      const prev = sepOff.current.get(q.n.key) ?? [0, 0];
      const tx = q.n.key === sel || !offs ? 0 : offs[2 * i];
      const ty = q.n.key === sel || !offs ? 0 : offs[2 * i + 1];
      const nx = reduced.current ? tx : approach(prev[0], tx, dt, TAU_SEPARATE);
      const ny = reduced.current ? ty : approach(prev[1], ty, dt, TAU_SEPARATE);
      if (Math.abs(nx - tx) > 0.3 || Math.abs(ny - ty) > 0.3) animating = true;
      sepMap.set(q.n.key, [nx, ny]);
    });
    sepOff.current = sepMap;
    // Parallax pivots on a depth that holds still: the cursor-focused star's
    // (so it stays put while the sky turns around it), else the selection's
    // once refocused, else the map's middle. With the cursor in empty sky the
    // pivot keeps the last focus's depth, so leaving a star doesn't slide the sky.
    const egoAmt = 1 - baseShare;
    const egoZ = sel ? (dz.norm.get(sel) ?? 0) * egoAmt : 0;
    const pivotGoal = fKey ? (dz.norm.get(fKey) ?? 0) : lensOn ? pivot.current : egoZ;
    pivot.current = reduced.current ? pivotGoal : approach(pivot.current, pivotGoal, dt, TAU_PIVOT);
    if (Math.abs(pivot.current - pivotGoal) > 0.003) animating = true;
    else pivot.current = pivotGoal;
    const zRef = pivot.current;
    const pre = new Map<NodeKey, [number, number]>();
    for (const q of raw) {
      const o = sepMap.get(q.n.key) ?? [0, 0];
      let x = q.x + o[0];
      let y = q.y + o[1];
      if (ls.ux || ls.uy) {
        const [px2, py2] = parallaxShift((dz.norm.get(q.n.key) ?? 0) - zRef, ls.ux, ls.uy);
        x += px2;
        y += py2;
      }
      pre.set(q.n.key, [x, y]);
    }
    // The fisheye centers on the focused star (the center is the one point a
    // fisheye never moves), else follows the cursor.
    const fAt = fKey ? pre.get(fKey) : undefined;
    const fgx = fAt ? fAt[0] : cur.x;
    const fgy = fAt ? fAt[1] : cur.y;
    if (cur.inside) {
      // Jump when the lens was off, so it doesn't sweep in from afar.
      ls.fx = ls.str < 0.02 ? fgx : approach(ls.fx, fgx, dt, TAU_FISHEYE);
      ls.fy = ls.str < 0.02 ? fgy : approach(ls.fy, fgy, dt, TAU_FISHEYE);
      if (Math.abs(ls.fx - fgx) > 0.4 || Math.abs(ls.fy - fgy) > 0.4) animating = true;
    }
    // With a focus, the others grow less (the focus shows by glowing, not by swelling).
    const growK = fKey ? 0.4 : 1;
    const pos = new Map<NodeKey, [number, number]>();
    const grow = new Map<NodeKey, number>();
    for (const [key, [x, y]] of pre) {
      const m = magnify(x, y, ls.fx, ls.fy, ls.str);
      pos.set(key, [m.x, m.y]);
      grow.set(key, key === fKey ? 1 : 1 + (m.grow - 1) * growK);
    }
    // Focus glow, eased per star (in on the focus, out on the one it left).
    const glows = glowLvl.current;
    if (fKey && !glows.has(fKey)) glows.set(fKey, 0);
    for (const [key, g] of glows) {
      const goalG = key === fKey ? 1 : 0;
      const ng = reduced.current ? goalG : approach(g, goalG, dt, TAU_GLOW);
      if (Math.abs(ng - goalG) > 0.01) animating = true;
      if (goalG === 0 && ng < 0.01) glows.delete(key);
      else glows.set(key, Math.abs(ng - goalG) <= 0.01 ? goalG : ng);
    }

    // 3. Proximity: how close the cursor is to each star (mouse only). The
    // card goes to the focused star.
    const proxOn = focusOn;
    const prox = new Map<NodeKey, number>();
    const nearKey: NodeKey | null = fKey;
    const nearD = fKey ? fpick.d : Infinity;
    if (proxOn) {
      for (const [k, [x, y]] of pos) {
        const d = Math.hypot(x - cur.x, y - cur.y);
        if (d < 3 * PROX_SIGMA) prox.set(k, Math.exp(-(d * d) / (2 * PROX_SIGMA * PROX_SIGMA)));
      }
      if (fKey) prox.set(fKey, 1);
    }

    const related = new Set<NodeKey>();
    if (sel) {
      related.add(sel);
      for (const nb of p.payload.neighbors[sel] ?? []) related.add(nb.key);
    }
    if (p.hoveredKey) related.add(p.hoveredKey);
    const dimOthers = sel != null;
    const focusKey = p.hoveredKey ?? sel;

    // Names: the map's background lettering, under every star. Each realm (a
    // genre) is named once, fitted into its land along its long axis
    // (lib/tasteMap/labelFit.ts); a realm of several provinces names them too,
    // small, where they don't collide with the realm's name. Between scales a
    // name slides from one territory to the other (or fades, when a scale has
    // no territory for it).
    const nameA = Math.max(0.3, Math.min(0.62, (3.2 - v.k) / 2.5));
    const regionOf = new Map(geoTrue.regions.countries.map((r) => [r.id, r]));
    const schRegionOf = new Map((geoSch?.regions.countries ?? []).map((r) => [r.id, r]));
    const realmTrue = new Map(geoTrue.regions.realms.map((r) => [r.id, r]));
    const realmSch = new Map((geoSch?.regions.realms ?? []).map((r) => [r.id, r]));
    type Geo = (typeof geoTrue.regions.countries)[number];
    const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    const realmFont = (size: number) => `italic 600 ${size.toFixed(1)}px ${serif}`;
    const provinceFont = (size: number) => `italic 500 ${size.toFixed(1)}px ${serif}`;
    // Width at size 1: measured at 20px, tracking scaled with it.
    const widthAt1 = (fontOf: (size: number) => string) => (line: string, t: number) => {
      const key = `${fontOf(20)}|${t}|${line}`;
      let m = measureCache.current.get(key);
      if (m == null) {
        ctx.font = fontOf(20);
        setSpacing(`${(20 * t).toFixed(1)}px`);
        m = ctx.measureText(line).width / 20;
        setSpacing('0px');
        measureCache.current.set(key, m);
      }
      return m;
    };
    const nameBoxes: Box[] = [];
    const drawName = (
      text: string,
      rt: Geo | undefined,
      rs: Geo | undefined,
      opts: { max: number; min: number; fill: number; font: (size: number) => string; color: string; alpha: number; avoid: boolean },
    ) => {
      const wt = rt ? tTrue : 0;
      const ws = rs ? s : 0;
      if (wt + ws < 0.02) return false;
      const place = (r: Geo) => {
        const [x, y] = toScreen(r.x, r.y, v, F);
        const cap = Math.max(opts.min, Math.min(opts.max, Math.sqrt(r.area) * px * 0.085));
        const fit = fitName(text, r.len * px * opts.fill, r.thick * px * 0.8, cap, opts.min, widthAt1(opts.font));
        return { x, y, rot: -r.axis, ...fit };
      };
      const A = place((rt ?? rs)!);
      const B = rs ? place(rs) : A;
      const u = rt && rs ? s : 0;
      const L = u < 0.5 ? A : B;
      const x = A.x + (B.x - A.x) * u;
      const y = A.y + (B.y - A.y) * u;
      const rot = A.rot + (B.rot - A.rot) * u;
      const size = A.size + (B.size - A.size) * u;
      const spacing = A.spacing + (B.spacing - A.spacing) * u;
      const lh = size * LINE_HEIGHT;
      // Screen box of the rotated block, for collisions.
      const bw = Math.max(...L.lines.map((l) => widthAt1(opts.font)(l, spacing / Math.max(size, 1e-9)))) * size;
      const bh = lh * L.lines.length;
      const c = Math.abs(Math.cos(rot));
      const sn = Math.abs(Math.sin(rot));
      const box: Box = { x: x - (bw * c + bh * sn) / 2, y: y - (bw * sn + bh * c) / 2, w: bw * c + bh * sn, h: bw * sn + bh * c, key: null };
      if (opts.avoid && nameBoxes.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) return false;
      nameBoxes.push(box);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.font = opts.font(size);
      setSpacing(`${spacing.toFixed(1)}px`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = opts.alpha * (rt && rs ? 1 : wt + ws);
      ctx.fillStyle = opts.color;
      L.lines.forEach((line, i) => ctx.fillText(line, 0, (i - (L.lines.length - 1) / 2) * lh));
      setSpacing('0px');
      ctx.restore();
      return wt + ws >= 0.5;
    };
    let names = 0;
    const realmAlpha = nameA * (dimOthers ? 0.6 : 1) * baseShare;
    for (const realm of [...atlas.realms].sort((a, b) => b.mass - a.mass)) {
      const color = realm.hue == null ? SKY.ink : rgbCss(tintOf(realm.hue, 0.86, 0.07));
      const big = { max: 24, min: 10, fill: 0.92, font: realmFont, color, alpha: realmAlpha, avoid: false };
      if (drawName(realm.name.toUpperCase(), realmTrue.get(realm.id), realmSch.get(realm.id), big)) names++;
    }
    for (const realm of atlas.realms) {
      if (realm.countries.length < 2) continue;
      const color = realm.hue == null ? SKY.muted : rgbCss(tintOf(realm.hue, 0.8, 0.06));
      for (const id of realm.countries) {
        const sub = atlas.countries[id]?.sub;
        if (!sub) continue;
        const small = { max: 13, min: 9, fill: 0.85, font: provinceFont, color, alpha: realmAlpha * 0.85, avoid: true };
        drawName(sub, regionOf.get(id), schRegionOf.get(id), small);
      }
    }

    // Bundled links between countries, bent through the bridge between them,
    // territory to territory (sliding with the morph).
    const at = new Map<number, { q: [number, number]; trim: number }>();
    for (const country of atlas.countries) {
      const rt = regionOf.get(country.id);
      const rs = schRegionOf.get(country.id);
      const a0 = rt && tTrue > 0 ? rt : rs;
      const a1 = rs && s > 0 ? rs : rt;
      if (!a0 || !a1) continue;
      const u = a0 === a1 ? 0 : s;
      at.set(country.id, { q: toScreen(a0.x + (a1.x - a0.x) * u, a0.y + (a1.y - a0.y) * u, v, F), trim: 0 });
    }
    if (at.size > 1) {
      const maxW = Math.max(...atlas.links.map((l) => l.w));
      for (const l of atlas.links) {
        const ea = at.get(l.a);
        const eb = at.get(l.b);
        if (!ea || !eb) continue;
        const d = Math.hypot(eb.q[0] - ea.q[0], eb.q[1] - ea.q[1]);
        if (d <= ea.trim + eb.trim + 2) continue;
        const ux = (eb.q[0] - ea.q[0]) / d;
        const uy = (eb.q[1] - ea.q[1]) / d;
        const qa: [number, number] = [ea.q[0] + ux * ea.trim, ea.q[1] + uy * ea.trim];
        const qb: [number, number] = [eb.q[0] - ux * eb.trim, eb.q[1] - uy * eb.trim];
        const via = [...atlas.bridges.values()]
          .filter((b) => b.countries.includes(l.a) && b.countries.includes(l.b) && pos.has(b.key))
          .sort((x, y) => y.score - x.score)[0];
        const mid: [number, number] = [(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2];
        let cx2: number;
        let cy2: number;
        if (via) {
          // Quadratic through the bridge at t = ½.
          const q = pos.get(via.key)!;
          cx2 = 2 * q[0] - mid[0];
          cy2 = 2 * q[1] - mid[1];
        } else {
          cx2 = mid[0] - (qb[1] - qa[1]) * 0.18;
          cy2 = mid[1] + (qb[0] - qa[0]) * 0.18;
        }
        ctx.lineCap = 'round';
        ctx.lineWidth = 1 + 5 * (l.w / maxW);
        ctx.strokeStyle = `${SKY.line}${((dimOthers ? 0.04 : 0.09) * baseShare).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(qa[0], qa[1]);
        ctx.quadraticCurveTo(cx2, cy2, qb[0], qb[1]);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // Refocus guides: what the new space means, faded with its layout.
    const guide = (L: EgoLayout | null, share: number) => {
      if (!L || share <= 0.01) return;
      const name = nodes.find((m) => m.key === L.key)?.label ?? '';
      const [cx0, cy0] = toScreen(L.center[0], L.center[1], v, F);
      const u = F * v.k;
      ctx.save();
      ctx.font = MATH_FONT;
      ctx.lineJoin = 'round';
      const label = (text: string, x: number, y: number, align: CanvasTextAlign, alpha: number, color = SKY.muted) => {
        ctx.textAlign = align;
        ctx.globalAlpha = share * alpha;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 9, 14, 0.85)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
      };
      ctx.textBaseline = 'middle';
      if (L.mode === 'distance') {
        // Concentric true-similarity rings, labelled like a polar plot along the
        // one bearing that keeps the labels clearest of stars.
        const clear = (ang: number) => {
          let score = 0;
          for (const ring of L.rings) {
            const rp = ring.r * u;
            if (rp < 16) continue;
            const lx = cx0 + rp * Math.cos(ang) + 10;
            const ly = cy0 + rp * Math.sin(ang) - 7;
            let dmin = 60;
            for (const [x, y] of pos.values()) dmin = Math.min(dmin, Math.hypot(x - lx, y - ly));
            score += dmin + (lx < 20 || lx > w - 40 || ly < 100 || ly > h - 20 ? -80 : 0);
          }
          return score;
        };
        const ang = [-0.25, -0.75, 0.25, 0.75, -0.5, 0.5, 0, 1].map((f) => f * Math.PI).reduce((best, a2) => (clear(a2) > clear(best) + 1 ? a2 : best));
        L.rings.forEach((ring, i) => {
          const rp = ring.r * u;
          if (rp < 16) return;
          ctx.globalAlpha = share;
          ctx.beginPath();
          ctx.arc(cx0, cy0, rp, 0, TAU);
          ctx.lineWidth = 1;
          ctx.strokeStyle = `${SKY.line}${(0.2 - 0.025 * i).toFixed(3)})`;
          ctx.stroke();
          const lx = cx0 + rp * Math.cos(ang);
          const ly = cy0 + rp * Math.sin(ang);
          label(i === 0 || L.rings[i - 1].r * u < 16 ? `s = ${ring.sim}` : String(ring.sim), lx + 4, ly - 7, 'left', 0.95);
        });
        // The rim: similarity ≈ 0.
        ctx.globalAlpha = share;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.arc(cx0, cy0, L.R * u, 0, TAU);
        ctx.strokeStyle = `${SKY.line}0.1)`;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (L.mode === 'vector') {
        const W = L.R * VEC_W * u;
        const H = L.R * VEC_H * u;
        const x0 = cx0 - W - 18;
        // The x axis runs through the selection, a number line of similarity.
        const yb = cy0;
        ctx.globalAlpha = share;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `${SKY.line}0.32)`;
        ctx.fillStyle = `${SKY.line}0.32)`;
        const arrowHead = (x: number, y: number, dx: number, dy: number) => {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 7 * dx + 3.5 * dy, y - 7 * dy - 3.5 * dx);
          ctx.lineTo(x - 7 * dx - 3.5 * dy, y - 7 * dy + 3.5 * dx);
          ctx.closePath();
          ctx.fill();
        };
        // x: similarity to the selection, on the rings' log scale.
        ctx.beginPath();
        ctx.moveTo(x0, yb);
        ctx.lineTo(cx0 + 14, yb);
        ctx.stroke();
        arrowHead(cx0 + 14, yb, 1, 0);
        for (const ring of L.rings) {
          const tx = cx0 - ring.r * u;
          if (tx < x0 + 6) continue;
          ctx.globalAlpha = share;
          ctx.lineWidth = 1;
          ctx.strokeStyle = `${SKY.line}0.32)`;
          ctx.beginPath();
          ctx.moveTo(tx, yb - 3);
          ctx.lineTo(tx, yb + 3);
          ctx.stroke();
          label(String(ring.sim), tx, yb + 12, 'center', 0.75);
        }
        label(`← ${t2.lessLike}`, x0 + 4, yb + 26, 'left', 0.85);
        // y: the strongest other direction.
        if (L.axis) {
          ctx.globalAlpha = share;
          ctx.lineWidth = 1;
          ctx.strokeStyle = `${SKY.line}0.32)`;
          ctx.fillStyle = `${SKY.line}0.32)`;
          ctx.beginPath();
          ctx.moveTo(x0, cy0 + H + 4);
          ctx.lineTo(x0, cy0 - H - 14);
          ctx.stroke();
          arrowHead(x0, cy0 - H - 14, 0, -1);
          const tagColor = (id?: string) => {
            const hue = id ? hues.get(id) : undefined;
            return hue == null ? SKY.ink : rgbCss(tintOf(hue, 0.82, 0.12));
          };
          const words = (w: string) => (L.axis?.posId ? t2.more(w) : t2.toward(w));
          label(words(L.axis.pos), x0 + 9, cy0 - H - 12, 'left', 0.95, tagColor(L.axis.posId));
          if (L.axis.neg) label(`↓ ${words(L.axis.neg)}`, x0 + 8, cy0 + H, 'left', 0.85, tagColor(L.axis.negId));
        }
      } else {
        // Depth: a horizon through the selection, and ±1σ lines.
        ctx.globalAlpha = share;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `${SKY.line}0.3)`;
        ctx.beginPath();
        ctx.moveTo(0, cy0);
        ctx.lineTo(w, cy0);
        ctx.stroke();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = `${SKY.line}0.13)`;
        for (const k of [-2, -1, 1, 2]) {
          const y = cy0 - k * L.zUnit * u;
          if (y < 0 || y > h) continue;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          label(`${k > 0 ? '+' : '−'}${Math.abs(k)}σ`, w - 14, y - 7, 'right', 0.7);
        }
        ctx.setLineDash([]);
        const lx = cy0 > h - 140 && w >= 320 ? 236 : 14;
        label(`↑ ${t2.inFront(name)}`, lx, cy0 - 11, 'left', 0.95, SKY.ink);
        label(`↓ ${t2.behind}`, lx, cy0 + 12, 'left', 0.85);
      }
      ctx.restore();
    };
    guide(e.fromLayout, fromShare);
    guide(e.to, toShare);

    // Constellation lines.
    ctx.lineWidth = 1;
    for (const e of tree) {
      const qa = pos.get(e.a);
      const qb = pos.get(e.b);
      if (!qa || !qb) continue;
      const lit = focusKey != null && (e.a === focusKey || e.b === focusKey);
      ctx.strokeStyle = `${SKY.line}${((lit ? 0.5 : dimOthers ? 0.07 : 0.16) * (0.3 + 0.7 * baseShare)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(qa[0], qa[1]);
      ctx.lineTo(qb[0], qb[1]);
      ctx.stroke();
    }

    // Trails (dashed, chronological).
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = SKY.muted;
    ctx.globalAlpha = 0.75;
    for (const tr of p.payload.trails) {
      const pts = tr.keys.map((k) => pos.get(k)).filter((q): q is [number, number] => !!q);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Links from the selection to its neighbors, drawn outward on select.
    if (sel && pos.has(sel)) {
      const [sx, sy] = pos.get(sel)!;
      const list = p.payload.neighbors[sel] ?? [];
      const base = (now - linkAnim.current.t0) / LINK_MS;
      if (base < 1 + 0.12 * list.length) animating = true;
      const torn = new Set(distA > 0.5 ? honestOf(sel)?.torn ?? [] : []);
      list.forEach((nb, i) => {
        const q = pos.get(nb.key);
        if (!q) return;
        const t = smooth(base - 0.12 * i);
        if (t <= 0) return;
        const ex = sx + (q[0] - sx) * t;
        const ey = sy + (q[1] - sy) * t;
        const grad = ctx.createLinearGradient(sx, sy, q[0], q[1]);
        grad.addColorStop(0, rgbCss(lighten(colorOf(sel), 0.3), 0.9));
        grad.addColorStop(1, rgbCss(lighten(colorOf(nb.key), 0.3), 0.9));
        // Distortion lens: a torn link (really close, drawn far) is dashed in the torn color.
        ctx.strokeStyle = torn.has(nb.key) ? rgbCss(distortionRgb(0, 0.78)) : grad;
        ctx.setLineDash(torn.has(nb.key) ? [5, 4] : []);
        ctx.globalAlpha = 0.25 + 0.6 * nb.sim;
        ctx.lineWidth = 1 + 1.6 * nb.sim;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Intruders: drawn among the nearest, but not true neighbors.
      if (distA > 0) {
        ctx.setLineDash([1.5, 3]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = SKY.muted;
        ctx.globalAlpha = 0.9 * distA;
        for (const k of honestOf(sel)?.intruders ?? []) {
          const q = pos.get(k);
          if (!q) continue;
          const n = nodes.find((m) => m.key === k);
          ctx.beginPath();
          ctx.arc(q[0], q[1], nodeRadius(n?.mass ?? 1, v.k) + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // Stars, small first so big ones sit on top. Glow is additive. Near the
    // cursor they brighten and grow; zoomed in, they turn into album covers.
    const drawOrder = nodes.filter((n) => pos.has(n.key)).sort((x, y) => x.mass - y.mass);
    const drawnNow = new Map<NodeKey, { x: number; y: number; r: number }>();
    let coverLoads = 0;
    /** A cached cover image, starting at most 6 new loads per frame. */
    const cover = (src: string) => {
      const hit = coverCache.get(src);
      if (hit || coverLoads >= 6 || typeof Image === 'undefined') return hit ?? null;
      coverLoads++;
      const img = new Image();
      img.decoding = 'async';
      const rec = { img, ok: null as boolean | null };
      coverCache.set(src, rec);
      img.onload = () => {
        rec.ok = true;
        requestDrawRef.current();
      };
      img.onerror = () => {
        rec.ok = false;
      };
      img.src = src;
      return rec;
    };
    for (const n of drawOrder) {
      const [x, y] = pos.get(n.key)!;
      const b = prox.get(n.key) ?? 0;
      /** Cursor-focus glow 0…1: the focused star stays its size and lights up instead. */
      const gl = glows.get(n.key) ?? 0;
      const swell = n.key === fKey ? 1.06 : 1 + 0.3 * b * (fKey ? 0.5 : 1);
      const r = nodeRadius(n.mass, v.k) * (grow.get(n.key) ?? 1) * swell;
      const ch = cf > 0 ? coverHalf(n.mass, v.k) * (grow.get(n.key) ?? 1) * (n.key === fKey ? 1.03 : 1 + 0.12 * b) : 0;
      drawnNow.set(n.key, { x, y, r: Math.max(r, ch * cf) });
      if (x < -4 * r - ch || y < -4 * r - ch || x > w + 4 * r + ch || y > h + 4 * r + ch) continue;
      const c = colorOf(n.key);
      const dim = dimOthers && !related.has(n.key);
      const ghost = n.ghost;
      const alpha = Math.max(dim ? 0.28 : 1, 0.28 + 0.72 * b) * (ghost ? 0.6 : 1);

      // A ghost: evidence too thin (or too odd) to place for sure. Hollow and
      // dashed, with only a breath of glow, so it reads as a suggestion.
      if (ghost) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(10, 12, 18, 0.7)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgbCss(lighten(c, 0.35), 0.85);
        ctx.stroke();
        ctx.setLineDash([2.5, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, TAU);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbCss(lighten(c, 0.5), 0.55);
        ctx.stroke();
        ctx.setLineDash([]);
        if (n.key === sel || n.key === p.hoveredKey) {
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, TAU);
          ctx.lineWidth = n.key === sel ? 1.6 : 1;
          ctx.strokeStyle = SKY.ink;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.globalCompositeOperation = 'lighter';
      // Distortion lens: the less of its neighborhood the plane keeps, the wider
      // and fainter the halo, so torn stars read as out of focus.
      const fuzz = distA * (1 - (honestOf(n.key)?.recall ?? 1));
      const haloR = Math.max(r, ch * cf) * (3.4 + 4.5 * fuzz) * (cf > 0 ? 1 - 0.45 * cf : 1);
      const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, haloR);
      halo.addColorStop(0, rgbCss(c, Math.min(0.75, (0.42 - 0.12 * fuzz) * (1 + 0.6 * b)) * alpha));
      halo.addColorStop(1, rgbCss(c, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.fill();
      if (gl > 0.01) {
        // Focus bloom: a wide soft wash plus a hot inner glow, both in the star's color.
        const big = Math.max(r, ch * cf) * 7.5;
        const wash = ctx.createRadialGradient(x, y, r * 0.5, x, y, big);
        wash.addColorStop(0, rgbCss(lighten(c, 0.35), 0.5 * gl));
        wash.addColorStop(0.35, rgbCss(c, 0.16 * gl));
        wash.addColorStop(1, rgbCss(c, 0));
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.arc(x, y, big, 0, TAU);
        ctx.fill();
        const hot = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
        hot.addColorStop(0, rgbCss(lighten(c, 0.8), 0.85 * gl));
        hot.addColorStop(1, rgbCss(lighten(c, 0.4), 0));
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (gl > 0.01) {
        // A fine ring: "this one holds still".
        ctx.save();
        ctx.globalAlpha = 0.55 * gl;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(r, ch * cf) + 7, 0, TAU);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbCss(lighten(c, 0.6));
        ctx.stroke();
        ctx.restore();
      }

      // Semantic zoom: the album cover as the star (lazy, cached thumbnails; a
      // pending or failed image leaves the star).
      const coverUrls = cf > 0.01 ? n.covers.flatMap((cv) => (cv.coverUrl ? [coverThumb(cv.coverUrl)] : [])) : [];
      const main = coverUrls.length ? cover(coverUrls[0]) : null;
      if (coverUrls.length && main?.ok == null) animating = true;
      let starA = 1;
      if (main?.ok) {
        try {
          // Up to two more covers fan out behind once there's room.
          if (v.k >= 5)
            coverUrls.slice(1, 3).forEach((u, i) => {
              const ex = cover(u);
              if (!ex?.ok) return;
              const side = ch * 0.85;
              ctx.save();
              ctx.translate(x + (i ? -1 : 1) * ch * 0.42, y - ch * 0.12);
              ctx.rotate((i ? -1 : 1) * 0.16);
              ctx.globalAlpha = cf * alpha * 0.85;
              rrect(ctx, -side, -side, 2 * side, 2 * side, 3);
              ctx.clip();
              ctx.drawImage(ex.img, -side, -side, 2 * side, 2 * side);
              ctx.fillStyle = 'rgba(8, 9, 14, 0.35)';
              ctx.fillRect(-side, -side, 2 * side, 2 * side);
              ctx.restore();
            });
          ctx.save();
          ctx.globalAlpha = cf * alpha;
          rrect(ctx, x - ch, y - ch, 2 * ch, 2 * ch, 3.5);
          ctx.save();
          ctx.clip();
          ctx.drawImage(main.img, x - ch, y - ch, 2 * ch, 2 * ch);
          ctx.restore();
          // The lens color as a hairline frame, so covers still read as this map's stars.
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = rgbCss(lighten(c, 0.2), 0.95);
          ctx.stroke();
          ctx.restore();
          starA = 1 - cf;
        } catch {
          // A cover that can't be drawn (decode / cross-origin quirks): keep the star.
          main.ok = false;
        }
      }
      if (starA <= 0.02) {
        if (n.key === sel || n.key === p.hoveredKey) {
          ctx.globalAlpha = 1;
          rrect(ctx, x - ch - 4, y - ch - 4, 2 * ch + 8, 2 * ch + 8, 6);
          ctx.lineWidth = n.key === sel ? 1.8 : 1.1;
          ctx.strokeStyle = SKY.ink;
          ctx.stroke();
        }
        const pinC = p.pins.get(n.key);
        if (pinC) drawPinBadge(ctx, x + ch * 0.9, y - ch * 0.9, pinC.softZ);
        continue;
      }
      ctx.globalAlpha = alpha * starA;
      const bridge = atlas.bridges.has(n.key);
      // A bridge is a diamond with an outline, so it reads as a crossing, not a star.
      const shape = (rr: number) => {
        ctx.beginPath();
        if (!bridge) return ctx.arc(x, y, rr, 0, Math.PI * 2);
        const d = rr * 1.3;
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
      };
      shape(r);
      ctx.fillStyle = rgbCss(c);
      ctx.fill();
      shape(Math.max(1, r * 0.36));
      ctx.fillStyle = rgbCss(lighten(c, 0.75), 0.9);
      ctx.fill();
      if (bridge) {
        shape(r + 4);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = rgbCss(lighten(c, 0.5), 0.75);
        ctx.stroke();
      }
      if (n.key === sel || n.key === p.hoveredKey) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = n.key === sel ? 1.8 : 1.1;
        ctx.strokeStyle = SKY.ink;
        ctx.stroke();
      }
      const pin = p.pins.get(n.key);
      if (pin) drawPinBadge(ctx, x + r * 0.72, y - r * 0.72, pin.softZ);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Add-artist ghost: dashed lines to its anchors, then a translucent dashed circle.
    const gh = p.ghost;
    const ghostWorld = gh ? ghostAt(gh, s) : null;
    const ghostXY = ghostWorld ? toScreen(ghostWorld[0], ghostWorld[1], v, F) : null;
    const ghostR = nodeRadius(2, v.k) + 2;
    if (gh && ghostXY) {
      const [gx, gy] = ghostXY;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = SKY.ink;
      ctx.globalAlpha = 0.5;
      for (const k of gh.anchors) {
        const q = pos.get(k);
        if (!q) continue;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = SKY.ink;
      ctx.beginPath();
      ctx.arc(gx, gy, ghostR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Labels — greedy placement by priority, never under the stage's overlay
    // controls (fullscreen top left, lens switch top right, legend bottom right,
    // compass bottom left).
    const boxes: Box[] = [
      { x: 0, y: 0, w: 340, h: 46, key: null },
      { x: w - 250, y: 0, w: 250, h: 46, key: null },
      { x: w - 345, y: h - 64, w: 345, h: 64, key: null },
      ...(compass.length && w >= 320 ? [{ x: 0, y: h - 116, w: 230, h: 116, key: null }] : []),
      // The refocus switch under the top-left controls while something is selected.
      ...(sel ? [{ x: 0, y: 44, w: 330, h: 52, key: null }] : []),
    ];
    const overlaps = (b: Box) =>
      boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const measure = (font: string, text: string, spacing: string) => {
      const key = `${font}|${spacing}|${text}`;
      let m = measureCache.current.get(key);
      if (m == null) {
        ctx.font = font;
        setSpacing(spacing);
        m = ctx.measureText(text).width;
        setSpacing('0px');
        measureCache.current.set(key, m);
      }
      return m;
    };
    const fontFamily = theme.font;
    const placeText = (
      text: string,
      x: number,
      y: number,
      sizePx: number,
      weight: number,
      color: string,
      alpha: number,
      key: NodeKey | null,
      force: boolean,
      spacing = '0px',
    ) => {
      const font = `${weight} ${sizePx}px ${fontFamily}`;
      const tw = measure(font, text, spacing);
      const b: Box = { x: x - tw / 2 - 3, y: y - sizePx - 1, w: tw + 6, h: sizePx + 3, key };
      if (b.x + b.w < 0 || b.x > w || b.y + b.h < 0 || b.y > h) return false;
      if (!force && overlaps(b)) return false;
      boxes.push(b);
      ctx.font = font;
      setSpacing(spacing);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = alpha;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 9, 14, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
      setSpacing('0px');
      return true;
    };

    // Semantic zoom: a label budget that grows with zoom. Labels shown last
    // frame go first among equals, so moving the cursor doesn't reshuffle them.
    const prio = (n: TasteMapPayloadNode) =>
      n.key === sel ? 0 : n.key === p.hoveredKey || n.key === nearKey ? 1 : related.has(n.key) ? 2 : 3;
    const was = labelShown.current;
    const labelOrder = nodes
      .filter((n) => pos.has(n.key))
      .sort(
        (x, y) =>
          prio(x) - prio(y) ||
          Number(was.has(y.key)) - Number(was.has(x.key)) ||
          Number(!!x.ghost) - Number(!!y.ghost) ||
          (rank.get(x.key) ?? 0) - (rank.get(y.key) ?? 0),
      );
    let budget = labelBudget(v.k, labelOrder.length);
    const shownNow = new Set<NodeKey>();

    if (gh && ghostXY) {
      placeText(gh.label, ghostXY[0], ghostXY[1] - ghostR - 4, 13, 800, SKY.ink, 1, null, true);
      placeText(gh.tag.toUpperCase(), ghostXY[0], ghostXY[1] + ghostR + 12, 9.5, 800, SKY.muted, 1, null, true);
    }
    if (sch?.nucleus && s * baseShare > 0.3) {
      const [nx, ny] = toScreen(sch.nucleus[0], sch.nucleus[1], v, F);
      placeText(p.nucleusLabel, nx, ny - 10, 9.5, 800, SKY.muted, s * baseShare, null, true, '2px');
    }

    let groupLabelsDone = false;
    const drawGroupLabels = () => {
      groupLabelsDone = true;
      // Countries name the map once there are two; group names would repeat them.
      if (names >= 2) return;
      // Far zoom: one constellation name per group, at its members' weighted center.
      const ga = Math.max(0, Math.min(1, (1.9 - v.k) / 0.8));
      if (ga <= 0.02) return;
      for (const g of p.payload.groups) {
        if (p.hiddenGroups.has(g.id)) continue;
        let top = Infinity;
        let sx = 0;
        let sw = 0;
        for (const n of nodes) {
          const wgt = n.groups[g.id] ?? 0;
          const q = pos.get(n.key);
          if (wgt < 0.5 || !q) continue;
          top = Math.min(top, q[1] - nodeRadius(n.mass, v.k));
          sx += q[0] * wgt * n.mass;
          sw += wgt * n.mass;
        }
        if (!sw) continue;
        placeText(g.name.toUpperCase(), sx / sw, top - 22, 11.5, 700, hexAlpha(g.color, 1), 0.9 * ga * baseShare, null, false, '2.5px');
      }
    };

    for (const n of labelOrder) {
      const pr = prio(n);
      if (pr === 3 && !groupLabelsDone) drawGroupLabels();
      if (pr === 3 && budget <= 0) break;
      const [x, y] = pos.get(n.key)!;
      const dr = drawnNow.get(n.key)?.r ?? nodeRadius(n.mass, v.k);
      const sizePx = Math.round(Math.min(15, 9.5 + 1.2 * Math.sqrt(n.mass)) * Math.min(1.15, 0.9 + 0.1 * v.k));
      const text = n.eraLabel ? `${n.label} · ${n.eraLabel}` : n.label;
      const dim = dimOthers && !related.has(n.key);
      const b = prox.get(n.key) ?? 0;
      const lit = pr <= 1;
      const color = lit ? SKY.ink : n.ghost ? SKY.muted : 'rgb(205, 211, 226)';
      const alpha = Math.max(dim ? 0.35 : 1, b) * (n.ghost && !lit ? 0.8 : 1);
      if (placeText(text, x, y - dr - (n.ghost ? 8 : 5), sizePx, lit ? 750 : 550, color, alpha, n.key, lit)) {
        shownNow.add(n.key);
        if (pr === 3) budget--;
      }
    }
    if (!groupLabelsDone) drawGroupLabels();
    labelShown.current = shownNow;
    labelBoxes.current = boxes;
    drawn.current = drawnNow;

    // Proximity card: the nearest star's era, albums and depth, then (closer
    // still) its top sounds. In-canvas, star-chart style, beside the star.
    const nearNode = nearKey ? nodes.find((m) => m.key === nearKey) : null;
    const nearXY = nearNode ? pos.get(nearNode.key) : undefined;
    if (nearNode && nearXY && nearXY[0] >= 0 && nearXY[0] <= w && nearXY[1] >= 0 && nearXY[1] <= h && !((e.from || e.to) && eu < 1)) {
      const rv = smooth((PROX_CARD - nearD) / (PROX_CARD * 0.45));
      const hit = nearKey === p.hoveredKey;
      const rc = hit ? 1 : smooth((PROX_CHIPS - nearD) / (PROX_CHIPS * 0.5));
      if (rv > 0.02) {
        const [sx, sy] = pos.get(nearNode.key)!;
        const sr = drawnNow.get(nearNode.key)?.r ?? 6;
        const font = theme.font;
        const pad = 8;
        const lines: string[] = [];
        if (nearNode.eraLabel) lines.push(nearNode.eraLabel);
        lines.push(t2.albums(nearNode.mass) + (nearNode.avgScore != null ? ` · ${t2.avg} ${nearNode.avgScore.toFixed(1)}` : ''));
        const pct = dz.pct.get(nearNode.key) ?? 0.5;
        const zn = dz.norm.get(nearNode.key) ?? 0;
        const depthWord = zn > 0.5 ? t2.front : zn < -0.5 ? t2.back : t2.mid;
        const palette = p.payload.palette;
        const chips = (palette && nearNode.mix
          ? palette.map((pt) => ({ ...pt, share: nearNode.mix?.[pt.id] ?? 0 })).filter((pt) => pt.share >= 0.05)
          : []
        )
          .sort((x1, y1) => y1.share - x1.share)
          .slice(0, 3);
        ctx.font = `600 11px ${font}`;
        const textW = Math.max(...lines.map((l) => measure(`600 11px ${font}`, l, '0px')));
        const chipW = chips.map((cp) => measure(`600 10.5px ${font}`, `${cp.label} ${Math.round(cp.share * 100)}%`, '0px') + 18);
        const chipsW = chipW.reduce((x1, y1) => x1 + y1, 0) + Math.max(0, chips.length - 1) * 4;
        const cw = Math.max(150, textW, rc > 0 ? chipsW : 0) + 2 * pad;
        const lineH = 15;
        const baseH = pad + lines.length * lineH + 20 + pad;
        const chH = chips.length ? 22 * rc : 0;
        const chh = baseH + chH;
        let cx1 = sx + sr + 14;
        if (cx1 + cw > w - 8) cx1 = sx - sr - 14 - cw;
        cx1 = Math.max(8, Math.min(w - cw - 8, cx1));
        let cy1 = sy - 16;
        cy1 = Math.max(8, Math.min(h - chh - 8, cy1));
        ctx.save();
        ctx.globalAlpha = rv;
        rrect(ctx, cx1, cy1, cw, chh, 8);
        ctx.fillStyle = 'rgba(12, 14, 22, 0.96)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `${SKY.line}0.16)`;
        ctx.stroke();
        ctx.clip();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let ty = cy1 + pad + lineH / 2;
        lines.forEach((l, i) => {
          ctx.font = `${i === 0 && nearNode.eraLabel ? 700 : 600} 11px ${font}`;
          ctx.fillStyle = i === 0 && nearNode.eraLabel ? SKY.ink : SKY.muted;
          ctx.fillText(l, cx1 + pad, ty);
          ty += lineH;
        });
        // Depth: where it sits front-to-back among your stars.
        const barX = cx1 + pad + measure(MATH_FONT, t2.depthWord, '0px') + 8;
        const barW = cw - (barX - cx1) - pad - measure(`600 10.5px ${font}`, depthWord, '0px') - 8;
        const by = ty + 3;
        ctx.font = MATH_FONT;
        ctx.fillStyle = SKY.muted;
        ctx.fillText(t2.depthWord, cx1 + pad, by);
        ctx.fillStyle = `${SKY.line}0.16)`;
        rrect(ctx, barX, by - 2, barW, 4, 2);
        ctx.fill();
        const c = colorOf(nearNode.key);
        ctx.beginPath();
        ctx.arc(barX + pct * barW, by, 3.6, 0, TAU);
        ctx.fillStyle = rgbCss(c);
        ctx.fill();
        ctx.font = `600 10.5px ${font}`;
        ctx.fillStyle = SKY.ink;
        ctx.textAlign = 'right';
        ctx.fillText(depthWord, cx1 + cw - pad, by);
        ctx.textAlign = 'left';
        if (chips.length && rc > 0.01) {
          ctx.globalAlpha = rv * rc;
          let chx = cx1 + pad;
          const chy = by + 20;
          chips.forEach((cp, i) => {
            const col = tintOf(cp.hue, 0.78, 0.14);
            rrect(ctx, chx, chy - 8, chipW[i], 16, 8);
            ctx.fillStyle = rgbCss(col, 0.16);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(chx + 8, chy, 3, 0, TAU);
            ctx.fillStyle = rgbCss(col);
            ctx.fill();
            ctx.fillStyle = SKY.ink;
            ctx.fillText(`${cp.label} ${Math.round(cp.share * 100)}%`, chx + 14, chy + 0.5);
            chx += chipW[i] + 4;
          });
        }
        ctx.restore();
      }
    }

    // What's here?: the sampled point and the kernel's reach (one bandwidth).
    const hr = hereRef.current;
    if (hr) {
      const [hx, hy] = toScreen(hr.at[0], hr.at[1], v, F);
      const bw = 40 * frame.gs * F * v.k;
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${SKY.line}0.45)`;
      ctx.beginPath();
      ctx.arc(hx, hy, bw, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = SKY.ink;
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy);
      ctx.lineTo(hx + 6, hy);
      ctx.moveTo(hx, hy - 6);
      ctx.lineTo(hx, hy + 6);
      ctx.stroke();
      ctx.restore();
      const card = hereCard.current;
      if (card) {
        const cw = card.offsetWidth || 230;
        const chh = card.offsetHeight || 160;
        let x = hx + 14;
        if (x + cw > w - 8) x = hx - 14 - cw;
        const y = Math.max(8, Math.min(h - chh - 8, hy - 20));
        card.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
      }
    }

    // Compass: which way each defining tag grows across the map.
    if (compass.length && w >= 320) {
      const R = 38;
      const ox = 16 + R + 6;
      const oy = h - 16 - R - 6;
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 9, 14, 0.55)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${SKY.line}0.14)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox - R, oy);
      ctx.lineTo(ox + R, oy);
      ctx.moveTo(ox, oy - R);
      ctx.lineTo(ox, oy + R);
      ctx.strokeStyle = `${SKY.line}0.06)`;
      ctx.stroke();
      // Arrows in the dial; their names in a key beside it (tips would clip and collide).
      const arrow = (x0: number, y0: number, x1: number, y1: number, head: number) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const ang = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(ang - 0.42), y1 - head * Math.sin(ang - 0.42));
        ctx.lineTo(x1 - head * Math.cos(ang + 0.42), y1 - head * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      };
      ctx.font = MATH_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const rowH = 15;
      const ky0 = oy - ((compass.length - 1) * rowH) / 2;
      compass.forEach((g, i) => {
        const len = R * (0.45 + 0.55 * Math.min(1, g.strength / 0.25));
        const col = rgbCss(oklabToRgb(0.8, 0.15 * Math.cos((g.hue * Math.PI) / 180), 0.15 * Math.sin((g.hue * Math.PI) / 180)));
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, g.r2 * 2);
        arrow(ox, oy, ox + g.dx * len, oy - g.dy * len, 6);
        const kx = ox + R + 12;
        const ky = ky0 + i * rowH;
        ctx.lineWidth = 1.3;
        arrow(kx + 6 - g.dx * 6, ky + g.dy * 6, kx + 6 + g.dx * 6, ky - g.dy * 6, 4);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 9, 14, 0.85)';
        ctx.strokeText(g.label, kx + 18, ky);
        ctx.fillText(g.label, kx + 18, ky);
      });
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }

    drawStats.current.push(performance.now() - now);
    if (drawStats.current.length > 400) drawStats.current.splice(0, 200);
    if (animating) raf.current = requestAnimationFrame(() => drawRef.current());
  };
  const drawStats = useRef<number[]>([]);

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const requestDraw = () => {
    if (raf.current == null) raf.current = requestAnimationFrame(() => drawRef.current());
  };
  const requestDrawRef = useRef(requestDraw);
  requestDrawRef.current = requestDraw;

  // Redraw whenever anything the picture depends on changes.
  useEffect(() => {
    requestDrawRef.current();
  });

  // Frame a node: center it and zoom in a little (mode switch, inspector click).
  const focusNonce = focus?.nonce ?? null;
  useEffect(() => {
    if (!focus) return;
    const gh = propsRef.current.ghost;
    const n = propsRef.current.payload.nodes.find((m) => m.key === focus.key);
    const q = n ? placeAt(n, sTarget) : gh?.key === focus.key ? ghostAt(gh, sTarget) : null;
    if (!q || size.current.w === 0) return;
    const F = fitScale();
    const k = Math.max(view.current.k, 1.8);
    goal.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
    requestDrawRef.current();
    // fitScale reads refs; frame is the only real dependency besides the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, frame]);

  // Switching scales re-frames while the stars morph: on the selection, else the whole map.
  const shownScale = useRef(sTarget);
  useEffect(() => {
    if (shownScale.current === sTarget) return;
    shownScale.current = sTarget;
    const sel = propsRef.current.payload.nodes.find((m) => m.key === propsRef.current.selectedKey);
    if (sel && size.current.w > 0) {
      const F = fitScale();
      const k = Math.max(view.current.k, 1.8);
      const q = placeAt(sel, sTarget);
      goal.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
    } else goal.current = homeView(sTarget);
    requestDrawRef.current();
    // fitScale / placeAt / homeView read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sTarget, frame]);

  // ── Refocus on select: animate the others into an ego view of the selection ──
  // A star selected by grabbing it doesn't refocus: the map would fly into the
  // ego view under the drag (and after the drop, hide where it landed). Picking
  // a refocus mode or selecting another star brings refocus back.
  useEffect(() => {
    if (props.selectedKey !== grabbedSel) setGrabbedSel(null);
    // Only a selection change clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedKey]);
  const egoMode: EgoMode | null =
    props.selectedKey && egoPick !== 'off' && visible.has(props.selectedKey) && props.selectedKey !== grabbedSel ? egoPick : null;
  const egoSel = egoMode ? props.selectedKey : null;
  useEffect(() => {
    const p = propsRef.current;
    const now = performance.now();
    const e = ego.current;
    const dur = reduced.current ? 0 : EGO_MS;
    const stagger = reduced.current ? 0 : EGO_STAGGER_MS;
    // Every star starts from where it is drawn now (mid-transition included).
    const from = lastPlane.current.size ? new Map(lastPlane.current) : null;
    if (!egoMode || !egoSel) {
      if (!e.to) return;
      ego.current = { from, fromLayout: e.to, to: null, t0: now, dur, stagger };
      if (preEgoView.current) goal.current = preEgoView.current;
      preEgoView.current = null;
      requestDrawRef.current();
      return;
    }
    const t0 = performance.now();
    // Bearings and in-plane offsets come from the map (not a previous refocus),
    // translated so the selection stays exactly where it is drawn now.
    const base = new Map<NodeKey, Vec2>();
    for (const n of p.payload.nodes) if (p.visible.has(n.key) && !isHidden(n)) base.set(n.key, placeAt(n, sTarget));
    const selBase = base.get(egoSel);
    if (!selBase) return;
    const selNow = lastPlane.current.get(egoSel) ?? selBase;
    const sx = selNow[0] - selBase[0];
    const sy = selNow[1] - selBase[1];
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of base.values()) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const R = 0.5 * Math.max(x1 - x0, y1 - y0, 1e-3);
    const W = size.current.w || 800;
    const H = size.current.h || 600;
    // Stars ≥ 20 px apart once the layout is framed.
    const pxPerUnit = Math.max(60, Math.min(W - 140, H * (W < 768 ? 0.42 : 1) - 150)) / (2 * R);
    const byKey = new Map(p.payload.nodes.map((n) => [n.key, n]));
    const dzs = depthRef.current;
    const L = egoLayout({
      nodes: [...base].map(([key, q]) => {
        const n = byKey.get(key)!;
        return { key, x: q[0] + sx, y: q[1] + sy, z: dzs.norm.get(key) ?? 0, mass: n.mass, mix: n.mix };
      }),
      selected: egoSel,
      sim: sims.row(egoSel),
      simOf: (a, b) => sims.get(a, b),
      mode: egoMode,
      R,
      minSep: 20 / pxPerUnit,
      palette: p.payload.palette,
      labelOf: (k) => byKey.get(k)?.label ?? k,
    });
    if (!e.to) preEgoView.current = goal.current ? { ...goal.current } : { ...view.current };
    ego.current = { from, fromLayout: e.to, to: L, t0: now, dur, stagger };
    // Frame the new layout (with room for its axes in the vector view).
    if (size.current.w > 0) {
      let bx0 = Infinity;
      let bx1 = -Infinity;
      let by0 = Infinity;
      let by1 = -Infinity;
      for (const [x, y] of L.pos.values()) {
        bx0 = Math.min(bx0, x);
        bx1 = Math.max(bx1, x);
        by0 = Math.min(by0, y);
        by1 = Math.max(by1, y);
      }
      if (L.mode === 'distance') {
        bx0 = Math.min(bx0, L.center[0] - R * 0.6);
        bx1 = Math.max(bx1, L.center[0] + R * 0.6);
        by0 = Math.min(by0, L.center[1] - R * 0.6);
        by1 = Math.max(by1, L.center[1] + R * 0.6);
      }
      const m = 0.04 * R;
      goal.current = fitView(bx0 - m, bx1 + m, by0 - m, by1 + m, 2.2, L.mode === 'vector' ? { left: 30, bottom: 80 } : undefined);
    }
    egoMs.current = performance.now() - t0;
    requestDrawRef.current();
    // placeAt / fitView read refs; settled stands in for in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [egoSel, egoMode, sTarget, visible, settled, sims]);
  const egoMs = useRef(0);

  // What's here? closes when a star gets selected, and on Esc.
  const selectedKey = props.selectedKey;
  useEffect(() => {
    if (selectedKey) setHere(null);
  }, [selectedKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHere(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dev-only probes for screenshot / perf scripts: drawn star positions and draw timings.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as Record<string, unknown>;
    w.__map2d = () =>
      [...drawn.current].map(([key, q]) => {
        const n = propsRef.current.payload.nodes.find((m) => m.key === key);
        return { key, label: n?.label, mass: n?.mass, x: q.x, y: q.y, r: q.r };
      });
    w.__map2dFocus = () => cursorFocus.current;
    w.__map2dStats = () => {
      const d = [...drawStats.current].sort((a, b) => a - b);
      return { draws: d.length, medianDrawMs: d[d.length >> 1], p95DrawMs: d[Math.floor(d.length * 0.95)], egoLayoutMs: egoMs.current };
    };
    return () => {
      delete w.__map2d;
      delete w.__map2dStats;
      delete w.__map2dFocus;
    };
  }, []);

  // prefers-reduced-motion: no cursor lenses, refocus and overlap removal jump instead of easing.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reduced.current = mq.matches;
      requestDrawRef.current();
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Size + DPR tracking.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (first && w > 0) {
        first = false;
        // Mounted with a selection (switched from 3D): open already framed on it.
        const f = propsRef.current.focus;
        const sel = f ? propsRef.current.payload.nodes.find((m) => m.key === f.key) : null;
        if (sel) {
          const F = fitScale();
          const k = 1.8;
          const q = placeAt(sel, sTarget);
          view.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
        } else view.current = homeView(sTarget);
      }
      requestDrawRef.current();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', measure);
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  // ── Pointer input: pan, pinch, wheel, hover, click ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number } | null = null;
    let moved = false;
    let pinchDist = 0;
    // Node drag: the node under the pointer at pointerdown, plus the plane
    // offset from the pointer to the node so it doesn't jump to the cursor.
    let drag: { key: NodeKey; dx: number; dy: number; started: boolean } | null = null;
    // A star pressed where it can't be moved: why (hinted once the press turns into a drag).
    let blocked: 'schematic' | 'refocus' | null = null;
    // Drag HUD: recomputed at most once a frame from the latest drag position.
    let hudAt: Vec2 | null = null;
    let hudRaf: number | null = null;
    const computeHud = () => {
      hudRaf = null;
      const ds = dragStart.current;
      if (!ds || !hudAt) return;
      const p = propsRef.current;
      const pts = p.payload.nodes.flatMap((n) =>
        n.key !== ds.key && !n.ghost && p.visible.has(n.key) ? [{ key: n.key, x: n.pos2d[0], y: n.pos2d[1], mass: n.mass, mix: n.mix }] : [],
      );
      const impact = dragImpact({
        key: ds.key,
        start: ds.start,
        now: hudAt,
        points: pts,
        trueNeighbors: (p.payload.neighbors[ds.key] ?? []).map((nb) => nb.key),
        simTo: (o) => simsRef.current.get(ds.key, o),
        span: Math.max(frame.spanX, frame.spanY),
        bandwidth: 40 * frame.gs,
      });
      setDragHud({ key: ds.key, impact });
    };
    const endDrag = () => {
      const d = drag;
      drag = null;
      draggingNode.current = false;
      dragStart.current = null;
      hudAt = null;
      if (hudRaf != null) cancelAnimationFrame(hudRaf);
      hudRaf = null;
      setDragHud(null);
      if (!d?.started) return;
      const n = propsRef.current.payload.nodes.find((m) => m.key === d.key);
      if (n) propsRef.current.onDragNode(d.key, 'end', { pos2d: [n.pos2d[0], n.pos2d[1]] });
    };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoomAt = (px: number, py: number, factor: number) => {
      const v = view.current;
      const { w, h } = size.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const ux = (px - w / 2 - v.tx) / v.k;
      const uy = (py - h / 2 - v.ty) / v.k;
      view.current = { k, tx: px - w / 2 - ux * k, ty: py - h / 2 - uy * k };
    };
    // Hit tests use what was drawn last frame: refocus, lenses and covers included.
    const hitTest = (x: number, y: number): NodeKey | null => {
      for (const b of labelBoxes.current) {
        if (b.key && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
      }
      let best: NodeKey | null = null;
      let bestD = Infinity;
      for (const [key, q] of drawn.current) {
        const d = Math.hypot(q.x - x, q.y - y);
        if (d <= q.r + 6 && d < bestD) {
          bestD = d;
          best = key;
        }
      }
      return best;
    };
    /** "What's here?" at a screen point: the field's kernel mix there, and the nearest stars. */
    const openHere = (sx: number, sy: number) => {
      const p = propsRef.current;
      const at = toPlaneXY(sx, sy, view.current, fitScale());
      const pts = p.payload.nodes.flatMap((n) => {
        const q = lastPlane.current.get(n.key);
        return q && !n.ghost ? [{ key: n.key, x: q[0], y: q[1], mass: n.mass, mix: n.mix }] : [];
      });
      setHere({ at, summary: whatsHere(pts, at, 40 * frame.gs), query: hereQuery(pts, at, 40 * frame.gs), sx, sy });
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const q = local(e);
      pointers.set(e.pointerId, q);
      pressing.current = true;
      goal.current = null;
      if (pointers.size === 1) {
        down = q;
        moved = false;
        const p = propsRef.current;
        // No dragging in a refocus: those positions aren't places on the map.
        const movable = p.editable && sNow.current === 0 && !ego.current.to;
        const hit = movable ? hitTest(q.x, q.y) : null;
        const n = hit ? p.payload.nodes.find((m) => m.key === hit) : null;
        blocked = null;
        if (!movable && hitTest(q.x, q.y)) blocked = ego.current.to ? 'refocus' : sNow.current > 0 || p.scale === 'schematic' ? 'schematic' : null;
        if (n) {
          const [wx, wy] = toPlaneXY(q.x, q.y, view.current, fitScale());
          drag = { key: n.key, dx: n.pos2d[0] - wx, dy: n.pos2d[1] - wy, started: false };
        }
      } else if (pointers.size === 2) {
        // A second finger turns a node drag into a pinch; drop the node where it is.
        endDrag();
        const [a, b] = Array.from(pointers.values());
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        moved = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const q = local(e);
      const prev = pointers.get(e.pointerId);
      if (e.pointerType === 'mouse') {
        cursor.current = { x: q.x, y: q.y, inside: true };
        if (!prev) requestDrawRef.current();
      }
      if (!prev) {
        if (e.pointerType === 'mouse') {
          const hit = hitTest(q.x, q.y);
          if (hit !== propsRef.current.hoveredKey) propsRef.current.onHover(hit);
          canvas.style.cursor = hit ? 'pointer' : 'grab';
        }
        return;
      }
      pointers.set(e.pointerId, q);
      if (pointers.size === 1) {
        if (down && Math.hypot(q.x - down.x, q.y - down.y) > 4) moved = true;
        if (moved && drag) {
          const p = propsRef.current;
          if (!drag.started) {
            drag.started = true;
            draggingNode.current = true;
            const n0 = p.payload.nodes.find((m) => m.key === drag!.key);
            if (n0) dragStart.current = { key: n0.key, start: [n0.pos2d[0], n0.pos2d[1]] };
            setGrabbedSel(drag.key);
            p.onDragNode(drag.key, 'start', {});
          }
          const [wx, wy] = toPlaneXY(q.x, q.y, view.current, fitScale());
          p.onDragNode(drag.key, 'move', { pos2d: [wx + drag.dx, wy + drag.dy] });
          hudAt = [wx + drag.dx, wy + drag.dy];
          if (hudRaf == null) hudRaf = requestAnimationFrame(computeHud);
          canvas.style.cursor = 'grabbing';
          requestDrawRef.current();
        } else if (moved) {
          if (blocked) {
            const why = blocked;
            blocked = null;
            setBlockHint(why);
            if (blockTimer.current) clearTimeout(blockTimer.current);
            blockTimer.current = setTimeout(() => setBlockHint(null), 3200);
          }
          view.current = { ...view.current, tx: view.current.tx + q.x - prev.x, ty: view.current.ty + q.y - prev.y };
          canvas.style.cursor = 'grabbing';
          requestDrawRef.current();
        }
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        requestDrawRef.current();
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
      if (wasSingle && drag) endDrag();
      if (wasSingle && !moved && e.type === 'pointerup') {
        const q = local(e);
        const hit = hitTest(q.x, q.y);
        const p = propsRef.current;
        if (hit) {
          setHere(null);
          p.onSelect(hit);
        } else if (p.selectedKey) p.onSelect(null);
        // Empty sky with nothing selected: what's here?
        else openHere(q.x, q.y);
      }
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        down = null;
        pressing.current = false;
        requestDrawRef.current();
      }
    };
    const onLeave = () => {
      cursor.current = { ...cursor.current, inside: false };
      requestDrawRef.current();
      if (pointers.size === 0 && propsRef.current.hoveredKey) propsRef.current.onHover(null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      goal.current = null;
      const q = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(q.x, q.y, Math.exp(-dy * 0.0015));
      requestDrawRef.current();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (hudRaf != null) cancelAnimationFrame(hudRaf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
    // Handlers read everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const selNode = props.selectedKey && visible.has(props.selectedKey) ? payload.nodes.find((n) => n.key === props.selectedKey) ?? null : null;
  const palette = payload.palette;
  const hereSwatch = (id: string) => {
    const hue = hues.get(id);
    return hue == null ? 'rgb(140, 148, 168)' : rgbCss(tintOf(hue, 0.72, 0.13));
  };
  const hereLabel = (id: string) => palette?.find((pt) => pt.id === id)?.label ?? id;
  const egoTips: Record<EgoPick, [string, string]> = {
    off: [t2.inPlace, t2.inPlaceTip],
    distance: [t2.distance, t2.distanceTip],
    vector: [t2.vector, t2.vectorTip],
    depth: [t2.depth, t2.depthTip],
  };
  const caption = selNode
    ? egoPick === 'distance'
      ? t2.capDistance(selNode.label)
      : egoPick === 'vector'
        ? t2.capVector(selNode.label)
        : egoPick === 'depth'
          ? t2.capDepth(selNode.label)
          : null
    : null;
  return (
    <div ref={wrapRef} className="absolute inset-0" style={{ background: SKY.bg }}>
      <canvas ref={canvasRef} className="block touch-none select-none" style={{ cursor: 'grab' }} aria-label="Taste map (2D)" role="img" />

      {/* Refocus switch: how the others re-arrange around the selection. */}
      {selNode && (
        <div className="pointer-events-none absolute left-2.5 top-[48px] flex max-w-[calc(100%-1.25rem)] flex-col items-start gap-1">
          <div
            role="group"
            aria-label={t2.viewModes}
            className="pointer-events-auto inline-flex rounded-full border border-divider bg-surface/85 p-0.5 text-[11.5px] font-semibold backdrop-blur"
          >
            {(['off', ...EGO_MODES] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={egoPick === m}
                title={egoTips[m][1]}
                onClick={() => {
                  setEgoPick(m);
                  setGrabbedSel(null);
                }}
                className={`rounded-full px-2.5 py-1 transition ${egoPick === m ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}
              >
                {egoTips[m][0]}
              </button>
            ))}
          </div>
          <span className="pointer-events-auto -mt-0.5 inline-flex items-center gap-1">
            {caption && (
              <p className="hidden max-w-full truncate rounded-full border border-divider/60 bg-surface/80 px-2 py-0.5 text-[10px] leading-snug text-muted backdrop-blur md:block">
                {caption}
              </p>
            )}
            <span className="rounded-full bg-surface/80 backdrop-blur">
              <InfoTip label={t2.info} text={t2.viewModesInfo} />
            </span>
          </span>
        </div>
      )}

      {/* What's here?: the smoothed sound mix at an empty spot, and who's nearest. */}
      {here && (
        <div
          ref={hereCard}
          className="absolute left-0 top-0 z-[6] w-[230px] rounded-xl border border-divider bg-surface/95 p-3 text-ink shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-md"
          style={{ transform: `translate(${Math.round(here.sx + 14)}px, ${Math.round(Math.max(8, here.sy - 20))}px)` }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
              {t2.hereTitle}
              <InfoTip label={t2.info} text={t2.hereInfo} className="-my-1 ml-0.5" />
            </p>
            <button type="button" aria-label={t2.close} onClick={() => setHere(null)} className="-m-1 rounded-full p-1 text-muted hover:text-ink">
              <X size={13} />
            </button>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
            {here.summary.density < 0.05 ? t2.hereEmpty : here.summary.density < 1.4 ? t2.hereSparse : t2.hereDense}
          </p>
          {here.summary.density >= 0.05 && here.summary.mix.length > 0 && (
            <ul className="mt-2 space-y-1">
              {here.summary.mix.slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hereSwatch(m.id) }} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{hereLabel(m.id)}</span>
                  <span className="h-[5px] w-14 overflow-hidden rounded-full bg-divider">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round(m.share * 100)}%`, background: hereSwatch(m.id) }} />
                  </span>
                  <span className="w-8 text-right tabular-nums text-muted">{Math.round(m.share * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
          {here.summary.nearest.length > 0 && (
            <>
              <p className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{t2.hereNearest}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {here.summary.nearest.map((nb) => {
                  const n = payload.nodes.find((m) => m.key === nb.key);
                  if (!n) return null;
                  return (
                    <button
                      key={nb.key}
                      type="button"
                      onClick={() => {
                        setHere(null);
                        props.onSelect(nb.key);
                      }}
                      className="max-w-full truncate rounded-full border border-divider px-2 py-0.5 text-[11px] font-semibold text-ink transition hover:bg-ink hover:text-page"
                    >
                      {n.label}
                      {n.eraLabel ? <span className="font-normal text-muted"> · {n.eraLabel}</span> : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {/* Unrated catalog albums near this spot (GET /api/taste/map/nearby). */}
          <HereSuggestions query={here.query} />
        </div>
      )}

      {/* Drag HUD: what the move in progress changes, live (lib/tasteMap/dragImpact.ts). */}
      {dragHud && <DragHud hud={dragHud} t2={t2} nodes={payload.nodes} label={hereLabel} swatch={hereSwatch} />}

      {/* Why a star didn't move (schematic or refocus). */}
      {blockHint && !dragHud && (
        <div
          role="status"
          className="pointer-events-none absolute right-2.5 top-[52px] z-[7] w-[min(320px,calc(100%-1.25rem))] rounded-xl border border-divider bg-surface/95 px-3 py-2 text-[11.5px] leading-snug text-ink shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-md"
        >
          {blockHint === 'schematic' ? t2.blockSchematic : t2.blockRefocus}
        </div>
      )}

      {/* First visit: how to read and handle the sky (dismissed for good). */}
      {introOpen && !dragHud && !blockHint && !here && !props.selectedKey && (
        <div
          role="note"
          className="absolute left-1/2 top-[52px] z-[5] w-[min(380px,calc(100%-1.25rem))] -translate-x-1/2 rounded-xl border border-divider bg-surface/95 p-3 text-ink shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-md"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">{t2.introTitle}</p>
            <button type="button" aria-label={t2.close} onClick={closeIntro} className="-m-1 rounded-full p-1 text-muted hover:text-ink">
              <X size={13} />
            </button>
          </div>
          {touchOnly ? (
            <p className="mt-1 text-[11.5px] leading-snug">{t2.introTouch}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11.5px] leading-snug">
              <li>{t2.introHover}</li>
              <li>{t2.introClick}</li>
              <li>{t2.introDrag}</li>
            </ul>
          )}
          <button
            type="button"
            onClick={closeIntro}
            className="mt-2 rounded-full border border-ink bg-ink px-3 py-1 text-[11.5px] font-semibold text-page"
          >
            {t2.gotIt}
          </button>
        </div>
      )}
    </div>
  );
}

type Copy2D = (typeof COPY2D)['en'];

/** The live drag panel: distance, the sound mix it's moving into, neighbors joined and left, and fit with the data. */
function DragHud({
  hud,
  t2,
  nodes,
  label,
  swatch,
}: {
  hud: { key: NodeKey; impact: DragImpact };
  t2: Copy2D;
  nodes: TasteMapPayloadNode[];
  label: (id: string) => string;
  swatch: (id: string) => string;
}) {
  const { impact: d } = hud;
  const name = (k: NodeKey) => nodes.find((n) => n.key === k)?.label ?? k;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fitDown = d.keptAfter < d.keptBefore;
  const fitUp = d.keptAfter > d.keptBefore;
  const dots = (a: number, k: number) => (
    <span className="inline-flex gap-[3px]" aria-hidden>
      {Array.from({ length: k }, (_, i) => (
        <span key={i} className={`h-[6px] w-[6px] rounded-full ${i < a ? 'bg-ink' : 'border border-muted/60'}`} />
      ))}
    </span>
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-2.5 top-[52px] z-[7] w-[min(300px,calc(100%-1.25rem))] rounded-xl border border-divider bg-surface/95 p-3 text-ink shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-md"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{t2.moving}</p>
      <p className="truncate text-[14px] font-extrabold leading-tight">{name(hud.key)}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted">{t2.moved(pct(d.movedPct))}</p>

      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{t2.soundAround}</p>
      {d.sound.length ? (
        <ul className="mt-1 space-y-0.5">
          {d.sound.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 text-[11.5px] tabular-nums">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch(m.id) }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{label(m.id)}</span>
              <span className="text-muted">
                {pct(m.before)} → {pct(m.after)}
              </span>
              <span className={`w-9 text-right font-bold ${m.delta > 0 ? 'text-ink' : 'text-muted'}`}>
                {m.delta > 0 ? '+' : '−'}
                {Math.abs(Math.round(m.delta * 100))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-[11.5px] text-muted">{t2.noSoundChange}</p>
      )}

      {(d.joined.length > 0 || d.left.length > 0) && (
        <div className="mt-2 space-y-0.5 text-[11.5px] leading-snug">
          {d.joined.length > 0 && (
            <p className="truncate">
              <span className="font-bold text-muted">{t2.nextTo} </span>
              {d.joined.map(name).join(', ')}
            </p>
          )}
          {d.left.length > 0 && (
            <p className="truncate text-muted">
              <span className="font-bold">{t2.leaving} </span>
              {d.left.map(name).join(', ')}
            </p>
          )}
        </div>
      )}

      {d.k > 0 && (
        <div className="mt-2 text-[11.5px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{t2.fitData}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 tabular-nums">
            {dots(d.keptBefore, d.k)}
            <span className="text-muted">→</span>
            {dots(d.keptAfter, d.k)}
            <span className={`font-semibold ${fitDown ? 'text-ink' : 'text-muted'}`}>
              {t2.fitOf(d.keptAfter, d.k)}
              {fitDown ? ' ↓' : fitUp ? ' ↑' : ''}
            </span>
          </p>
          {d.simBefore != null && d.simAfter != null && (
            <p className="mt-0.5 text-muted tabular-nums">
              {t2.avgSim}: {d.simBefore.toFixed(2)} → <span className="font-semibold text-ink">{d.simAfter.toFixed(2)}</span>
            </p>
          )}
        </div>
      )}

      <p className="mt-2 border-t border-divider pt-1.5 text-[10.5px] leading-snug text-muted">{t2.dropNote}</p>
    </div>
  );
}
