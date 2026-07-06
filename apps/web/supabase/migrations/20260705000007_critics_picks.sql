-- Critics' Picks surface (2026-07-05) — an HONEST, day-one-populated chart driven by real external
-- critic scores (RS500, Pitchfork, Mercury, Korean Music Awards, Weiv, IZM, Rhythmer, …), shown AS
-- critic signal (not user ratings). Ranked by critic breadth (how many distinct critics acclaimed it)
-- then average critic score. `p_scope` gives origin-scoped lists ("Korean Critics' Canon", etc.).
--
-- Uses only the CRITICAL sources (see scripts/data/external-score-sources.ts) — commercial/sales
-- awards are excluded. Safe to re-run.

CREATE OR REPLACE FUNCTION get_critics_picks(p_limit int DEFAULT 30, p_scope text DEFAULT NULL)
RETURNS TABLE(
  release_id uuid, title text, artist text, cover_url text, native_title text,
  critic_score numeric, critic_count bigint, sources text[]
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH crit AS (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, rg.primary_artist_id,
           ROUND(AVG(es.normalized_score)::numeric, 3) AS critic_score,
           COUNT(DISTINCT es.source)                    AS critic_count,
           ARRAY_AGG(DISTINCT es.source)                AS sources
    FROM external_scores es
    JOIN release_groups rg ON rg.mb_release_group_id = es.mb_release_group_id
    WHERE es.source IN (
      'rs500','pitchfork_perfect','mercury_prize','kr_masterpiece_100','weiv_aoty','izm_aoty',
      'rhythmer_hiphop','rhythmer_rnb','kha_rnb','kha_hiphop','kma_aoty','jp_mino_100')
      AND rg.cover_url IS NOT NULL
    GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, rg.primary_artist_id
  )
  SELECT c.id, c.title, c.artist_display, c.cover_url, c.native_title, c.critic_score, c.critic_count, c.sources
  FROM crit c
  LEFT JOIN artists a ON a.id = c.primary_artist_id
  WHERE p_scope IS NULL
     OR (p_scope = 'korean'   AND a.native_language = 'ko')
     OR (p_scope = 'japanese' AND a.native_language = 'ja')
     OR (p_scope = 'western'  AND (a.native_language IS NULL OR a.native_language NOT IN ('ko','ja')))
  ORDER BY c.critic_count DESC, c.critic_score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_critics_picks(int, text) TO anon, authenticated, service_role;
