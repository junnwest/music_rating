-- Taste profiles: per-user genre weights maintained incrementally by a ratings trigger,
-- plus a genre_vectors table holding the co-occurrence-derived genre embeddings
-- (built offline by scripts/build-genre-embeddings.ts — see that file for method/rationale).
--
-- Design notes:
--   * genre_weights jsonb = { "<tag>": {"w": <Σ(display_score − 3.0)>, "n": <rating count>} }.
--     Centering at 3.0 makes a "fine" album contribute nothing, loved albums positive, and
--     ≤1.5★ albums strongly negative — the recommendation reranker reads it directly, and
--     per-tag user averages for the Taste page are 3 + w/n.
--   * display score = manual `score` when present, else the Elo→score logistic mirrored
--     EXACTLY from lib/elo.ts eloToScore() (5 / (1 + 10^((1500−elo)/250)), rounded to 0.1).
--   * The trigger is deliberately tiny (one PK lookup + one row update per rating write —
--     microseconds on the Micro instance) and NEVER blocks a rating write: any error is
--     downgraded to a WARNING. A full recompute path exists in the backfill statement at
--     the bottom (re-runnable) and server code self-heals when rating_count drifts.
--   * All vector math (cosine similarity, clustering) happens in Node against the bundled
--     JSON artifact — Postgres only stores the weights. genre_vectors exists so future
--     RPC/iOS callers can read the same vectors without shipping the JSON.

BEGIN;

-- ── genre_vectors: one row per genre tag, embedding + support ─────────────────
CREATE TABLE IF NOT EXISTS genre_vectors (
  tag        text PRIMARY KEY,
  vec        real[] NOT NULL,
  support    int    NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE genre_vectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS genre_vectors_select ON genre_vectors;
CREATE POLICY genre_vectors_select ON genre_vectors FOR SELECT USING (true);
-- no INSERT/UPDATE policies: written only by the build script under the service role

-- ── user_taste_profiles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_taste_profiles (
  user_id       uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  genre_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating_count  int   NOT NULL DEFAULT 0,
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE user_taste_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_taste_profiles_select ON user_taste_profiles;
CREATE POLICY user_taste_profiles_select ON user_taste_profiles
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
-- no client write policies: maintained by the trigger below (SECURITY DEFINER)

-- ── display-score helper (mirror of lib/elo.ts eloToScore — keep in sync) ────
CREATE OR REPLACE FUNCTION _rating_display_score(p_score numeric, p_elo numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_score IS NOT NULL THEN p_score
    WHEN p_elo IS NOT NULL THEN
      round(LEAST(5.0, GREATEST(0.0,
        5.0 / (1 + power(10::numeric, (1500 - p_elo) / 250.0)))), 1)
    ELSE NULL
  END
$$;

-- ── incremental jsonb weight merge ────────────────────────────────────────────
-- Applies p_delta to weight "w" and p_dn to count "n" for every tag in p_genres,
-- bumps rating_count by p_rows. Tags whose n reaches 0 are pruned.
CREATE OR REPLACE FUNCTION _taste_apply(
  p_user uuid, p_genres text[], p_delta numeric, p_dn int, p_rows int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_taste_profiles (user_id) VALUES (p_user)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE user_taste_profiles SET
    genre_weights = CASE
      WHEN p_genres IS NULL OR cardinality(p_genres) = 0 THEN genre_weights
      ELSE COALESCE((
        SELECT jsonb_object_agg(m.tag, jsonb_build_object('w', round(m.w, 3), 'n', m.n))
        FROM (
          SELECT COALESCE(e.key, g.tag) AS tag,
                 COALESCE((e.value->>'w')::numeric, 0)
                   + CASE WHEN g.tag IS NOT NULL THEN p_delta ELSE 0 END AS w,
                 COALESCE((e.value->>'n')::int, 0)
                   + CASE WHEN g.tag IS NOT NULL THEN p_dn ELSE 0 END AS n
          FROM jsonb_each(genre_weights) e
          FULL OUTER JOIN unnest(p_genres) g(tag) ON e.key = g.tag
        ) m
        WHERE m.n > 0
      ), '{}'::jsonb)
    END,
    rating_count = GREATEST(0, rating_count + p_rows),
    updated_at   = now()
  WHERE user_id = p_user;
END
$$;

-- ── ratings trigger ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _taste_profile_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_genres text[];
  v_old numeric;
  v_new numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := _rating_display_score(NEW.score, NEW.elo_score);
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
    PERFORM _taste_apply(
      NEW.user_id,
      CASE WHEN v_new IS NULL THEN NULL ELSE v_genres END,
      COALESCE(v_new, 3.0) - 3.0, 1, 1
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old := _rating_display_score(OLD.score, OLD.elo_score);
    v_new := _rating_display_score(NEW.score, NEW.elo_score);

    IF OLD.release_group_id IS DISTINCT FROM NEW.release_group_id THEN
      -- treat as remove + add (rare; unique(user, rg) makes this an edge case)
      IF v_old IS NOT NULL THEN
        SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = OLD.release_group_id;
        PERFORM _taste_apply(OLD.user_id, v_genres, -(v_old - 3.0), -1, 0);
      END IF;
      IF v_new IS NOT NULL THEN
        SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
        PERFORM _taste_apply(NEW.user_id, v_genres, v_new - 3.0, 1, 0);
      END IF;
      RETURN NEW;
    END IF;

    IF v_old IS NULL AND v_new IS NULL THEN
      RETURN NEW; -- nothing scored either side
    END IF;
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
    IF v_old IS NULL THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, v_new - 3.0, 1, 0);
    ELSIF v_new IS NULL THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, -(v_old - 3.0), -1, 0);
    ELSIF v_old <> v_new THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, v_new - v_old, 0, 0);
    END IF;
    RETURN NEW;

  ELSE -- DELETE
    v_old := _rating_display_score(OLD.score, OLD.elo_score);
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = OLD.release_group_id;
    PERFORM _taste_apply(
      OLD.user_id,
      CASE WHEN v_old IS NULL THEN NULL ELSE v_genres END,
      -(COALESCE(v_old, 3.0) - 3.0), CASE WHEN v_old IS NULL THEN 0 ELSE -1 END, -1
    );
    RETURN OLD;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Never block a rating write over taste bookkeeping; the backfill below re-derives state.
  RAISE WARNING 'taste_profile_sync failed (op %, user %): %', TG_OP,
    COALESCE(NEW.user_id, OLD.user_id), SQLERRM;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_taste_profile_sync ON ratings;
CREATE TRIGGER trg_taste_profile_sync
AFTER INSERT OR UPDATE OR DELETE ON ratings
FOR EACH ROW EXECUTE FUNCTION _taste_profile_sync();

-- ── backfill for all existing raters (re-runnable: full overwrite per user) ──
INSERT INTO user_taste_profiles (user_id, genre_weights, rating_count, updated_at)
SELECT c.user_id, COALESCE(gw.weights, '{}'::jsonb), c.cnt, now()
FROM (SELECT user_id, count(*)::int AS cnt FROM ratings GROUP BY user_id) c
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(x.tag, jsonb_build_object('w', round(x.w, 3), 'n', x.n)) AS weights
  FROM (
    SELECT g.tag,
           sum(_rating_display_score(rt.score, rt.elo_score) - 3.0) AS w,
           count(*)::int AS n
    FROM ratings rt
    JOIN release_groups rg ON rg.id = rt.release_group_id
    CROSS JOIN LATERAL unnest(rg.genres) g(tag)
    WHERE rt.user_id = c.user_id
      AND _rating_display_score(rt.score, rt.elo_score) IS NOT NULL
      AND rg.genres IS NOT NULL
    GROUP BY g.tag
  ) x
) gw ON true
ON CONFLICT (user_id) DO UPDATE
  SET genre_weights = EXCLUDED.genre_weights,
      rating_count  = EXCLUDED.rating_count,
      updated_at    = now();

COMMIT;
