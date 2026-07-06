-- Critic-affiliation view (2026-07-05) — powers critic-informed surfaces and expands the thin
-- Korean/Japanese critical pool via the "Artist Halo": an artist with ANY critically-acclaimed album
-- lends respected status to their whole album/EP discography (their other records are far more likely
-- to be worth surfacing than a random untagged album).
--
-- Buckets mirror scripts/data/external-score-sources.ts. Read-only view; safe to re-run.

CREATE OR REPLACE VIEW critic_affiliation AS
WITH crit AS (   -- release groups with a DIRECT critical external score
  SELECT DISTINCT rg.id AS rg_id, rg.primary_artist_id
  FROM external_scores es
  JOIN release_groups rg ON rg.mb_release_group_id = es.mb_release_group_id
  WHERE es.source IN (
    'rs500','pitchfork_perfect','mercury_prize','kr_masterpiece_100','weiv_aoty','izm_aoty',
    'rhythmer_hiphop','rhythmer_rnb','kha_rnb','kha_hiphop','kma_aoty','jp_mino_100')
),
crit_artists AS (   -- artists with ≥1 critically-acclaimed album (the halo source)
  SELECT DISTINCT primary_artist_id FROM crit WHERE primary_artist_id IS NOT NULL
),
comm AS (   -- release groups with a commercial (sales/fan-vote) score
  SELECT DISTINCT rg.id AS rg_id
  FROM external_scores es
  JOIN release_groups rg ON rg.mb_release_group_id = es.mb_release_group_id
  WHERE es.source IN ('golden_disc_bonsang','golden_disc_daesang','mama_aoty','mma_aoty','sma_album')
)
SELECT
  rg.id,
  rg.primary_artist_id,
  (rg.id IN (SELECT rg_id FROM crit))                       AS direct_critical,
  (rg.primary_artist_id IN (SELECT primary_artist_id FROM crit_artists)) AS halo_critical,
  (rg.id IN (SELECT rg_id FROM comm))                       AS commercial
FROM release_groups rg
WHERE rg.release_group_type IN ('album','ep');

-- Quick sanity summary (run manually):
--   SELECT count(*) FILTER (WHERE direct_critical) AS direct,
--          count(*) FILTER (WHERE halo_critical)   AS halo,
--          count(*) FILTER (WHERE commercial AND NOT direct_critical) AS commercial_only
--   FROM critic_affiliation;
