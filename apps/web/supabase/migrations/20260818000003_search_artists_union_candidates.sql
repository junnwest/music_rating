-- Follow-up to 20260818000000/20260818000001. Both applied cleanly and were individually
-- correct, but search_artists was STILL ~1.3s after both -- confirmed with a real EXPLAIN
-- ANALYZE this time (via the _debug_explain() helper from 20260818000002), not another guess.
--
-- What the plan actually showed: 4.39s of the 5.57s total was a Seq Scan on `artists` (all
-- 67,634 rows), with `Filter: (EXISTS(SubPlan 6) OR EXISTS(SubPlan 7))` -- the "has releases"
-- gate. That gate's own comment (20260728000000_search_hide_empty_artists.sql) claimed both
-- EXISTS probes are "index-backed... cheap despite running before the LIMIT" -- true for each
-- INDIVIDUAL invocation (both hit Index Only Scans), but Postgres chose this AND-clause as the
-- driving access path for the ENTIRE artists table, running it 67,634 + 44,811 times, and only
-- applied the now-properly-indexed text-match arms afterward as a Join Filter. The alias CTE fix
-- from 20260818000001 worked exactly as intended in isolation (SubPlan 8 in the plan: 9.3ms) --
-- it just never got the chance to matter, because the planner drove the scan from the OTHER
-- AND-clause instead.
--
-- Root issue: "has releases" is true for ~87% of artists (58,911 / 67,634 in the sampled plan),
-- so it's a bad candidate to drive a full-table scan by -- but a real search query's text-match
-- conditions are highly selective (typically single digits of matches). The WHERE-clause shape
-- (one big AND of two OR-groups) gives Postgres no way to know that without already having
-- scanned everything.
--
-- Fix: stop expressing this as one WHERE and hoping the planner picks the right side. Compute
-- the candidate set as a UNION of five independently-indexed single-condition queries (each one
-- now hits exactly one of the trgm indexes built across this and the prior two migrations), then
-- join that small candidate set back to `artists` and check "has releases" on THAT -- a handful
-- of Index Only Scan probes instead of tens of thousands.
--
-- ORDER BY is unchanged (still calls word_similarity() and a correlated alias EXISTS directly) --
-- confirmed by the same EXPLAIN that this part was never the expensive one; it only runs over
-- the LIMIT-sized final result.
--
-- USER: apply via SQL editor, then this session will re-check both timing AND the query plan
-- (via _debug_explain) before calling this done -- two "should be fixed" rounds already turned
-- out to be only partially true, so this one gets verified before being trusted.

CREATE OR REPLACE FUNCTION search_artists(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id            uuid,
  name          text,
  name_native   text,
  genres        text,
  popularity    int,
  cover_url     text,
  release_count bigint,
  aliases       text[]
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql),
  candidates AS (
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name_native) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name_phonetic_ko) LIKE '%' || nq.qn || '%'
    UNION
    SELECT al.artist_id AS id FROM artist_aliases al, nq
    WHERE nq.qn <> '' AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND nq.ql <% lower(a.name)
  )
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count,
         ARRAY(SELECT al.alias FROM artist_aliases al WHERE al.artist_id = a.id LIMIT 25) AS aliases
  FROM candidates c
  JOIN artists a ON a.id = c.id
  CROSS JOIN nq
  WHERE EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
     OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
  ORDER BY (
      CASE WHEN normalize_text(a.name) = nq.qn
             OR normalize_text(a.name_native) = nq.qn
             OR normalize_text(a.name_phonetic_ko) = nq.qn
             OR EXISTS (
                  SELECT 1 FROM artist_aliases al
                  WHERE al.artist_id = a.id AND normalize_text(al.alias) = nq.qn
                ) THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(a.name) LIKE nq.qn || '%' THEN 500 ELSE 0 END
    + CASE WHEN normalize_text(a.name_phonetic_ko) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(a.name)),
        coalesce(word_similarity(nq.ql, lower(a.name_native)), 0)
      ) * 1000
    + coalesce(a.popularity, 0)
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_artists(text, int) TO anon, authenticated, service_role;
