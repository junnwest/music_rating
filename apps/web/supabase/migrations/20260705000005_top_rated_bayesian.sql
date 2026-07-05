-- Make get_charts_top_rated robust (pre-launch bot population + real-user launch).
--
-- Before: ORDER BY AVG(score) with HAVING COUNT >= 1 — a single 5.0 rating tops the entire chart.
-- That's gameable by one bot OR one real user at launch. Fix: rank by a BAYESIAN average (pull the
-- mean toward the global prior until an album has enough ratings) and require a small floor of 3.
-- The displayed avg_score stays the honest raw average; only the HAVING + ORDER BY change.
--
-- Signature preserved from 20260703000004 (8 cols incl. native_title/artist_native for native-name
-- display) so CREATE OR REPLACE works without a DROP. Prior μ = 2.75 (matches SILLA_PRIOR in
-- lib/sillaScore.ts); damping C = 8 (~8 ratings before Bayesian ≈ true average). Safe to re-run.

CREATE OR REPLACE FUNCTION get_charts_top_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  HAVING COUNT(rt.id) >= 3
  -- Bayesian average: (C·μ + Σscore) / (C + n), C=8, μ=2.75
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_charts_top_rated(int, text, int, int) TO anon, authenticated, service_role;
