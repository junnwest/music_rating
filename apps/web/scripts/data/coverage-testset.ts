/**
 * Ground-truth test set for the catalog coverage harness (scripts/verify-coverage.ts).
 *
 * These are ARTIST NAMES ONLY — the harness resolves each one against iTunes
 * (or Spotify) at runtime to pull that artist's real discography, then measures
 * how well our catalog matches it. We deliberately do NOT hardcode album titles
 * or MBIDs here: the whole point is to compare our catalog against what the
 * external platform (the same source real users' Spotify/Apple data comes from)
 * says the artist released — not against MusicBrainz, and not against a frozen
 * snapshot we curated ourselves.
 *
 * Composition mirrors the product's target audience (see the target-audience
 * memory): anti-commercial / underground listeners, Korean prestige = acclaim
 * not chart success, plus Western critical acclaim and Japanese scenes. A small
 * mainstream floor is included as a sanity check (these MUST match — if they
 * don't, the harness itself is broken, not the catalog). A few known
 * regression cases (name/title drift found in prior sessions) are tagged so we
 * can watch them specifically.
 *
 * `name` is the external-platform display name (what iTunes/Spotify return and
 * what a user's connected data would carry). Keep this list append-only and
 * reproducible so baseline-vs-after-pipeline comparisons stay meaningful.
 */

export interface TestArtist {
  name: string;
  scene: string;
  /** Optional: a note for known-problem cases so the report can call them out. */
  note?: string;
}

export const COVERAGE_TESTSET: TestArtist[] = [
  // ── Korean hip-hop / R&B (the core scene) ────────────────────────────────
  { name: 'YANGHONGWON', scene: 'kr-hiphop', note: 'regression: was stuck on old name "Young B"; "오보에"/"3 STEPS FORWARD" title drift' },
  { name: 'Simon Dominic', scene: 'kr-hiphop' },
  { name: 'ZICO', scene: 'kr-hiphop' },
  { name: 'Paloalto', scene: 'kr-hiphop' },
  { name: 'BewhY', scene: 'kr-hiphop' },
  { name: 'Nucksal', scene: 'kr-hiphop' },
  { name: 'Owen', scene: 'kr-hiphop' },
  { name: 'Blase', scene: 'kr-hiphop' },
  { name: 'Fisherman', scene: 'kr-hiphop' },
  { name: 'Huckleberry P', scene: 'kr-hiphop' },
  { name: 'Deepflow', scene: 'kr-hiphop' },
  { name: 'Xxx', scene: 'kr-hiphop', note: 'FRNK + Kim Ximya; edge case for short/ambiguous name' },

  // ── Korean indie / alternative / underground ─────────────────────────────
  { name: 'Silica Gel', scene: 'kr-indie' },
  { name: 'Se So Neon', scene: 'kr-indie' },
  { name: 'Hyukoh', scene: 'kr-indie' },
  { name: 'Jannabi', scene: 'kr-indie' },
  { name: 'ADOY', scene: 'kr-indie' },
  { name: 'wave to earth', scene: 'kr-indie' },
  { name: 'The Black Skirts', scene: 'kr-indie' },
  { name: 'Parannoul', scene: 'kr-indie', note: 'bedroom/shoegaze, notoriously thin metadata coverage' },
  { name: 'Asian Glow', scene: 'kr-indie' },

  // ── Minor / non-mainstream K-pop (keep, but should not dominate) ──────────
  { name: 'LE SSERAFIM', scene: 'kpop-minor' },
  { name: 'NewJeans', scene: 'kpop-minor' },
  { name: 'fromis_9', scene: 'kpop-minor' },

  // ── Japanese (city pop / indie / hip-hop) ────────────────────────────────
  { name: 'Fishmans', scene: 'jp' },
  { name: 'toe', scene: 'jp' },
  { name: 'Lamp', scene: 'jp' },
  { name: 'STUTS', scene: 'jp' },
  { name: 'Tatsuro Yamashita', scene: 'jp' },
  { name: 'Number Girl', scene: 'jp' },

  // ── Western critical acclaim / indie ─────────────────────────────────────
  { name: 'Fred again..', scene: 'west-electronic', note: 'regression: "USB" typed as compilation, excluded by album/ep RPC filter' },
  { name: 'black midi', scene: 'west-indie' },
  { name: 'Black Country, New Road', scene: 'west-indie' },
  { name: 'MJ Lenderman', scene: 'west-indie' },
  { name: 'Alex G', scene: 'west-indie' },
  { name: 'Yves Tumor', scene: 'west-experimental' },
  { name: 'JPEGMAFIA', scene: 'west-hiphop' },
  { name: 'billy woods', scene: 'west-hiphop' },
  { name: 'Geese', scene: 'west-indie' },
  { name: 'Caroline Polachek', scene: 'west-pop' },

  // ── Mainstream sanity floor (MUST match — a miss here means harness bug) ──
  { name: 'Radiohead', scene: 'floor' },
  { name: 'Kendrick Lamar', scene: 'floor' },
  { name: 'Taylor Swift', scene: 'floor' },
  { name: 'BTS', scene: 'floor' },
  { name: 'Tyler, The Creator', scene: 'floor' },
];
