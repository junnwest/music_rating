-- Bot flag on profiles (pre-launch bot population, HANDOFF-WINDOWS.md item 1).
--
-- Added BEFORE creating any bot accounts so bots are always distinguishable from real users —
-- retrofitting an is-bot flag onto rows you can no longer tell apart is much worse. Keeps every
-- later option open: hide bots from get_suggested_users, exclude them from leaderboards once enough
-- real users exist, bulk-delete them post-launch, etc.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- Partial index — almost every row is a real user (is_bot=false), so a partial index on the bots
-- keeps "list/filter the bots" cheap without bloating the all-false majority.
CREATE INDEX IF NOT EXISTS idx_profiles_is_bot ON profiles (id) WHERE is_bot = true;
