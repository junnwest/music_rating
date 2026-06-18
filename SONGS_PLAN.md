# Songs as first-class — plan (NOT started; design captured 2026-06-18)

Goal: make **songs** an equally large part of the app as albums — individual song pages, song ratings (same Manual + Instinct flow as albums), song sections on home, song templates in the feed, song search, etc.

> **Status:** design only. Decisions still open (see bottom). Affects **both web and iOS** (Mac is building iOS) — coordinate before building.

---

## Current state (important context)

- **Songs have no identity yet.** A release's tracks live in `releases.tracklist` as **JSONB** (`{ position, title, durationMs, artists }[]`), not as rows. There is no `tracks` table and no stable per-song ID/URL.
- **Per-track rating already partly exists:** `track_ratings` table (`user_id, release_id, track_position, track_title, score`) + an inline 14px star widget per track row. So song *rating* infra exists at the (release_id + position) grain — but no song *pages*, no Instinct for songs, no aggregation/search.
- Tracklist coverage is ~93% (107,778 of 115,604 non-single releases). Songs only exist where a tracklist is present.

---

## User-requested changes (2026-06-18)

i. **Album page tracklist → clickable.** Make each song **title** link to its song page; add a fast **"add"** button at the right end of each track row (opens the Add modal in song mode).
ii. **Home page:** two separate sections — **Albums** and **Songs**.
iii. **Feed:** two templates, one per type (album-rated vs song-rated events).
iv. (expansion — see "Additional changes" below)

## Additional changes this implies

- **Song detail page** (`/song/...`): cover (from parent release), title, artist(s), duration, the Add/Save buttons, community stats, comments, streaming buttons (per-track streaming already exists), "appears on" (parent release link).
- **Search:** add a Songs section (currently releases + artists only).
- **Rating storage for songs:** extend `track_ratings` with `elo_score`/`elo_games` (Instinct) — or a new table — mirroring what we did for albums on `ratings`.
- **Instinct for songs:** songs compared only against **other songs** (separate ranked list from albums). `pairwise_comparisons` needs a type discriminator or a parallel table.
- **Add modal (song mode):** the existing `AddModal` should accept a song target (bucket/stars → reveal list+comment → song-vs-song comparisons).
- **Profile:** a Songs rated grid/section; song stats; maybe song top-genres.
- **Leaderboards:** song leaderboards (user plans these to be **score-driven**, not manual tierlists).
- **Recommendable songs:** possibly a `recommendable_songs` view (parallel to `recommendable_releases`).
- **Catalog/data:** songs depend on tracklist JSONB; the 7% without tracklists have no songs. Song metadata (duration, artists) comes from the JSONB.
- **iOS parity:** song pages/ratings/feed must mirror on iOS.

---

## DECISIONS

**Resolved (2026-06-18):**
- **Album ↔ song scores: independent.** An album's score is its own thing, not derived from its track ratings (v1).
- **Instinct is per-type:** songs compare only with songs, albums only with albums → separate ranked lists + separate Elo.
- **Singles: no dedup, tune visibility instead.** Songs come from tracklists regardless of `release_type`, so a 1-track single naturally appears as **both** a release and a song — that's intended. Multi-track "singles" (single + instrumental, 2-track, etc.) contribute their tracks to the song world and the release to the album world. Instead of excluding singles, **fine-tune ranking so singles surface less** across home/feed/search.
  - ⚠️ Implementation note: today singles are **hard-excluded** from home/explore (`recommendable_releases` view = albums + EPs only). This decision means **relaxing that hard exclusion into a soft ranking penalty** — a real change to that view + the recommendation queries.
- **Cross-release song unification:** keep **per-release** songs for v1 (same song on a single + album + comp = separate songs). Unify later (hard dedup).

**Resolved (2026-06-18, cont.):**
- **Song identity: a real `tracks` table** (stable UUIDs). Built:
  - Migration `apps/web/supabase/migrations/20260618000000_tracks_table.sql` — `tracks(id, release_id→releases, position, title, duration_ms, artists)`, UNIQUE(release_id, position), RLS (public read), index on release_id. (GIN trigram on `title` deferred until song search is built.)
  - Backfill `apps/web/scripts/backfill-tracks.ts` (`npm run backfill:tracks` / `:dry`) — populates `tracks` from `releases.tracklist` JSONB. Resumable (state file + keyset pagination), idempotent (upsert on release_id,position). ~107k releases → ~1.3M rows, **run overnight**. Dry-run verified (50 releases → ~609 rows).
- **Song page URL scheme: `/song/[trackId]`** (uses the new UUID).

**Still open:** none blocking — proceed to song pages / ratings next session.

---

## Suggested phased build order (once decisions are locked)

1. Migration: `tracks` table (or chosen identity) + song rating columns; backfill from `tracklist` JSONB.
2. Song detail page + routing.
3. Album page tracklist: clickable titles + per-row quick "add" (AddModal song mode).
4. `AddModal` song mode + song Instinct (separate ranked list).
5. Home Songs section; search Songs section.
6. Feed song template; profile song section.
7. Song leaderboards (score-driven).
8. iOS parity pass.

---

## Related debt to clear alongside
- **Korean i18n** for the Add/Save modal (`AddModal.tsx`) and any new song UI — currently English-only. (User: implement Korean once the feature is built.)
