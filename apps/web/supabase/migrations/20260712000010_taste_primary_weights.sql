-- Primary-genre weighting for taste profiles: an album's PRIMARY genre tag
-- (scene-first precedence — same family table as _compute_primary_genre)
-- contributes full weight to the user's genre_weights; co-tags contribute 0.5.
-- So a [hip hop, k-pop, pop] album pulls k-pop hardest, matching how the tags
-- actually describe it.
--
-- Why not array position: MB's API returns genres ALPHABETICALLY and the
-- ingest discarded the vote counts (verified live 2026-07-12), so position is
-- meaningless on the 307k existing rows. mb-client.ts now sorts future
-- ingests by vote count, but precedence is the durable signal either way.
--
-- genre_weights value shape stays { "<tag>": {"w", "n"} } — both are now
-- weighted sums (n numeric, not int), so 3 + w/n stays a true weighted
-- average. Per-tag deltas are rounded to 3 dp at write time in BOTH
-- directions, so an insert followed by a delete restores the exact prior
-- state (the round-trip property the trigger tests rely on).
--
-- ⚠ THREE COPIES of the family table must stay in sync: this function,
-- lib/taste/primaryGenre.ts, and scripts/backfill-primary-genre.ts.

BEGIN;

-- ── which array element is the primary genre tag ─────────────────────────────
-- Modified copy of _compute_primary_genre: returns the matching ARRAY ELEMENT
-- (first tag, in array order, of the highest-precedence family present)
-- instead of the family's canonical store value; falls back to the first tag.
CREATE OR REPLACE FUNCTION _primary_genre_tag(p_genres text[])
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH g AS (
    SELECT x AS tag, ord,
           lower(regexp_replace(regexp_replace(replace(x, '&', ' and '), '-', ' ', 'g'), '\s+', ' ', 'g')) AS n
    FROM unnest(coalesce(p_genres, '{}'::text[])) WITH ORDINALITY AS t(x, ord)
  ),
  fam(ford, subs) AS (
    VALUES
      (1,  ARRAY['korean hip hop','k rap','korean rap']),
      (2,  ARRAY['korean r and b','k r and b','korean rnb']),
      (3,  ARRAY['korean indie','k indie']),
      (4,  ARRAY['korean folk','k folk']),
      (5,  ARRAY['korean ballad','k ballad']),
      (6,  ARRAY['k pop','korean pop']),
      (7,  ARRAY['city pop']),
      (8,  ARRAY['j rock','japanese rock','visual kei']),
      (9,  ARRAY['j pop','japanese pop']),
      (10, ARRAY['shoegaze','dream pop']),
      (11, ARRAY['math rock']),
      (12, ARRAY['post rock']),
      (13, ARRAY['indie rock']),
      (14, ARRAY['indie pop','bedroom pop']),
      (15, ARRAY['alternative','alt rock']),
      (16, ARRAY['metal']),
      (17, ARRAY['punk']),
      (18, ARRAY['classic rock','hard rock','psychedelic rock','prog rock','progressive rock']),
      (19, ARRAY['jazz']),
      (20, ARRAY['funk','disco']),
      (21, ARRAY['r and b','rnb','neo soul','soul']),
      (22, ARRAY['hip hop','rap','trap']),
      (23, ARRAY['electronic','house','techno','edm','idm','electro','synth pop','synthpop']),
      (24, ARRAY['ambient','lo fi','lofi']),
      (25, ARRAY['folk','singer songwriter','americana']),
      (26, ARRAY['classical','orchestral','baroque']),
      (27, ARRAY['country']),
      (28, ARRAY['bossa nova']),
      (29, ARRAY['afrobeat']),
      (30, ARRAY['rock']),
      (31, ARRAY['pop'])
  ),
  matched AS (
    SELECT g.tag
    FROM g
    JOIN fam f ON EXISTS (SELECT 1 FROM unnest(f.subs) s WHERE g.n LIKE '%' || s || '%')
    ORDER BY f.ford, g.ord
    LIMIT 1
  )
  SELECT COALESCE((SELECT tag FROM matched), p_genres[1])
$$;

-- ── weighted incremental merge (replaces the uniform-weight version) ─────────
CREATE OR REPLACE FUNCTION _taste_apply(
  p_user uuid, p_genres text[], p_delta numeric, p_dn int, p_rows int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- computed once per call, not once per tag (the function is a CTE over a
  -- 31-row VALUES table — cheap alone, expensive when multiplied)
  v_ptag text := _primary_genre_tag(p_genres);
BEGIN
  INSERT INTO user_taste_profiles (user_id) VALUES (p_user)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE user_taste_profiles SET
    genre_weights = CASE
      WHEN p_genres IS NULL OR cardinality(p_genres) = 0 THEN genre_weights
      ELSE COALESCE((
        SELECT jsonb_object_agg(m.tag, jsonb_build_object('w', round(m.w, 3), 'n', round(m.n, 3)))
        FROM (
          SELECT COALESCE(e.key, g.tag) AS tag,
                 COALESCE((e.value->>'w')::numeric, 0)
                   + CASE WHEN g.tag IS NOT NULL THEN round(p_delta * g.wt, 3) ELSE 0 END AS w,
                 COALESCE((e.value->>'n')::numeric, 0)
                   + CASE WHEN g.tag IS NOT NULL THEN round(p_dn * g.wt, 3) ELSE 0 END AS n
          FROM jsonb_each(genre_weights) e
          FULL OUTER JOIN (
            SELECT t.tag,
                   CASE WHEN t.tag = v_ptag THEN 1.0 ELSE 0.5 END AS wt
            FROM unnest(p_genres) t(tag)
          ) g ON e.key = g.tag
        ) m
        WHERE m.n > 0
      ), '{}'::jsonb)
    END,
    rating_count = GREATEST(0, rating_count + p_rows),
    updated_at   = now()
  WHERE user_id = p_user;
END
$$;

-- (trigger function _taste_profile_sync is unchanged — it feeds _taste_apply)

-- ── re-backfill all profiles under the new weighting (full overwrite) ────────
-- _primary_genre_tag is evaluated ONCE per distinct rated album (few thousand
-- calls), not per rating×tag — the per-tag version hit the statement timeout.
-- MATERIALIZED is load-bearing: a single-reference CTE gets inlined (PG12+),
-- which re-evaluates the function per joined rating×tag row and times out.
WITH prim AS MATERIALIZED (
  SELECT rg.id, rg.genres, _primary_genre_tag(rg.genres) AS ptag
  FROM (
    SELECT DISTINCT rt.release_group_id FROM ratings rt
  ) rated
  JOIN release_groups rg ON rg.id = rated.release_group_id
  WHERE rg.genres IS NOT NULL
),
per_user AS (
  SELECT rt.user_id, g.tag,
         sum(round((_rating_display_score(rt.score, rt.elo_score) - 3.0)
             * CASE WHEN g.tag = p.ptag THEN 1.0 ELSE 0.5 END, 3)) AS w,
         sum(CASE WHEN g.tag = p.ptag THEN 1.0 ELSE 0.5 END) AS n
  FROM ratings rt
  JOIN prim p ON p.id = rt.release_group_id
  CROSS JOIN LATERAL unnest(p.genres) g(tag)
  WHERE _rating_display_score(rt.score, rt.elo_score) IS NOT NULL
  GROUP BY rt.user_id, g.tag
),
agg AS (
  SELECT user_id,
         jsonb_object_agg(tag, jsonb_build_object('w', round(w, 3), 'n', round(n, 3))) AS weights
  FROM per_user
  GROUP BY user_id
)
INSERT INTO user_taste_profiles (user_id, genre_weights, rating_count, updated_at)
SELECT c.user_id, COALESCE(agg.weights, '{}'::jsonb), c.cnt, now()
FROM (SELECT user_id, count(*)::int AS cnt FROM ratings GROUP BY user_id) c
LEFT JOIN agg ON agg.user_id = c.user_id
ON CONFLICT (user_id) DO UPDATE
  SET genre_weights = EXCLUDED.genre_weights,
      rating_count  = EXCLUDED.rating_count,
      updated_at    = now();

COMMIT;
