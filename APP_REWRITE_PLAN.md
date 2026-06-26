# App Rewrite Plan — consume the renovated schema (downstream track)

The **consumer side** of the DB renovation: make the live web + iOS apps, and the DB
functions they call, use the new entity graph (`release_groups` / `releases` editions /
`recordings` / `release_tracks`) instead of the old flat `releases` / `tracks` / dropped
views. Runs **in parallel** with the data pipeline ([RENOVATION_PLAN.md](RENOVATION_PLAN.md)).

> **Status (2026-06-26):** not started. **The live app is currently broken against prod**
> (the migration dropped the views/columns it calls) — acceptable only because we're
> pre-launch (~friends/bots). This is the real launch-blocker.
> **Inventory below is from a grep of the current code** (web ≈ 30 app files; iOS = 9 Swift files).

---

## 0. Mapping cheat-sheet (old → new) — applies to BOTH apps

| Old | New |
|---|---|
| `ratings.release_id` (an edition) | `ratings.release_group_id` (the album concept) |
| `track_ratings.(release_id, track_position, track_title)` | `track_ratings.recording_id` |
| `pairwise_comparisons.(winner_release_id, loser_release_id)` | `(winner_id, loser_id)` → `release_groups` |
| `track_pairwise_comparisons.(winner/loser release_id + position)` | `(winner_id, loser_id)` → `recordings` |
| `reviews / list_items / mix_items / saved_releases / pinned_albums / ranking_votes / curated_releases . release_id` | `… . release_group_id` |
| `releases` as the album entity | **`release_groups`** is the rating/display target; `releases` = editions; songs = `recordings`+`release_tracks` |
| `tracks` table | `recordings` + `release_tracks` |
| `recommendable_releases` view | rebuilt on `release_groups` |
| `search_releases()` RPC | rebuilt over `release_groups` + `recordings` + `artist_aliases` |
| `get_charts_*` / taste / bayesian / silla RPCs | rebuilt vs `release_groups` (song charts vs `recordings`) |

**URL/routing change:** `/album/[mbid]` keyed on `releases.id` → **`release_group_id`**;
`/song/[trackId]` keyed on `tracks.id` → **`recordings.id`**. Every album/song link changes
(pre-launch, so no shared-link breakage to worry about).

**Known traps:** PostgREST embedded-join ambiguity (we hit PGRST201 before → use explicit FK
hints); the 1000-row default cap (paginate with `.range()`); rebuilt search needs the trigram/FTS
indexes (already created on the new tables in the renovation migration).

---

## 1. Workstream A — rebuild dropped DB objects (do FIRST; unblocks everything)
New migration(s) recreating, against `release_groups`/`recordings`:
- `recommendable_releases` view (home/discovery/recs source).
- `search_releases()` RPC — over `release_groups.title` + `release_groups.native_title` +
  `recordings.title` + `artist_aliases.alias_norm` (trigram + FTS).
- Charts: `get_charts_top_rated/most_rated/trending/trending_for_genres/hidden_gems/controversial`,
  `get_user_top_genres`, + the song-chart RPCs → keyed on `release_group_id` / `recording_id`.
- Taste/score: `get_user_genre_standings`, `get_calibrated_bayesian_scores`, `get_silla_rating_scores`.
- `ratings_count` denormalized counter + trigger, now on `release_groups`.
- **Re-seed leaderboard baselines** — `ranking_seed_entries` / `curated_releases` held old
  `release_id`s (now-deleted); re-seed against `release_group_id` or the lists are empty.

---

## 2. Workstream B — Web rewrite (Windows). ~30 files, grouped.

**B1. Catalog reads / discovery**
- `app/(main)/page.tsx`, `components/RecommendationGrid.tsx`, `app/api/recommendations/route.ts`,
  `app/api/personalized/route.ts`, `components/PersonalizedFeed.tsx`, `components/ExplorePage.tsx`,
  `app/(main)/explore/[id]/page.tsx`, `app/(main)/genre/[key]/page.tsx`
- `app/(main)/album/[mbid]/page.tsx` → load `release_group` + canonical edition's
  `release_tracks`→`recordings` (the biggest read rewrite)
- `app/(main)/song/[trackId]/page.tsx` → `recordings`
- `app/(main)/artist/[id]/page.tsx`
- Search: `app/api/search/route.ts`, `app/api/search/suggest/route.ts`, `lib/dbCache.ts`
  (`searchReleases`), the SearchBar consumers
- `lib/canon-suggestions.ts`, `lib/category-resolver.ts`

**B2. Rating read/write** (Manual + Instinct, album + song)
- `components/AddModal.tsx` (**~19 refs — largest single file**), `components/InlineStarRating.tsx`,
  `components/AlbumActions.tsx`
- `app/api/rate/compare/route.ts`, `app/api/rate/compare-song/route.ts`,
  `app/api/rate/seed-from-manual/route.ts` → key on `release_group_id` / `recording_id`; the
  Instinct opponent pool changes accordingly
- Profile/feed/stats over ratings: `components/ProfilePanel.tsx`, `app/api/activity/route.ts`,
  `app/api/reviews/route.ts`, `app/api/contradictions/route.ts`, `app/api/collisions/route.ts`,
  `app/api/wrapped/route.ts`, `lib/sillaScore.ts`, `lib/accomplishments.ts`

**B3. Collections / mixes / saved**
- `components/PlaylistContext.tsx` (~15 refs), `components/PlaylistPanel.tsx`,
  `app/(main)/collection/[id]/page.tsx`, `app/(main)/listen-later/page.tsx`

**B4. Rankings / leaderboards**
- `app/(main)/rankings/[slug]/page.tsx` (+`/rank`), `app/(main)/leaderboard/[slug]/page.tsx`
  (+`/rank`), `app/(main)/my-rankings/page.tsx` (+`/[slug]`), `components/RankBuilder.tsx`,
  `app/api/rankings/vote/route.ts`, `app/api/rankings/user-ranking/route.ts`,
  `app/api/admin/seed-votes/route.ts`, `app/api/admin/seed-curated/route.ts`

**B5. Misc**
- `app/api/daily-question/route.ts` (+`/answer`), `app/api/notifications/route.ts`,
  `app/api/genres/top/route.ts`, `app/(main)/settings/page.tsx`

---

## 3. Workstream C — iOS rewrite (Mac). 9 Swift files (~100 refs).
- **Models** (`Release` → release-group concept; track model → `recording`; new id fields/URLs).
- `AlbumDetailView.swift` (~23 — biggest) → release-group + `release_tracks`/`recordings`.
- `SearchView.swift` (~17, the Add tab) → new search; rating entry points.
- `RankingsView.swift` (~24, Charts) → rebuilt chart RPCs.
- `InstinctRatingView.swift` (~9) → comparisons on `release_group_id`/`recording_id`.
- `HomeView.swift` (feed), `ProfileView.swift`, `UserProfileView.swift`, `MixLibraryView.swift`,
  `TasteView.swift`.
- Rating writes throughout → `release_group_id` / `recording_id`.

---

## 4. Workstream D — rating re-link + re-seed (execution of RENOVATION_PLAN §7)
- Run the 97 album + 20 track rating re-link (old iTunes-id → ISRC → normalized title; manual
  fallback). Target ~100%.
- Re-seed leaderboard baselines (Workstream A) so charts aren't empty at launch.

---

## 5. Sequencing & device split
1. **A — rebuild SQL objects** (Windows). *Gates everything; do against the seed core once the
   pipeline has ingested it — you don't need the full catalog to develop.*
2. **B + C in parallel** — Windows does web (B), Mac does iOS (C). Do **B1 (reads) + B2 (rating)**
   first (the core loop), then B3/B4/B5.
3. **D — re-link + re-seed** once the curated core is in.
4. **Cutover** — deploy web + apply the A migrations **together**; ship iOS via TestFlight. Don't
   half-deploy (mixed old/new = breakage).

| Track | Owner |
|---|---|
| A (RPCs/views), B (web), D (re-link/re-seed) | **Windows** |
| C (iOS Swift) | **Mac** |

---

## 6. Risks
- **Mixed-state breakage** — old app code against new schema (or vice-versa) errors silently
  (PostgREST returns nulls swallowed by `try?` on iOS). Do A before B/C; cut over atomically.
- **PostgREST FK ambiguity** (PGRST201) — multiple join paths → use explicit FK hints (bit us
  before with `ratings`→`profiles`).
- **Search quality** — the rebuilt `search_releases` must cover native titles + aliases or
  Korean search regresses; validate against real queries.
- **Pagination** — the 1000-row default cap silently truncated backfills before; use `.range()`
  in every list query.
- **This is large** — ~30 web files + 9 Swift files + ~6 SQL objects. Treat B2 (AddModal, ~19
  refs) and C/`AlbumDetailView` (~23) as the heaviest items.
