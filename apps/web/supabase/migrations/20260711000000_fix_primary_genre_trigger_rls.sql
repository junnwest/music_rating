-- Fix: every first-ever rating on a release_group without a precomputed primary_genre was
-- silently failing to write at all.
--
-- ROOT CAUSE: _sync_primary_genre() (20260706000020_primary_genre_trigger.sql) is an AFTER
-- INSERT trigger on `ratings` that does `INSERT INTO rg_primary_genre ...`. Trigger functions
-- run as the role that fired the triggering statement by default (SECURITY INVOKER) -- for a
-- client-side rating write that's the authenticated user, not a privileged role. rg_primary_genre
-- has RLS enabled with no authenticated-INSERT policy (it's a system-maintained derived/cache
-- table, not something end users write to directly), so the trigger's own insert was rejected
-- with 42501 ("new row violates row-level security policy for table rg_primary_genre") -- and
-- because a failed AFTER trigger rolls back its whole triggering statement, the ENTIRE rating
-- insert failed with it. Silent client-side (iOS's AlbumQuickRate.saveManualScore swallows the
-- error via `try?`), so this had zero visible symptom beyond "the rating just didn't save" --
-- confirmed live via direct instrumentation + a REST query proving no row was ever created for
-- two different first-time-rated release_groups.
--
-- Every other RLS-bypass in this codebase for exactly this "internal bookkeeping needs to write
-- past RLS" shape already uses SECURITY DEFINER (e.g. the four chart RPCs in
-- 20260706000001_primary_genre.sql) -- same fix here, plus a pinned search_path (standard
-- SECURITY DEFINER hardening against search_path hijacking).
CREATE OR REPLACE FUNCTION _sync_primary_genre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO rg_primary_genre (release_group_id, primary_genre)
  SELECT NEW.release_group_id, _compute_primary_genre(rg.genres)
  FROM release_groups rg
  WHERE rg.id = NEW.release_group_id AND rg.genres IS NOT NULL
  ON CONFLICT (release_group_id) DO NOTHING;
  RETURN NEW;
END;
$$;
