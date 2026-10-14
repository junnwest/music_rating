-- ════════════════════════════════════════════════════════════════════════════
-- Profile social links.  2026-10-13
-- ════════════════════════════════════════════════════════════════════════════
--
-- Lets a user list up to 5 outside links on their profile (YouTube channel,
-- Instagram, Spotify artist page, Twitch/CHZZK/SOOP channel, a website...),
-- mainly for creators. Stored as plain URLs; web (lib/socialLinks.ts) and iOS
-- (Models/SocialLinks.swift) infer the platform label from the host, so adding
-- a platform needs no migration.
--
-- The CHECK is the security boundary: clients render these as links, so only
-- http(s) is accepted (no javascript:, data:, etc.), with no whitespace and a
-- length cap. Additive and nullable: existing rows and old clients unaffected.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._sj_social_links_valid(links text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT links IS NULL OR (
    cardinality(links) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM unnest(links) AS u(url)
      WHERE url IS NULL
         OR length(url) > 300
         OR url !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$'
    )
  );
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS social_links text[];

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_social_links_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_social_links_check CHECK (public._sj_social_links_valid(social_links));

COMMIT;
