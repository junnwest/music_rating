/**
 * Node colors for the map lenses (client-side, pure).
 *
 * Genre lens (the default): each palette tag (palette.ts) is a direction on the
 * OKLab color wheel; a node's (a, b) is the mix-weighted sum of its tags'
 * directions. That one sum carries two readings at once:
 *   hue    = which tags it is made of (neighbor hues = tags that co-occur),
 *   chroma = how pure it is: tags pulling different ways cancel, so a genre
 *            hopper, or a node no palette tag explains, mixes toward gray.
 * Lightness is free for something else; the 2D map spends it on depth, the
 * axis the D5 flattening throws away (lighter = toward you), so two dots that
 * touch on screen but differ a lot in lightness were folded together.
 *
 * Score lens: the app's score ramp (spectrumColor), as before.
 *
 * Distortion lens (honest map, lib/tasteMap/honesty.ts): how much of a node's
 * real neighborhood the current view keeps. A diverging ramp straight through
 * OKLab, so the middle passes near gray: teal = kept, gray = half, ember = torn.
 */
import { spectrumColor } from '../sj/display';
import type { PaletteHue, TasteMapPayloadNode } from './types';

export type MapLens = 'genre' | 'score' | 'distortion';
export type Rgb = [number, number, number];

/** OKLab chroma of a fully pure node. */
export const CHROMA_MAX = 0.17;
/** |resultant|^γ: mixes rarely exceed ~0.6 on one tag, so lift the middle. */
export const PURITY_GAMMA = 0.6;
export const GRAY: Rgb = [128, 132, 142];

function gammaEncode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab → sRGB 0–255, pulling chroma in (hue kept) until it fits the gamut. */
export function oklabToRgb(L: number, a: number, b: number): Rgb {
  let k = 1;
  let rgb = oklabToLinear(L, a, b);
  for (let i = 0; i < 24 && !rgb.every((v) => v >= -0.0005 && v <= 1.0005); i++) {
    k *= 0.9;
    rgb = oklabToLinear(L, a * k, b * k);
  }
  return rgb.map((v) => Math.round(gammaEncode(Math.min(1, Math.max(0, v))) * 255)) as Rgb;
}

export function rgbCss([r, g, b]: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** (a, b) of a mix: Σ w·(cos h, sin h), shrunk by purity. Zero for an empty mix. */
export function mixAB(mix: Record<string, number> | undefined, hueById: Map<string, number>): [number, number] {
  if (!mix) return [0, 0];
  let x = 0;
  let y = 0;
  for (const [id, w] of Object.entries(mix)) {
    const h = hueById.get(id);
    if (h == null || !(w > 0)) continue;
    const rad = (h * Math.PI) / 180;
    x += w * Math.cos(rad);
    y += w * Math.sin(rad);
  }
  const r = Math.hypot(x, y);
  if (!(r > 1e-9)) return [0, 0];
  const c = CHROMA_MAX * Math.pow(Math.min(1, r), PURITY_GAMMA);
  return [(c * x) / r, (c * y) / r];
}

/** 0 (gray) … 1 (pure): the share of CHROMA_MAX a mix reaches. */
export function purity(mix: Record<string, number> | undefined, hueById: Map<string, number>): number {
  const [a, b] = mixAB(mix, hueById);
  return Math.hypot(a, b) / CHROMA_MAX;
}

/** Depth along the plane normal → OKLab lightness, a soft S around `mid`. */
export function depthLightness(z: number, sigma: number, mid: number, span: number): number {
  return mid + span * Math.tanh(sigma > 0 ? z / (1.5 * sigma) : 0);
}

export function hueMap(palette: PaletteHue[] | undefined): Map<string, number> {
  return new Map((palette ?? []).map((p) => [p.id, p.hue]));
}

const scoreCache = new Map<string, Rgb>();
/** The score ramp as RGB (spectrumColor returns `rgb(r, g, b)`). */
export function scoreRgb(score: number, L: number): Rgb {
  const key = `${score.toFixed(2)}|${L.toFixed(3)}`;
  let c = scoreCache.get(key);
  if (!c) {
    const m = spectrumColor(score, L, 1).match(/\d+/g);
    c = m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : GRAY;
    scoreCache.set(key, c);
  }
  return c;
}

/** Distortion ramp ends (OKLCh hue, degrees): neighborhood kept / torn. */
export const KEPT_HUE = 195;
export const TORN_HUE = 38;
const RAMP_CHROMA = 0.15;

/** Neighborhood recall (0–1) → color at lightness L. */
export function distortionRgb(recall: number, L: number): Rgb {
  const t = Math.min(1, Math.max(0, recall));
  const at = (h: number) => [RAMP_CHROMA * Math.cos((h * Math.PI) / 180), RAMP_CHROMA * Math.sin((h * Math.PI) / 180)];
  const [ka, kb] = at(KEPT_HUE);
  const [ta, tb] = at(TORN_HUE);
  return oklabToRgb(L, ta + (ka - ta) * t, tb + (kb - tb) * t);
}

/**
 * A node's color under a lens at lightness L. Unrated (score lens) and untagged
 * nodes are gray; the distortion lens needs the node's recall (gray without one).
 */
export function nodeRgb(n: TasteMapPayloadNode, lens: MapLens, hueById: Map<string, number>, L: number, recall?: number): Rgb {
  if (lens === 'score') return n.avgScore != null ? scoreRgb(n.avgScore, L) : GRAY;
  if (lens === 'distortion') return recall != null ? distortionRgb(recall, L) : GRAY;
  const [a, b] = mixAB(n.mix, hueById);
  return oklabToRgb(L, a, b);
}

/** True when the payload can show the genre lens (a palette with at least one hue). */
export function hasGenreLens(palette: PaletteHue[] | undefined): boolean {
  return !!palette && palette.length > 0;
}
