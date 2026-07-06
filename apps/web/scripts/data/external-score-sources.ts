/**
 * Classification of external_scores.source into taste buckets, for critic-informed surfaces.
 *
 * Refined per the 2026-07-05 multi-model review:
 *   • CRITICAL — critic-panel / webzine / artistic-merit awards. The serious-listener signal. Includes
 *     respected K-pop (e.g. Korean Music Awards nominees sit Aespa next to Jambinai/Silica Gel).
 *   • INSTITUTIONAL — industry/peer-voted prestige (Grammys, Brit). NOT sales, but a poor proxy for
 *     "minor taste" — treat as a WEAK positive, never a boost or a penalty.
 *   • COMMERCIAL — sales / streaming / fan-vote awards. Popularity, not critical merit. Use as a CAP
 *     (an album that's only here shouldn't score like a critic darling) — not an automatic low score,
 *     since some commercially-huge albums are also critically respected (see CRITICAL ∩ COMMERCIAL).
 *
 * jp_mino_100 is retained as critical-tentative — provenance (critic list vs listener/personal canon)
 * is unconfirmed; if it turns out listener-sourced, downgrade it. KHA is 70% critic / 30% netizen
 * (since 2023) → critical but slightly lower weight.
 */
export const CRITICAL_SOURCES = [
  'rs500', 'pitchfork_perfect', 'mercury_prize',           // Western critical / artistic-merit
  'kr_masterpiece_100', 'weiv_aoty', 'izm_aoty',           // Korean critic webzines / canon
  'rhythmer_hiphop', 'rhythmer_rnb', 'kha_rnb', 'kha_hiphop', // Korean hip-hop/R&B scene-critical
  'kma_aoty',                                              // Korean Music Awards (critic panel)
  'jp_mino_100',                                           // Japanese (critical-tentative)
] as const;

export const INSTITUTIONAL_SOURCES = [
  'grammy_aoty', 'grammy_rap', 'grammy_rnb', 'grammy_alternative',
  'grammy_rock', 'grammy_pop_vocal', 'grammy_dance_electronic',
  'brit_album',
] as const;

export const COMMERCIAL_SOURCES = [
  'golden_disc_bonsang', 'golden_disc_daesang',            // sales-weighted
  'mama_aoty', 'mma_aoty', 'sma_album',                    // fan-vote / streaming / popularity
] as const;

// Per-source weight when composing a critic signal (0..1). KHA slightly lower (netizen component);
// jp_mino_100 discounted for uncertain provenance. Institutional weak; commercial handled as a cap.
export const SOURCE_WEIGHT: Record<string, number> = {
  kma_aoty: 1.0, weiv_aoty: 1.0, izm_aoty: 0.95, kr_masterpiece_100: 1.0,
  rhythmer_hiphop: 0.9, rhythmer_rnb: 0.9, kha_hiphop: 0.8, kha_rnb: 0.8,
  mercury_prize: 1.0, pitchfork_perfect: 0.95, rs500: 0.9, jp_mino_100: 0.7,
};

const CRIT = new Set<string>(CRITICAL_SOURCES);
const INST = new Set<string>(INSTITUTIONAL_SOURCES);
const COMM = new Set<string>(COMMERCIAL_SOURCES);
export type SourceBucket = 'critical' | 'institutional' | 'commercial' | 'unknown';
export const bucketOf = (source: string): SourceBucket =>
  CRIT.has(source) ? 'critical' : INST.has(source) ? 'institutional' : COMM.has(source) ? 'commercial' : 'unknown';
