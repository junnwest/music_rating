"""Reproduce the initial username blocklist migration from a pinned MIT list.

This generates the 20260927000002 migration only. Future policy changes need
new migrations so deployed databases receive the update.
"""

import json
import re
import urllib.request
from pathlib import Path


SOURCE_COMMIT = "c27924319aa9bd6f917e3782b4f4b6604a50b652"
SOURCE_URL = f"https://raw.githubusercontent.com/dsojevic/profanity-list/{SOURCE_COMMIT}/en.json"
OUTPUT = Path(__file__).resolve().parents[1] / "supabase/migrations/20260927000002_username_blocklist.sql"

# These are exact handles, including the seven requested reservations.
RESERVED = {
    "sillajuku", "sillajukukr", "rex", "blk", "linus", "linuskim", "aaa",
}

# The source's LGBTQ tag also contains ordinary identity words, so take only
# clear slurs from that category. A few racial entries are ordinary names or
# words in other languages and are excluded for the same reason.
SLURS = {"fag", "faggot", "tranny", "shemale", "bulldyke", "lesbo", "lezzie"}
RACIAL_EXCLUSIONS = {"hajji", "negro"}

# Common roots that the source encodes with repetition wildcards, plus clear
# sexual/profane terms that should also be caught inside a longer handle.
EMBEDDED = {
    "fuck", "shit", "pussy", "porn", "hentai", "blowjob", "cumshot",
    "bukkake", "masturbat", "penis", "vagina", "dildo", "orgasm",
    "sexcam", "sextoy", "hardcore", "onlyfans",
    "faggot", "nigger", "nigga", "tranny",
}

with urllib.request.urlopen(SOURCE_URL, timeout=20) as response:
    source = json.load(response)

terms = set(RESERVED | SLURS)
for entry in source:
    if not set(entry.get("tags", [])).intersection({"general", "sexual", "shock", "racial"}):
        continue
    if entry["id"] in RACIAL_EXCLUSIONS:
        continue
    for alternative in entry["match"].split("|"):
        # Asterisks in this source mean repeated preceding characters. The
        # simplest spelling is enough for the exact list; strong stems above
        # catch suffixes on the most recognizable terms.
        term = re.sub("[^a-z0-9]", "", alternative.lower())
        if 3 <= len(term) <= 20:
            terms.add(term)

terms.update(EMBEDDED)
assert RESERVED <= terms
assert SLURS <= terms
assert EMBEDDED <= terms

quoted_terms = ",\n".join(f"        '{term}'" for term in sorted(terms))
embedded_pattern = "|".join(sorted(EMBEDDED, key=lambda term: (-len(term), term)))

sql = f"""-- Username length already has a 20-character DB constraint. Keep it.
-- Source: dsojevic/profanity-list en.json at {SOURCE_COMMIT} (MIT).
-- Uses general, sexual, shock, and most racial tags; exact terms are normalized
-- to the username alphabet. Only clear slurs are taken from the LGBTQ tag;
-- religious terms are excluded. See the source
-- license in docs/username-blocklist.md.
-- Existing usernames are grandfathered: unrelated profile edits keep working.

CREATE OR REPLACE FUNCTION public.is_username_allowed(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $policy$
  WITH blocked(term) AS (
    SELECT unnest(ARRAY[
{quoted_terms}
    ]::text[])
  )
  SELECT candidate ~ '^[a-z0-9_]{{3,20}}$'
    AND NOT EXISTS (
      SELECT 1 FROM blocked
      WHERE term = replace(candidate, '_', '')
         OR term = ANY(string_to_array(candidate, '_'))
    )
    -- Only unambiguous roots are checked inside longer strings. Short terms
    -- such as "ass", "sex", and "cum" stay exact to avoid false positives.
    AND replace(candidate, '_', '') !~ '({embedded_pattern})';
$policy$;

CREATE OR REPLACE FUNCTION public.reject_blocked_username()
RETURNS trigger
LANGUAGE plpgsql
AS $policy$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.username IS NOT DISTINCT FROM OLD.username THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.username IS NOT NULL
     AND NOT public.is_username_allowed(NEW.username) THEN
    RAISE EXCEPTION 'Username is unavailable'
      USING ERRCODE = '23514', CONSTRAINT = 'username_allowed';
  END IF;
  RETURN NEW;
END;
$policy$;

CREATE TRIGGER reject_blocked_username
BEFORE INSERT OR UPDATE OF username ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.reject_blocked_username();
"""

OUTPUT.write_text(sql, encoding="utf-8")
print(f"Wrote {OUTPUT} with {len(terms)} exact blocked names and {len(EMBEDDED)} embedded roots")
