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

/** Show the native value only when it's actually Hangul; else the Latin value. */
export function displayName(latin: string, native?: string | null): string {
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

// ── Score spectrum (mirrors iOS Components/ScoreBadge.swift) ────────────────
// Hue sweeps from red (0°) at score 0.5 to sjBlue's hue (~206°) at 5.0.
// CSS hsl() semantics — identical numbers to the Swift implementation.

const MAX_HUE = 205.7;

export function spectrumHue(score: number): number {
  return Math.min(Math.max((MAX_HUE * (score - 0.5)) / 4.5, 0), MAX_HUE);
}

export function spectrumFill(score: number): string {
  return `hsl(${spectrumHue(score)}, 65%, 89%)`;
}

export function spectrumNumber(score: number): string {
  return `hsl(${spectrumHue(score)}, 73%, 29%)`;
}

export function spectrumRing(score: number): string {
  return `hsl(${spectrumHue(score)}, 70%, 45%)`;
}
