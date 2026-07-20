/**
 * Display helpers shared across the rebuilt web app — the TypeScript mirror of
 * iOS's `Release.swift` (`isPredominantlyHangul`, displayTitle/displayArtist,
 * typeLabel), `DateFormatting.swift` (relativeTimeString) and
 * `Theme.swift` (`thumbnailUrl`). Keep semantics identical to Swift.
 */

import { eloToScore } from '../elo';

/**
 * True when more than half of the string's letters are Hangul (syllables or
 * jamo). native_title / name_native are mixed-provenance — some rows hold a
 * Japanese/Chinese transliteration from an older backfill — so native values
 * are only trusted when they're actually predominantly Hangul (same guard as
 * iOS `String.isPredominantlyHangul`).
 */
export function isPredominantlyHangul(s: string | null | undefined): boolean {
  if (!s) return false;
  let hangul = 0;
  let letters = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Approximate CharacterSet.letters with Unicode property escape
    if (!/\p{L}/u.test(ch)) continue;
    letters += 1;
    if (
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0x1100 && cp <= 0x11ff) ||
      (cp >= 0x3130 && cp <= 0x318f)
    ) {
      hangul += 1;
    }
  }
  if (letters === 0) return false;
  return hangul / letters > 0.5;
}

// Current UI language, set by the LanguageProvider during render (module-level
// so the dozens of displayName call sites don't all need a lang parameter).
// Stays 'en' on the server — API routes that intentionally want the old
// unconditional-Hangul behavior use preferHangulName below instead.
let displayLang: 'en' | 'ko' = 'en';

export function setDisplayLanguage(lang: 'en' | 'ko') {
  displayLang = lang;
}

/**
 * Show the native value only in Korean mode — and only when it's actually
 * Hangul; else the Latin value. English mode always shows the Latin name
 * (SHINee, not 샤이니). iOS still prefers Hangul unconditionally — flagged
 * as a parity gap when this was fixed (2026-07-16).
 */
export function displayName(latin: string, native?: string | null): string {
  return displayLang === 'ko' && native && isPredominantlyHangul(native) ? native : latin;
}

/**
 * The pre-2026-07-16 displayName semantics: prefer Hangul regardless of UI
 * language. Kept for /api/taste/profile, whose cached payload is also consumed
 * by iOS — its output must not change with the web UI language.
 */
export function preferHangulName(latin: string, native?: string | null): string {
  return native && isPredominantlyHangul(native) ? native : latin;
}

/** Release-type chip label key — resolve through i18n at the call site. */
export function typeLabelKey(releaseType?: string | null): string {
  switch (releaseType?.toLowerCase()) {
    case 'album':
      return 'sj.type.album';
    case 'ep':
      return 'sj.type.ep';
    case 'single':
      return 'sj.type.single';
    case 'compilation':
      return 'sj.type.compilation';
    case 'soundtrack':
      return 'sj.type.soundtrack';
    default:
      return 'sj.type.release';
  }
}

/** Plain-English fallback (used where i18n context isn't available). */
export function typeLabelEn(releaseType?: string | null): string {
  switch (releaseType?.toLowerCase()) {
    case 'album':
      return 'Album';
    case 'ep':
      return 'EP';
    case 'single':
      return 'Single';
    default:
      return releaseType
        ? releaseType.charAt(0).toUpperCase() + releaseType.slice(1)
        : 'Release';
  }
}

/**
 * Downscaled URL for thumbnails (≤128px) — mirrors iOS `String.thumbnailUrl`.
 * iTunes: 600x600bb / 1200x1200bb → 300x300bb; CAA: front-500 → front-250.
 */
export function thumbnailUrl(url: string): string {
  return url
    .replace('600x600bb', '300x300bb')
    .replace('1200x1200bb', '300x300bb')
    .replace('front-500', 'front-250');
}

/** "3m" / "2h" / "5d" style relative time, mirroring iOS `Date.relativeTimeString`. */
export function relativeTime(iso: string, lang: 'en' | 'ko' = 'en'): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  if (lang === 'ko') {
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분`;
    if (hours < 24) return `${hours}시간`;
    if (days < 7) return `${days}일`;
    return `${weeks}주`;
  }
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return `${weeks}w`;
}

/** 12.3k-style count formatting (matches iOS formatCount). */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** "4" for integers, "4.5" otherwise — matches iOS score labels. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? `${score}` : score.toFixed(1);
}

/**
 * A rating row's displayable score: manual score wins; otherwise the
 * elo-derived score (0.1 steps). Returns null when neither exists.
 */
export function displayScore(
  score: number | null | undefined,
  eloScore: number | null | undefined,
): number | null {
  if (score != null) return score;
  if (eloScore != null) return eloToScore(eloScore);
  return null;
}

/** Year prefix of a date string, or ''. */
export function yearOf(date?: string | null): string {
  return date && date.length >= 4 ? date.slice(0, 4) : '';
}

// ── Score spectrum — perceptually-uniform OKLCh ramp ────────────────────────
// 0.5 → deep red, then orange, yellow-green, teal, and blue at 5.0. Unlike the
// old HSL hue-sweep (whose yellows blew out and whose blues went muddy), this
// walks hue/chroma at a *fixed* OKLab lightness per variant, so every score in
// the range reads at the same perceived brightness — terrain-like hue variety
// with viridis-like smoothness. Each variant (fill / number / ring) is the same
// hue curve rendered at its own lightness, so they always agree.
//
// iOS's ScoreBadge.swift still uses the old HSL sweep — a known parity gap.

/** Hue (OKLCh degrees) and chroma anchors across the 0.5–5.0 score range. */
const SPECTRUM_STOPS: { score: number; hue: number; chroma: number }[] = [
  { score: 0.5, hue: 25, chroma: 0.16 }, // deep red
  { score: 1.6, hue: 58, chroma: 0.145 }, // orange
  { score: 2.7, hue: 126, chroma: 0.15 }, // yellow-green
  { score: 3.8, hue: 196, chroma: 0.115 }, // teal
  { score: 5.0, hue: 262, chroma: 0.155 }, // blue
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate the hue/chroma anchors at `score` (clamped to 0.5–5.0). */
function spectrumStop(score: number): { hue: number; chroma: number } {
  const s = Math.min(Math.max(score, 0.5), 5);
  for (let i = 0; i < SPECTRUM_STOPS.length - 1; i += 1) {
    const a = SPECTRUM_STOPS[i];
    const b = SPECTRUM_STOPS[i + 1];
    if (s <= b.score) {
      const t = (s - a.score) / (b.score - a.score);
      return { hue: lerp(a.hue, b.hue, t), chroma: lerp(a.chroma, b.chroma, t) };
    }
  }
  const last = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1];
  return { hue: last.hue, chroma: last.chroma };
}

function gammaEncode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** OKLab → linear sRGB (Björn Ottosson's matrices). */
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
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

/**
 * OKLCh → `rgb()` string, walking chroma down until the color fits sRGB. Cutting
 * chroma (rather than clipping channels) keeps the hue and — crucially for an
 * equal-brightness ramp — the lightness intact.
 */
function oklchToCss(L: number, chroma: number, hueDeg: number): string {
  const rad = (hueDeg * Math.PI) / 180;
  let c = chroma;
  let rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 24; i += 1) {
    rgb = oklabToLinearRgb(L, c * Math.cos(rad), c * Math.sin(rad));
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) break;
    c *= 0.92;
  }
  const [r, g, b] = rgb.map((v) =>
    Math.round(Math.min(1, Math.max(0, gammaEncode(Math.min(1, Math.max(0, v))))) * 255),
  );
  return `rgb(${r}, ${g}, ${b})`;
}

/** The ramp's hue (OKLCh degrees) at a score — exported for gradient builders. */
export function spectrumHue(score: number): number {
  return spectrumStop(score).hue;
}

/** Any point on the ramp at an arbitrary lightness — used for gradients/charts. */
export function spectrumColor(score: number, lightness: number, chromaScale = 1): string {
  const { hue, chroma } = spectrumStop(score);
  return oklchToCss(lightness, chroma * chromaScale, hue);
}

/** Pale badge background. */
export function spectrumFill(score: number): string {
  return spectrumColor(score, 0.92, 0.28);
}

/** Dark, legible number/text color on top of `spectrumFill`. */
export function spectrumNumber(score: number): string {
  return spectrumColor(score, 0.45, 0.95);
}

/** Mid-tone stroke/accent — the ramp's "true" color. */
export function spectrumRing(score: number): string {
  return spectrumColor(score, 0.63, 1);
}
