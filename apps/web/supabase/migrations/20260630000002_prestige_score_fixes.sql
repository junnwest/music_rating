-- prestige_score_fixes: three corrections to external_scores data quality.
--
-- Problem 1 — scope_country never set on seeded rows.
--   All KR-specific awards (Golden Disc, MAMA, MMA, SMA, IZM, Rhythmer, etc.)
--   had scope_country = NULL (global), so Korean pop acts dominated the global
--   leaderboard. This UPDATE scopes them to 'kr'.
--
-- Problem 2 — all source tiers were set to 3.
--   Grammy AOTY and Mercury Prize are globally Tier 1 prestige anchors; they
--   should outweigh genre-specific or regional sources.
--   Korean critical sources (IZM, KR Masterpiece, Rhythmer, WEIV) should outweigh
--   fan-voted commercial shows (MAMA, GD, MMA, SMA) within the KR filter.
--
-- Problem 3 — winner normalizedScore = 1.0 everywhere.
--   With one tier firing: prestige = 1.0×w/w = 1.0 for every single winner.
--   No album can rise above another; the formula cannot rank among winners.
--   Fix: lower winner scores so multi-source albums compound toward 1.0.
--   Winning Grammy AOTY alone → 0.82. Winning Grammy + Mercury → ~0.87.
--   3 independent Tier 1 sources → ~0.92+.

-- ── 1. Scope KR-only sources to kr ───────────────────────────────────────────

UPDATE external_scores
SET scope_country = 'kr'
WHERE source IN (
  'golden_disc_daesang',
  'golden_disc_bonsang',
  'mama_aoty',
  'mma_aoty',
  'sma_album',
  'kma_aoty',
  'kha_hiphop',
  'kha_rnb',
  'kr_masterpiece_100',
  'rhythmer_hiphop',
  'rhythmer_rnb',
  'izm_aoty',
  'weiv_aoty'
);

-- ── 2. Re-tier sources ────────────────────────────────────────────────────────

-- Globally prestigious (Tier 1 = weight 0.45)
UPDATE external_scores SET source_tier = 1
WHERE source IN ('grammy_aoty', 'mercury_prize');

-- Globally significant genre/era lists (Tier 2 = weight 0.30)
UPDATE external_scores SET source_tier = 2
WHERE source IN (
  'grammy_rap', 'grammy_rnb', 'grammy_rock',
  'grammy_alternative', 'grammy_pop_vocal', 'grammy_dance_electronic',
  'brit_album',
  'pitchfork_perfect', 'rs500'
);

-- Within KR scope: critical sources above commercial (Tier 1 within kr)
UPDATE external_scores SET source_tier = 1
WHERE source IN ('izm_aoty', 'kr_masterpiece_100');

-- Within KR scope: respected critic/industry sources (Tier 2 within kr)
UPDATE external_scores SET source_tier = 2
WHERE source IN ('rhythmer_hiphop', 'rhythmer_rnb', 'weiv_aoty', 'kha_hiphop', 'kha_rnb');

-- Within KR scope: commercial fan-voted shows (Tier 3 within kr)
UPDATE external_scores SET source_tier = 3
WHERE source IN (
  'golden_disc_daesang', 'golden_disc_bonsang',
  'mama_aoty', 'mma_aoty', 'sma_album', 'kma_aoty'
);

-- ── 3. Lower winner scores so multi-source albums differentiate ───────────────
--
-- Before: every award winner = 1.0 → prestige always 1.0, impossible to rank.
-- After:
--   Tier 1 winner  (Grammy AOTY, Mercury) → 0.82
--   Tier 2 winner  (genre Grammy, Brit)   → 0.72
--   Tier 3 winner  (KR commercial shows)  → 0.62
--   Tier 3 award_nomination               → 0.30  (unchanged in spirit)
--
-- IZM / KR Masterpiece / Rhythmer are list_rank / review_score — their
-- normalized_score is already computed from rank position; don't touch those.

UPDATE external_scores
SET normalized_score = 0.82
WHERE score_type = 'award_win'
  AND source_tier = 1
  AND normalized_score = 1.0;

UPDATE external_scores
SET normalized_score = 0.72
WHERE score_type = 'award_win'
  AND source_tier = 2
  AND normalized_score = 1.0;

UPDATE external_scores
SET normalized_score = 0.62
WHERE score_type = 'award_win'
  AND source_tier = 3
  AND normalized_score = 1.0;

-- Nominations: lower slightly to widen gap with wins
UPDATE external_scores
SET normalized_score = 0.28
WHERE score_type = 'award_nomination'
  AND normalized_score = 0.35;

-- ── 4. Reconcile so prestige_score on release_groups reflects new values ──────

SELECT reconcile_prestige_scores();
