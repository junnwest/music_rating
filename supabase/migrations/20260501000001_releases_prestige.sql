-- Add prestige score to releases table
-- 1 = Undisputed classic | 2 = Critically acclaimed | 3 = Notable | NULL = unscored
ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS prestige smallint CHECK (prestige IN (1, 2, 3));

CREATE INDEX IF NOT EXISTS idx_releases_prestige ON releases (prestige) WHERE prestige IS NOT NULL;
