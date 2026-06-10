# Session history

Historical record of shipped features and session notes. Not needed at conversation start — only useful for tracing why something was built a certain way.

---

## Shipped features

### Core

- [x] Album search (Spotify)
- [x] Album detail page (tracklist, community stats, ratings, comments)
- [x] Artist page with discography
- [x] Star rating widget (1–5, half-star steps; click same star to clear)
- [x] Comments (renamed from reviews) — visibility control (public / friends / private), commenter's star rating shown, likes, live username resolution from `profiles`
- [x] Homepage genre rows (DB-first, Spotify fallback)
- [x] For You page (personalized album feed)
- [x] Activity feed — community ratings + comments; filters to followed users when logged in
- [x] Lists (create, view)
- [x] Profile page (ratings grid, score distribution, sidebar-left layout; real comment count in stats)
- [x] Rating Philosophy / Insights (profile sidebar card)
- [x] Taste DNA badges in profile header (genre + behavior tags)
- [x] Top Genres (profile sidebar card)
- [x] Monthly Capsule (profile sidebar card)
- [x] Avg Score card (profile sidebar)
- [x] Essentials — 6-album pyramid, pick from rated catalog, drag-to-reorder, swap picker
- [x] Shelf Creation — Lists tab on profile
- [x] Onboarding modal — 3-step: profile setup → genres → Essentials (pick up to 6 albums)
- [x] DB caching layer — albums + artists saved to Supabase on first visit
- [x] Genre storage on ratings
- [x] Add button on album page — dropdown with Listen Later, Essentials, Add to Ranking
- [x] Listen Later page (`/listen-later`) — saved albums grid
- [x] Settings page — 5-tab settings (Account, Preferences, Notifications, Privacy, Danger Zone)
- [x] Help page — FAQ accordion + contact form
- [x] Notifications page — real data (new followers + friend ratings via `/api/notifications`)
- [x] Friends page — real Supabase follows (Following / Followers / Discover tabs)
- [x] Search page — mobile header transforms to search overlay on icon tap; landing state with no duplicate bar
- [x] Streaming buttons (Spotify / YouTube Music / Tidal) — album hero + per-track; uses stored spotifyUrl when available
- [x] Track star ratings — inline 14px star widget per track; writes to `track_ratings` table (migration in `supabase/migrations/20260526000000_track_ratings.sql` — apply manually)
- [x] Inline star ratings — compact widget on Explore cards, rankings leaderboard ("Your Rating" column), ranking builder suggestions
- [x] My Rankings (`/my-rankings`) — dashboard with ranking cards (All, Albums, EPs, Songs, per-genre) + "Recommended for You"; detail pages at `/my-rankings/[slug]`
- [x] Add to List modal — AlbumActions dropdown opens user's playlists with toggle membership (add/remove album from any list inline)
- [x] Listen Later bookmark button — inline on each Explore card next to the star rating widget
- [x] Activity page two-column layout — RecommendedFeed sidebar (sticky, lg+ screens) alongside the feed
- [x] RankBuilder auto-populate — fills tiers from user's rated albums by score band (5★→T1, 4–4.5★→T2, 3–3.5★→T3, 2–2.5★→T4); respects filterYear

### Social

- [x] Following system — follow/unfollow, follower/following counts, public `/profile/[username]` pages
- [x] Friend Taste Collisions — `/collisions`: albums rated ≥1.5★ apart from followed users
- [x] Taste Contradictions — `/contradictions`: your score vs community avg, split higher/lower

### Rankings

- [x] Community rankings page — leaderboards with seed + real vote merging
- [x] Individual ranking page — top 10, vote counts, "Build your ranking" button
- [x] Ranking personalization — filter tabs (All / To Vote / Friends Active)
- [x] Filter Builder — country-aware genre dropdowns; vote status indicator + Vote/Change Vote button
- [x] Rank Builder — `/rankings/[slug]/rank`: personal tiered ranking per category, drag-and-drop, ties supported
- [x] Ranking seed infrastructure — `ranking_seed_entries` table; admin endpoint + `scripts/seed-rankings.ts`
- [x] 6 curated ranking categories: Greatest Album of All Time · Best Hip-Hop All Time · Best K-Pop All Time · Best Album of 2025 · Best Korean Album All Time · Best K-Hip-Hop All Time
- [x] Rolling Stone 500 baseline seeds — 467/500 seeded into "all-time"
- [x] Hip-hop seed — 59/63 RS500 hip-hop albums seeded into "hiphop-all-time"
- [x] K-Pop seed — 29/30 albums seeded into kpop-all-time
- [x] Korean all-time seed — done
- [x] K-Hip-Hop all-time seed — done
- [x] Best Album of 2025 seed — done
- [x] Seed script CASCADE DELETE bug fixed — admin endpoint now uses upsert
- [x] Rankings leaderboard pagination — 10 per page, ellipsis page numbers, jump-to-page input
- [x] Silla score color — amber (#E8A020)
- [x] Ranking leaderboard rows — clickable links to album pages
- [x] Rankings page thumbnails — fixed to use actual Silla Score formula
- [x] Album page "In Rankings" — shows each ranking the album appears in with its rank number
- [x] Add to Ranking modal — checkmark on categories user has already ranked; refreshes on every open
- [x] Album page hero overflow fix — `overflow-hidden` moved to inner background layer

### Profile + settings (2026-05-07)

- [x] Settings page — username/display name/bio correctly saved to DB and reflected on profile
- [x] Profile page — username + bio read from `profiles` table; removed auto-upsert overwriting username on every visit
- [x] Navbar dropdown — username and display name from `profiles` table
- [x] `[username]/page.tsx` — removed `targetUsername` prop that was overriding DB-fetched username
- [x] Homepage — removed "Good morning / Here's what's waiting" greeting for logged-in users

### UI polish (2026-05-08)

- [x] Essentials — layout: 1×6 horizontal strip; fixed 96px items; "Essentials" label above strip
- [x] Monthly Capsule — score format: clean text (e.g. "LILAC — 5") instead of mint badge pill
- [x] Profile sidebar — Insights card removed; replaced by planned Insights + History page (post-launch)
- [x] Album page — "avg/5" → "avg"; Add button consolidated into dropdown; star rating text removed
- [x] Comments — visibility dropdown with icons; commenter's star rating shown; comment likes; profile link
- [x] Essentials — swap modal with pyramid layout; ★5 confirmation flow
- [x] Add to Ranking popup — Top 6 list + Browse Rankings filter (Country / Genre / Time dropdowns)
- [x] Search page — mobile header search overlay; landing empty state

### Auth + signup (2026-05-14)

- [x] Password reset flow — forgot mode in AuthForm → email link → `/auth/callback?next=/reset-password` → `/reset-password` page
- [x] Auth page redesign — no navbar; logo centered at top
- [x] Signup: username field removed (collected in onboarding)
- [x] Signup: duplicate email detection — `identities.length === 0` check
- [x] Signup: cross-tab confirmation — `onAuthStateChange` auto-redirects on email confirm
- [x] OG / social preview — `app/opengraph-image.tsx` + root metadata og + twitter card tags

### Dark mode + annual (2026-05-16)

- [x] Dark mode — CSS variables (RGB channel values) in `globals.css` + `tailwind.config.ts`; next-themes `ThemeProvider`; Light/System/Dark toggle in Settings
- [x] Logo: text-only (`public/logo-text.svg`) on navbar with `dark:invert`; flower mark on footer; navbar height 58px
- [x] Wrapped page — yearly summary: albums rated, top genre, top artist, avg score, active month, best/worst album

### Week 2 functional gaps (2026-05-17 area)

- [x] Password reset flow
- [x] Email verification on signup — check-inbox screen, resend button (60s cooldown), redirect to /onboarding
- [x] Onboarding polish
- [x] Transactional email setup — Resend configured with sillajuku.com domain; custom SMTP active in Supabase
- [x] Email template design — confirmation, recovery, change-email templates (paste into Supabase Auth → Email Templates)
- [x] Change email — Settings → Account tab; `supabase.auth.updateUser` flow
- [x] Notification read state — persisted in DB via `notifications_last_seen_at` on profiles
- [x] Username login — login accepts email or username; resolves via `/api/auth/resolve-username`
- [x] Confirm password on signup — second password field with mismatch validation
- [x] Mock notifications removed

### Security (Week 4, 2026-05-18)

- [x] Auth checks on all mutation API routes via `lib/authGuard.ts` JWT verification; 403 on mismatch
- [x] `/api/auth/resolve-username` converted from GET → POST
- [x] Security headers in `next.config.mjs`: CSP, `X-Frame-Options: DENY`, HSTS, Referrer-Policy, Permissions-Policy
- [x] Image remote patterns: explicit whitelist (`i.scdn.co`, `*.scdn.co`, `*.supabase.co`, `coverartarchive.org`)
- [x] DB indexes migration: `ratings(release_id)`, `reviews(release_id)`, `follows(following_id)`, `user_rankings(category_id)`, `user_ranking_entries(release_id)`; GIN full-text search on `releases(title, artist)`

### Branding (2026-05-18)

- [x] Accent color: cyan/mint → amber (#E8A020) across all UI surfaces
- [x] Score badges on album thumbnails → periwinkle blue (#5170ad)
- [x] Score display: always one decimal place (`toFixed(1)`)
- [x] Tagline: "Every record you've loved." — OG image, footer, metadata
- [x] Homepage headline: "Your taste documented."
- [x] Copy/voice audit: 17 en.ts strings + 6 hardcoded strings; 9 ko.ts strings retranslated
- [x] Flower mark (Asset 20): replaced `public/logo-flower.svg` + `public/logo.svg`
- [x] Auth form value-prop card removed

### Analytics + OAuth (Week 3)

- [x] Spotify login — Supabase OAuth provider; "Continue with Spotify" button
- [x] Privacy policy + Terms of Service finalized
- [x] Analytics setup — PostHog (US region); pageview + autocapture via `PostHogProvider`
- [x] OAuth buttons redesign — Google, Spotify, KakaoTalk, Apple as square icon buttons; KakaoTalk + Apple show "coming soon"
- [x] Connected accounts — Settings → Account; connect/disconnect Google + Spotify; safeguard requires ≥1 social account

---

## Session summaries

**2026-06-09/10 — `backfill:embeddings` resumed + nearly complete:**

- **Found backfill incomplete** — overnight run was interrupted by computer shutdown. Dry-run confirmed 93,090 releases still needed embeddings at session start.
- **First resume run** — 2,048 rows embedded before hitting a Supabase statement timeout (`canceling statement due to statement timeout`). Script is resumable; re-ran immediately.
- **Second resume run** — 92,151 embedded, 66 failed. One Jina API batch failed early (page counter incremented to 2, skipping those 64 rows + 2 DB update errors = 66 total). Those 66 rows still have `embedding IS NULL`.
- **Next session:** run `npm run backfill:embeddings` once more (should finish in under a minute — only 66 rows), then rebuild the HNSW index in Supabase SQL editor (step 14 SQL is in the README START HERE checklist).

---

**2026-06-04/07 — post-ingest pipeline: discover → ingest loop + genre enrichment:**

- **discover → ingest loop complete** — 4 discover runs + 6 ingest runs; catalog grew from 299k → ~347k releases. Final cycle: run 4 discover (0 new, queue empty), confirming stability.
  - Ingest run 3: 335 inserted / Run 4: 126 (converged) / Run 5: 33,331 (from 1,381 discovered artists) / Run 6: 13,730 (381 remaining)
  - Discover run 2: 2,143 queued from 122 artists / Run 3: 0 new (all 917 done, 381 pending) / Run 4: 0 new, queue empty
- **`enrich:genres:lastfm` complete (2026-06-07)** — 15,460 releases enriched with Last.fm tags; 5,511 already fully covered; 325,979 had no Last.fm match (practical ceiling — obscure/non-English catalog). Genre coverage is now stable.
- **Next session:** `npm run backfill:embeddings` — Jina v3 embeddings on the full ~347k catalog for hybrid semantic search.

---

**2026-06-03/04 — queue:ingest run 2 completion + post-ingest fixes + dedup bug recovery:**

- **`queue:ingest` run 2 complete** — all 9 batches done. Final catalog: **299,468 releases** (294,586 iTunes, 944 Spotify, 3,938 legacy); 0 missing covers; 0 duplicate itunes_ids; 1,013 null genres; 1 stuck `processing` entry.
- **Sanity check script** — `sanity-check.ts` created (`npm run sanity`): verifies required fields, release type distribution, date formats, genre coverage, native names, duplicate itunes_ids, queue state, artist coverage, and cover URL validity.
- **Collab artist cleanup** — `cleanup-collab-artists.ts` created (`npm run cleanup:collabs`). Deletes Last.fm collab nodes ("Drake feat. 21 Savage", "Coldplay & BTS") from `artist_ingestion_queue` and `artists`. Whitelist of 24 legitimate `&` acts maintained. Run result: **303 queue entries deleted, 2 artists table entries deleted**. Same `isCollaborationArtist()` filter added to `discover-lastfm-similar.ts` and `ingest-itunes-queue.ts` so future runs don't re-queue collabs.
- **`ingest-itunes-queue.ts` fix: `itunes_artist_id` propagation** — was only propagating `name_native` back to `artists` table; now also writes `itunes_artist_id`. `check:completeness` reads `artist_ingestion_queue` IDs, but the `artists.itunes_artist_id` column was always null. Fixed.
- **`ingest-itunes-queue.ts` fix: `.maybeSingle()` → `.limit(1)`** — `maybeSingle()` returns null data (not the row) when >1 rows match, causing the duplicate check to silently pass and insert again. Fixed to `.limit(1)`.
- **Buggy dedup run + recovery** — `dedup:releases:fix` was run post-ingest but `loadAllReleases` paginated without `ORDER BY`. Supabase's default sort is non-deterministic: pages can overlap, so the same release appeared twice in different fetches. `findGroups()` saw a release paired with itself → treated as a duplicate pair → `mergeAndDelete()` deleted the actual release. **93 releases self-matched and "deleted" across groups 1–93.** Recovery scripts built and run:
  - `requeue-affected.ts` — re-queued 18 entries (SF9 and Na Hoon-a had two queue rows each with different capitalisation).
  - `insert-missing-artists.ts` — adds KozyPop, Lee Seung Hwan, Moon Hee Jun directly to queue (original Spotify-sourced artists with no queue entries).
  - `find-and-requeue.ts` — one-shot utility used during investigation to reset specific artists.
  - **Recovery ingest result (2026-06-04): 0 new, 100 enriched, 819 skipped — confirmed 0 data loss.** The buggy dedup merged each release with *itself*, so the kept row was the same `itunes_id`; ingest correctly skips it as already present. The 100 enrichments (74 for Eminem) recovered missing metadata on releases that were left with incomplete data after the self-merge.
- **`find-duplicate-releases.ts` bug fixes**:
  - Added `.order('id')` to the pagination query — eliminates the overlap that caused self-matches.
  - Fixed `norm()` to use `\p{L}\p{N}` (Unicode-aware flag `u`) instead of explicitly listing character ranges. Without this, Cyrillic-titled releases like "Душа - EP" and "Сон - EP" both stripped to `"ep"` and triggered false matches.
  - Added K-FLIP+ (`274d9b4a…` / `f5e45ca3…`) to `SKIP_IDS` — the `+` in the title is stripped by `norm()`, causing it to match K-FLIP standard edition.
- **`fix-collab-artist-id.ts`** — new script (`npm run fix:collab-artist-ids`) for collab releases (e.g. "Sik-K & Lil Moshpit") with null `artist_id`. Finds the primary artist (name before `&`/`,`), looks it up in the `artists` table, and sets `artist_id` on the release.
- **`check-release.ts`** — lightweight lookup utility: `npx tsx --env-file=.env.local scripts/check-release.ts "term"` prints id, type, date, tracks, spotify_id, itunes_id for matching releases. Used for investigation during the dedup incident.
- **`dbCache.ts` `getArtistReleases`** — previously: FK lookup, fall back to name-exact when empty. Now: always run both FK lookup and `%name%` ilike, merge+deduplicate by id, sort by release_date desc. Effect: collaborative releases like "Sik-K & Lil Moshpit" now appear on **both** artists' discography pages.
- **New npm scripts** — `sanity`, `cleanup:collabs`, `cleanup:collabs:fix`, `fix:collab-artist-ids`, `fix:collab-artist-ids:fix`.
- **Migration `20260601000000_fix_partial_dates.sql`** — created (pads year-only dates "2020" → "2020-01-01"); **not yet applied**. Apply via Supabase SQL editor.

### Post-ingest-run-2 progress (2026-06-04):
1. ✅ `20260601000000_fix_partial_dates.sql` applied via Supabase SQL editor
2. ✅ Stuck queue entry reset (`status='done'`)
3. ✅ Recovery ingest: 0 new, 100 enriched, 819 skipped — 0 data loss
4. ✅ `dedup:releases:fix` re-run: **16 high-confidence merged, 112 low-confidence skipped**
5. ✅ `dedup:releases:fix-all`: **~111 more groups merged**. Miles Tones/Milestones and 1945 해방 correctly excluded via SKIP_IDS. Two false positives merged before SKIP_IDS were added: LOONA [#] vs [+ +] (different EPs, both normalize to "ep"); Mars EP (6 tracks) vs Album (41 tracks). Both user=0, no user data lost. Both added to SKIP_IDS for future runs.
5. ✅ `check:completeness` (post-run-2): 5,569 complete, 2,428 incomplete, 549 no iTunes — **6,937 missing releases re-queued**
6. ✅ `queue:ingest` (runs 3+4) — converged (2026-06-04): run 3: 335 ins / run 4: 126 ins — queue stable
7. ✅ `queue:discover` (run 2, 2026-06-04) — 122 artists processed, 2,143 queued, 10 no match, 1,381 pending
8. ✅ `queue:ingest` (run 5, 2026-06-04) — **33,331 inserted**, 2,581 enriched, 2,999 skipped, 31 no match, 0 failed
9. ✅ `queue:discover` (run 3, 2026-06-04) — 0 new (all 917 DB artists already done); 381 still pending in queue
10. ✅ `queue:ingest` (run 6, 2026-06-04) — **13,730 inserted**, 1,299 enriched, 1,400 skipped, 8 no match, 0 failed
11. ✅ `queue:discover` (run 4, 2026-06-04) — 0 new; queue empty (pending: 0) — **loop stable**
12. ✅ `enrich:genres:lastfm` (2026-06-07) — **15,460 enriched**, 5,511 already covered, 325,979 no Last.fm match — genre coverage at practical ceiling
13. 🔲 `backfill:embeddings` — final pipeline step (next session)
8. ⬜ repeat discover → ingest until queue stable
9. ⬜ `enrich:genres:lastfm` — recover null genres
10. ⬜ `backfill:embeddings` — final step

---

**2026-05-31 (later, session crashed) — Search quality fixes + rate limiting:**

- **Cross-language artist lookup** — `search_releases()` SQL function now LEFT JOINs `artists` table so a query like "IU" matches releases stored as "아이유" via `artist_id`. Previously those releases were invisible to search. Migration: `20260531000000_search_artist_crosslang.sql`.
- **Semantic candidate flood removed** — removed `(query_embedding IS NOT NULL AND embedding IS NOT NULL)` from the WHERE clause so the cosine similarity term only boosts scores for lexically-matched candidates, not all 9,200 embedded releases. Prevents semantic noise flooding results on every query.
- **Exact/prefix artist priority over popularity** — `searchReleasesInDb` in `lib/dbCache.ts` now over-fetches 4× candidates, applies +1,000,000 bonus for exact artist name match and +100,000 for prefix match, then slices to `limit`. Prevents high-DB-popularity artifacts like "Iuiu Hq" from outranking "IU".
- **`word_similarity` threshold raised 0.3 → 0.5** — two-step raise via migrations `20260531000001` → `20260531000002_search_wordsim_05.sql`. Eliminates fuzzy false positives ("Pink Ocean" for "Frank Ocean" at 0.42, "Vault" for "Vaundy" at 0.43) without regressing typo tolerance on longer strings (Blakpink, Kendrik Lamar, Newjeans unaffected).
- **Rate limiting on 5 remaining mutation routes** — `auth/resolve-username` POST (10 req/60s, username enumeration risk), `lists` POST (10/60s), `lists/[id]/items` POST (30/60s), `lists/[id]/items` DELETE (30/60s), `rankings/user-ranking` POST (20/60s). All use sliding window via `lib/rateLimit.ts` + Upstash Redis; gracefully skip if Redis is unconfigured.
- **`backfill:genres` (second pass)** — ran 351 more releases (5,357 → 5,708 processed IDs) before VSCode crashed. Still incomplete; resume with `npm run backfill:genres`.

---

**2026-05-31 — Dedup pipeline, catalog integrity, ingest plan:**

- **`track_ratings` migration applied to prod** — ran safe idempotent SQL (DROP POLICY IF EXISTS before recreating) to fix partial-apply error from previous session.
- **Merged genre state files** — local device had 550 new processed IDs from a partial `backfill:genres` run; remote had 5,745; merged union (5,928) committed and pushed.
- **Pulled new features from other device** — streaming buttons, track ratings, inline star ratings, My Rankings dashboard (`/my-rankings` + `/my-rankings/[slug]`), Sidebar "My List" nav link.
- **`dedup:releases` script** (`scripts/find-duplicate-releases.ts`) — detects duplicate albums ingested from Spotify + iTunes with mismatched artist names or punctuation variants. Groups by normalized title+artist and artist_id+title; collapses overlapping groups; scores by user data then metadata richness; safely remaps all FK references (ratings, reviews, list_items, pinned_albums, ranking_votes, ranking_seed_entries, user_ranking_entries, curated_releases, track_ratings, rating_history) before deleting. HIGH/LOW confidence split based on track count spread and date gap.
- **`check:completeness` script** (`scripts/check-artist-completeness.ts`) — for each artist with `itunes_artist_id`, fetches iTunes discography and checks which `itunes_id`s are absent. Re-queues incomplete artists in `artist_ingestion_queue`.
- **`ingest-itunes-queue.ts` prevention fix** — `upsertRelease` now checks `artist_native` as a fallback when the English artist name doesn't match (e.g. "Yerin Baek" vs "백예린"), preventing future cross-language-name duplicates.
- **Dedup run** — `dedup:releases:fix`: 70 high-confidence groups merged. `dedup:releases:fix-all`: 27 low-confidence groups also merged. ~97 duplicate releases removed total. No user data lost (all score=0). Some false positives were caught in the low-confidence run (MOTOMAMI vs MOTOMAMI+, MAYHEM standard vs deluxe, LOONA [#] vs [+ +], etc.) — these will be recovered via `check:completeness` + `queue:ingest` for iTunes-sourced releases.
- **`queue:discover` run 1** — 89 artists processed (708 already done), 1,721 similar artists queued via Last.fm. Total queue pending: 8,968.
- **`backfill:genres`** — still running as of session end (5,357 → 5,708 processed IDs before VSCode crash; resumed and completed 2026-06-01: 703 total null-genre releases processed, 310 matched (44%), 393 no match).

### Pipeline progress (2026-06-01 continued):
- **`backfill:native:releases` (second pass) complete** — 6 native names found (all Haruomi Hosono Japanese titles), 250 no match, 583 skipped. Low yield confirmed: K-pop/J-pop releases use English titles in local iTunes stores.
- **`check:completeness` bug fixed + run** — script was querying `artists.itunes_artist_id` (always null) instead of `artist_ingestion_queue` where the resolved IDs actually live. Fixed both the query source and `ingest-itunes-queue.ts` to write `itunes_artist_id` back to `artists` going forward. Results: **533 complete, 120 incomplete (264 missing releases re-queued), 87 no iTunes presence**.
- **`queue:ingest` run 2 batch 1 complete** — +32,956 inserted, 2,097 enriched, 4,600 skipped, 13 no-match, 0 failed. Catalog grew from ~10k → ~64k releases.
- **`queue:ingest` run 2 batch 2 complete** — +37,598 inserted, 3,695 enriched, 4,184 skipped, 14 no-match, 0 failed. Catalog ~101k+ releases. ~6,800 artists still pending.
- **`queue:ingest` run 2 batch 3 complete** — +29,594 inserted, 2,371 enriched, 4,344 skipped, 25 no-match, 0 failed. Catalog ~110k+ releases. ~5,800 artists still pending.
- **`queue:ingest` run 2 complete (2026-06-03)** — all 9 batches done. Final sanity check: **299,468 releases** (294,586 iTunes, 944 Spotify, 3,938 legacy); 0 missing covers; 0 duplicate itunes_ids (`.limit(1)` fix confirmed working); 1,013 null genres (iTunes missing `primaryGenreName`); 1 stuck `processing` queue entry (needs manual reset); bad date "2020" still present (migration `20260601000000_fix_partial_dates.sql` not yet applied).
- **`queue:ingest` run 2 batch 5 complete** — +25,962 inserted, 2,278 enriched, 2,423 skipped, 11 no-match, 0 failed. Catalog ~165k+ releases. ~3,800 artists still pending. (Skip count drop vs prior batches: collab cleanup removed 303 queue entries.)
- **`queue:ingest` run 2 batch 4 complete** — +29,120 inserted, 2,586 enriched, 4,189 skipped, 31 no-match, 0 failed. Catalog ~139k+ releases. ~4,800 artists still pending.
- **Collab artist fix** — added `isCollaborationArtist()` filter to `discover-lastfm-similar.ts` and `ingest-itunes-queue.ts`; `cleanup-collab-artists.ts` script created and run: 303 collab queue entries deleted, 2 artists table entries deleted. Whitelist of 24 legitimate `&` acts maintained across all 3 scripts.
- **Sanity checks** — `npm run sanity` script created. Findings: no null titles/artists/types, 0 missing covers, 98% genre coverage, 1 bad date ("2020" — migration `20260601000000_fix_partial_dates.sql` created, apply post-ingest), 4 duplicate itunes_ids (root cause fixed: `.maybeSingle()` → `.limit(1)` in `upsertRelease`; run `dedup:releases:fix` post-ingest), 987 null genres (iTunes missing `primaryGenreName` — fix with `enrich:genres:lastfm` post-ingest), singles (64% of catalog) already excluded from `recommendable_releases` view.

---

**2026-05-28 (later) — Streaming buttons, inline ratings, My Rankings, song ratings:**

### What was built

- **Streaming buttons (web)** — `YouTubeMusicButton.tsx` expanded to export `StreamingButtons` (album hero: Spotify / YouTube Music / Tidal icon row) and `TrackStreamingButtons` (per-track compact icons). Spotify uses the stored `spotifyUrl` when available; YouTube Music and Tidal always use search URLs.
- **Track star ratings** — new `TrackStarRating.tsx` component (14px stars, half-star, save/clear). Writes to `track_ratings` table. Added inline to each tracklist row on the album page. New migration `supabase/migrations/20260526000000_track_ratings.sql` — **apply manually via Supabase SQL editor** (table not yet created in prod).
- **Inline star rating** — new `InlineStarRating.tsx` component. Used in: Explore page (below each card, replacing "Rate →" overlay), Rankings leaderboard (new "Your Rating" column, hidden on mobile), Ranking builder (below each search-result suggestion card). Stops click propagation so it doesn't interfere with parent links.
- **My Rankings dashboard** (`/my-rankings`) — auto-generates ranking cards from user's ratings: All Rated, Albums, EPs, Songs (from `track_ratings`), plus per-genre sections (genres with ≥3 rated items). Each card shows top-5 preview + total count, clickable to full detail page. "Recommended for You" section at bottom: unrated albums in user's top-rated genres (score ≥ 3.5).
- **My Rankings detail page** (`/my-rankings/[slug]`) — full-page sorted list for each slug (`all`, `albums`, `eps`, `songs`, genre slugs). Back button to dashboard.
- **Sidebar** — added "My List" nav item with `ListOrdered` icon linking to `/my-rankings`.

### Also shipped in this session (committed after docs update, not previously recorded)

- **Add to List modal** — `AlbumActions` dropdown now opens a modal showing the user's lists with checkmarks; clicking toggles the album in/out of that list inline.
- **Listen Later bookmark** — `ExplorePage` cards gained an inline `BookmarkButton` (Listen Later) alongside the star widget; no need to open the album page to save for later.
- **Activity page two-column layout** — page body becomes a two-column grid on `lg+` screens: feed on the left, `RecommendedFeed` sidebar (sticky) on the right.
- **RankBuilder auto-populate** — "Auto-fill" button fills tiers from user's rated catalog by score band (5★→T1, 4–4.5★→T2, 3–3.5★→T3, 2–2.5★→T4), respecting the active `filterYear`. Saves time when building a year ranking.
- **Fix: Supabase PromiseLike** — wrapped `PromiseLike` returns from Supabase in `Promise.resolve()` before chaining `.catch()` — was causing a build-time type error in strict mode.
- **`dbCache.ts` iTunes artist ID resolution** — `getCachedArtist` / `getArtistFromDb` now resolve numeric iTunes artist IDs via the `itunes_artist_id` column; artist pages no longer 404 when the URL contains a numeric ID from iTunes search.

---

**2026-05-27 — UUID migration + iTunes fallback persistence:**

Migrated `releases.id` from Spotify text ID to owned UUID. All 5,825 releases now have a stable UUID primary key and a `spotify_id` text column for Spotify lookups. Key changes:

- **DB:** Migration `20260527000001_releases_uuid_pk.sql` — adds `spotify_id`, generates UUIDs for all rows, rewrites `release_id` in 9 dependent tables (also converting those columns from `text` to `uuid`), re-adds FK constraints, recreates `recommendable_releases` view. Handled: unknown FKs (dynamic drop), orphaned release IDs (stub row insert), `release_type NOT NULL` constraint, and view dependency on renamed column.
- **Code:** `AlbumRelease` gains `spotifyId` and `itunesId`; `saveBasicReleases` upserts on `spotify_id`; new `saveItunesReleases` upserts on `itunes_id`; `getCachedAlbum`/`getBasicRelease` do triple-lookup (UUID / Spotify ID / iTunes ID); `cacheAlbum` returns the DB-assigned UUID; album page uses `spotifyId` for Spotify API calls and sets `album.id` to the UUID; vote route resolves Spotify IDs to UUIDs before inserting votes.
- **Result:** iTunes search results are now saved to DB as first-class releases, independent of Spotify.
- **Sanity audit + post-migration fixes:** `AlbumActions.ensureRelease` updated to detect UUID vs. Spotify ID and upsert on the correct conflict column; removed redundant duplicate upsert in `commitPin`. `/api/rankings/user-ranking` POST gained a UUID guard on the releases upsert so any stray non-UUID IDs don't crash the endpoint.
- **Multi-signal search:** Migration `20260527000002_search_improvements.sql` adds pg_trgm extension, `ratings_count` column with live trigger, GIN trigram indexes on all name fields, GIN full-text index, and `search_releases()` scored RPC function. `searchReleases`/`searchReleasesInDb` in `lib/dbCache.ts` now call this function. Ranking: exact > prefix > word_similarity (fuzzy/typo) > ts_rank (full-text) > popularity. ✅ Run in Supabase SQL editor.
- **Semantic search (Jina v3):** Migration `20260527000003_pgvector_embeddings.sql` adds pgvector extension, `embedding vector(1024)` column, HNSW index (cosine), and replaces `search_releases()` with a 4-arg hybrid version — lexical + cosine similarity score weight 1500. `embedQuery()` added to `dbCache.ts` (Jina `retrieval.query` task); `searchReleases()` passes the embedding to the RPC when available, degrades to pure lexical if `JINA_API_KEY` unset. Script `scripts/backfill-embeddings.ts` backfills all releases ordered by popularity (Jina `retrieval.passage` task, batch 64, rate-limited, resumable, paginated). ✅ 5,359 releases embedded (all non-singles). `JINA_API_KEY` must be set in Vercel env vars for hybrid search in prod. Re-run `backfill:embeddings` after `queue:ingest` finishes.

---

**2026-05-28 (evening) — queue:ingest completed + DB-first detail pages + ghost cleanup:**

- **`queue:ingest` finished** — drained the full 760-artist Wikipedia queue via iTunes. Results: **4,568 releases inserted, 251 enriched (cover_url backfilled), 149 skipped, 12 artists no iTunes match, 0 failed**. Catalog now spans ~10k+ rows; Korean artist coverage materially better.
- **Ghost-row cleanup** — surfaced during `backfill:genres` output as a block of `[N/1624] Unknown — Unknown … no match` lines. DB query found **13 rows** with `title="Unknown"` AND `artist="Unknown"`, all sharing the same iTunes cover URL (UPC `191924645054`), distinct Spotify IDs, null `cached_at`/`canonical_source`/`release_date`. Cross-checked downstream: 0 ratings, 0 reviews, 0 pins, 0 user_ranking_entries, 0 seed_entries — entirely orphaned. Grep confirmed **nothing in the current codebase writes literal `"Unknown"`/`"Unknown"`** as both fields (current fallbacks use `"Unknown artist"` / `"Unknown album"` with suffixes); these came from a legacy ingest path no longer present. All 13 deleted via service-role client.
- **Backfill re-runs** — `backfill:genres` running for 1,624 null-genre rows from the new iTunes ingest; `backfill:embeddings` (Jina v3) re-ran in parallel: **3,854 embedded, 0 failed** (full catalog total ~9,213). Different APIs, no rate-limit conflict. `backfill:native:releases` deferred until genres finish (both hit iTunes).
- **Local verification of DB-first detail pages** — dev server output for an album page (`/album/b6362d4a-...`, UUID-shaped) and an artist page (`/artist/2h93pZq0e7k5yf4dywlkpM`, Spotify-ID-shaped) showed **zero `[spotify]` / `[Spotify]` log lines** despite the breaker being open with ~4.8h remaining. Pre-fix code would have logged `[Spotify] albums endpoint failed for ...: Spotify circuit breaker open: ... remaining` on the artist page. Search route still calls Spotify by design and logs `[search] Spotify artist search failed, falling back to DB` — that's expected.
- **DB-first detail pages** — symptom that prompted the change: Spotify breaker re-tripped within minutes of a manual clear because every album/artist page render hits Spotify with the shared dev/prod credentials, accumulating quota even when no one is actively searching. Fixes:
  - **`/album/[mbid]`** ([album/[mbid]/page.tsx](apps/web/app/(main)/album/[mbid]/page.tsx)) — chain reordered. Before: `getCachedAlbum` → Spotify → `getBasicRelease`-as-fallback. After: `getCachedAlbum` → `getBasicRelease` → Spotify only as last-resort for genuinely-unknown Spotify-ID deep-links (UUID/iTunes-shaped IDs skip Spotify entirely and 404 if not in DB). Trade-off: iTunes-sourced rows no longer try to fetch a tracklist; page renders without the tracklist section.
  - **`/artist/[id]`** ([artist/[id]/page.tsx](apps/web/app/(main)/artist/[id]/page.tsx)) — discography call is now DB-first. Before: `getSpotifyArtistAlbums` ran unconditionally on every render, with `getArtistReleases` only used as fallback when Spotify returned empty. After: `getArtistReleases` first; `getSpotifyArtistAlbums` only when DB has zero releases for that artist. Saves up to 4 paginated Spotify calls per page load.
- **Spotify breaker incident (15:27 KST):** breaker re-tripped with `untilUtc=2026-05-28T14:12:13Z` (~7.9h cooldown). Triggering 429 logged at 06:27 UTC against `/artists/38sSCvh90B7RYRCvk6e3ux/albums`. Manual clear → re-tripped within seconds (Spotify was genuinely in cooldown). Vercel free-tier log retention only covered ~3 minutes of production traffic in the visible window, so the original triggering 429 is not in retrievable logs.
- **Backfills completed:** `backfill:native:releases` (Phase 2, iTunes local stores), `backfill:covers` (15 filled), `backfill:embeddings` (5,359 non-singles embedded, Jina v3).
- **CSP fix:** Added `https://*.mzstatic.com` to `img-src` CSP and Next.js `remotePatterns` — iTunes cover art was blocked for releases sourced from Apple CDN.
- **Artist page 404 fix:** `getCachedArtist` returned null for stale/uncached artists, fell through to Spotify, and called `notFound()` on failure. Added `getArtistFromDb()` (no TTL) as last resort before 404. Artist pages now render from stale DB data when Spotify is unavailable.
- **Search artist fallback fix:** `searchItunesArtists` returns iTunes numeric IDs (`"123456789"`) incompatible with our `artists` table and Spotify API — every result from the iTunes fallback caused a 404 when clicked. Removed iTunes from the artist search fallback chain; Spotify failure now falls back directly to `searchArtistsInDb`.
- **Native name corrections:** Created `fix-native-names-english-stage.sql` — manually sets Korean native names for ~45 K-pop acts with English-only stage names that Wikipedia Phase 1 couldn't find: IU (아이유), IVE (아이브), NewJeans (뉴진스), aespa (에스파), BLACKPINK (블랙핑크), EXO (엑소), TWICE (트와이스), Stray Kids (스트레이 키즈), and more. Run in Supabase SQL editor — updates both `artists` and `releases` tables directly.

---

**2026-05-27 — iTunes genre backfill (`backfill:genres`) completed:**

`npm run backfill:genres` finished its full run across all releases:
- **2,864 releases matched** — genre written from iTunes (66% match rate)
- **1,494 releases** — no iTunes match (genre remains from other tiers or null)
- State saved to `apps/web/scripts/backfill-genres-itunes-state.json`

Genre pipeline is now fully complete: iTunes Tier 1 ✅ + Last.fm Tier 2 ✅ + hand-curated overrides ✅ + Last.fm enrichment ✅.
Next up: **Phase 2 native name backfill** (`backfill:native:releases`) then queue ingestion (`queue:ingest`).

---

**2026-05-25 (early morning) — Phase 1 native name backfill completed; backfill-native-names.ts hardened:**

### Phase 1 run results

`backfill:native:artists` (Wikipedia langlinks) completed two passes across ~536 artists:
- Pass 1: 186 matched — several false positives found during the run
- Pass 2: 69 more matched after code fixes
- **Total: ~247 artists with `name_native`** (~46% coverage)

Notable no-matches that are expected (Wikipedia Korean articles likely use Latin names): `2NE1`, `NewJeans`, `LE SSERAFIM`, `IVE`, `NMIXX`, `TOMORROW X TOGETHER`, `IU`, `Red Velvet`, `aespa`, `j-hope`, `CHUNG HA`.

### False positives found and fixed (multiple iterations)

The script needed several rounds of hardening. Root causes and fixes:

1. **`results[0]` blind fallback** — when no search title matched the artist, the first Wikipedia result was used regardless. `FREE THE MANE` matched the US rapper Future (퓨처), `lobonabeat!` matched a Korean music award ceremony. Fix: removed the fallback entirely — if no title matches, return null.

2. **Broken category regex** — `\bbuddhis\b` doesn't match "Buddhist" (word boundary breaks after 's'); `\bconcept\b` doesn't match "concepts". `Nirvana` → 열반 (Buddhist concept) and `Suicide` → 자살 kept slipping through even after the category check was added. Fix: removed `\b` word boundaries from both regexes; changed `buddhis` to `buddh`; added music term plurals.

3. **`isMusic === null` in Step 1 was allowing results through** — ambiguous pages (including concept articles with no clear category signal) defaulted to "allow". Fix: ambiguous result in Step 1 now falls through to the music-biased search (Step 2) instead of accepting.

4. **Disambiguation pages with langlinks blocked search fallback** — `if (links.length > 0) return null` treated disambiguation pages that happened to have langlinks (e.g. `IU`, `EXO`) as Western artists. Fix: added `isDisambig` detection from categories; skip the early-return if the page is a disambiguation page.

5. **Space-insensitive matching** — `BIGBANG` didn't match `Big Bang (South Korean band)` because `normalizeStr` preserves spaces. Fix: added a no-space comparison pass to the search hit selector.

6. **Music-biased search query** — Step 2 search appends `singer OR band OR musician OR rapper` to push music articles above concept articles in Wikipedia results.

### False positives cleared from DB before final pass

```sql
UPDATE artists SET name_native = NULL, native_language = NULL
WHERE name IN ('1995', '350', 'Nirvana', 'Suicide', 'Ransom', 'god', 'Superorganism', 'Turnstile');
```

### Overnight run status

iTunes genre backfill (`backfill:genres`) was left running overnight at ~1493/4358 (~3:35 AM). Heavy 403 throttling by Apple — estimated 30+ hours total. Power settings configured on Windows laptop so lid-close doesn't suspend (powercfg commands applied). `backfill:native:releases` (Phase 2) will run after the genre backfill finishes.

---

**2026-05-24 (night) — Multilingual catalog: native name pipeline + deployment fix:**

### Decision: language-agnostic native name schema

User identified the database was English-only: Korean artists and albums have Korean names that Korean users will search for, but the DB only stored the Latin/romanized versions. Solution chosen: add a small set of language-agnostic columns — `title_native`, `artist_native`, `native_language` (ISO 639-1 code: `'ko'`/`'ja'`/`'zh'`) to `releases`; `name_native`, `native_language` to `artists` — rather than per-language columns like `title_ko`. Language is detected from Unicode character ranges (Hangul / Hiragana-Katakana / CJK), never hardcoded. Adding support for a new language only requires sourcing artists in that language — no schema changes.

### New migrations applied to prod

- **`20260525000002_native_language_columns.sql`** — drops intermediate `_ko` columns (from a discarded design attempt), adds `title_native`, `artist_native`, `native_language` to `releases`; `name_native`, `native_language` to `artists`; renames `name_ko` → `name_native` in `artist_ingestion_queue`; creates pg_trgm GIN indexes on all four native columns.
- **`20260525000003_native_language_constraint.sql`** — adds `CHECK (native_language IS NULL OR native_language ~ '^[a-z]{2}$')` to both tables.

### New script: backfill-native-names.ts

Two-phase pipeline for fixing existing DB rows:

**Phase 1 (artists)** — queries MusicBrainz `artist.search` for every `artists` row with `name_native IS NULL`. Finds any CJK-script alias (locale: ko/ja/zh). Exact-match only — never falls back to `artists[0]` to avoid wrong-artist results. Capped retry: 5 attempts, exponential backoff (5000ms × 2^n, cap 30s). Rate: 1 req/s (1100ms delay).

**Phase 2 (releases)** — for every `releases` row with `title_native IS NULL` from a known Asian artist (one whose `native_language` was set by phase 1), calls the iTunes local store for that country (KR/JP/TW). Loads all known-Asian artists into memory maps first; Western releases are skipped with zero API calls. Rate: 650ms/req.

Both phases are resumable — state checkpointed every 20 records to `scripts/backfill-native-names-state.json`.

npm scripts added: `backfill:native`, `backfill:native:dry`, `backfill:native:artists`, `backfill:native:releases`.

### Files updated for native name display and search

- **`apps/web/types/index.ts`** — added `titleNative?: string | null` and `artistNative?: string | null` to `AlbumRelease`.
- **`apps/web/components/AlbumCard.tsx`** — shows native title below English title (when different, case-insensitive comparison). Shows `artistNative · artist` format when native artist name differs.
- **`apps/web/lib/dbCache.ts`** — `searchReleasesInDb` and `searchReleases` query `title_native` and `artist_native` via `.or()` alongside the English columns; map to `titleNative`/`artistNative` in the return. `searchArtistsInDb` queries `name_native` alongside `name`.
- **`apps/web/scripts/build-artist-queue.ts`** — added `fetchKoreanName()` (Wikipedia langlinks API); guards with `detectLanguage()` before writing `name_native` (prevents Latin-script strings from landing in the column). `ignoreDuplicates: false` on upsert so re-runs backfill `name_native` on existing rows.
- **`apps/web/scripts/ingest-itunes-queue.ts`** — added `fetchNativeNames(artistId, storeCountry)` which fetches the local-store iTunes discography; only called when `row.name_native` is set (skips doubled API call for unknown-language artists). After processing, propagates `name_native` to the `artists` table via `ilike` match.

### 9 critical issues found and fixed (during self-review)

1. `build-artist-queue.ts` wrote Latin-script Wikipedia article titles as `name_native` → fixed with `detectLanguage()` guard
2. `ingest-itunes-queue.ts` doubled iTunes API calls unconditionally → fixed: skip local store call when language unknown
3. MusicBrainz search fell back to first result for wrong artists → fixed: exact normalized name match only, return null otherwise
4. MusicBrainz retry was infinite (no cap) → fixed: 5-attempt cap with exponential backoff
5. `AlbumCard.tsx` comparison was case-sensitive (`===`) → fixed with `.toLowerCase()` on both sides
6. `queue:ingest` never wrote `name_native` back to the `artists` table → fixed: propagates after processing each queue row
7. 759 existing queue rows were added without `name_native` (langlink fetching wasn't in queue:build yet) → operational fix: re-run `queue:build` once before `queue:ingest`
8. Phase 2 queried iTunes for all releases including Western acts → fixed: pre-loads Asian artist set into memory, skips non-Asian releases before any API calls
9. No DB constraint on `native_language` values → fixed: migration 000003 with regex CHECK

### Deployment failure found and fixed

Vercel build failed because `apps/web/lib/dbCache.ts:153` still referenced the dropped `name_ko` column in `searchArtistsInDb()`:
```typescript
.or(`name.ilike.${pattern},name_ko.ilike.${pattern}`)  // ← wrong
```
Fixed to `name_native`. Committed as `6bda114`. Build should now pass cleanly.

### Status at session end

- ✅ Migrations 000002 and 000003 applied to prod
- ✅ `backfill-native-names.ts` built and ready to run
- ✅ Deployment fix committed and pushed (6bda114)
- ✅ `enrich:genres:lastfm` — completed. 1,587 enriched, 137 already covered, 3,716 no Last.fm match
- ⬜ `backfill:native` — not yet run (waiting for iTunes genre backfill to finish first)

---

**2026-05-24 (late evening) — Non-Spotify catalog pipeline + column consistency guarantee:**

### Decision: retire Spotify from data collection

Spotify's client-credentials rate limits are too tight to grow the catalog to launch-scale before mid-June. Decision made to stop using Spotify for data collection entirely. The web server still uses Spotify at runtime (search, album detail), but all scripts for growing the catalog now go through iTunes + Last.fm + Wikipedia + MusicBrainz instead.

### New scripts built

- **`apps/web/scripts/build-artist-queue.ts`** — queries Wikipedia MediaWiki API for 19 Korean music categories (K-pop groups/solo, hip-hop, rock, indie, jazz, trot, electronic, ballad, Korean pop singers). Cleans disambiguation: "IU (singer)" → "IU". Upserts to `artist_ingestion_queue` (idempotent). 300ms delay per Wikipedia request. `npm run queue:build` / `queue:build:dry`.

- **`apps/web/scripts/ingest-itunes-queue.ts`** — drains `artist_ingestion_queue` via iTunes Search API. Per artist: finds iTunes artist ID → fetches full discography → upserts releases. 650ms/req delay with exponential backoff on 429/403. Enriched path only backfills `cover_url` if existing record has none (preserves Spotify art). Marks queue rows done/failed/skipped. `npm run queue:ingest` / `queue:ingest:dry` / `queue:ingest -- --limit=50`.

- **`apps/web/scripts/discover-lastfm-similar.ts`** — replaces the dead Spotify `expand:related`. For every artist in the `artists` DB table, calls Last.fm `artist.getSimilar` and queues up to 20 similar artists per call. Run after `queue:ingest`; loop until stable. State file: `scripts/discover-lastfm-similar-state.json`. `npm run queue:discover` / `queue:discover:dry`.

- **`apps/web/scripts/backfill-cover-art.ts`** — fills all `cover_url IS NULL` releases via 4-tier fallback: iTunes → Last.fm → MusicBrainz/Cover Art Archive → Spotify (skippable). Writes `cover_url` + `cover_source`. MusicBrainz rate limit: 1 req/s. State file: `scripts/backfill-cover-art-state.json`. `npm run backfill:covers` / `backfill:covers:dry` / `backfill:covers:no-spotify`.

- **`apps/web/scripts/enrich-genres-lastfm.ts`** — runs on ALL releases (not just null-genre ones). Gets top 3 mappable Last.fm tags per album and MERGES them with existing genres (e.g., iTunes wrote "k-pop", Last.fm adds "r&b,soul" → stored "k-pop,r&b,soul"). Deduplicates case-insensitively. State file: `scripts/enrich-genres-lastfm-state.json`. `npm run enrich:genres:lastfm` / `enrich:genres:lastfm:dry`.

- **`apps/web/scripts/normalize-releases.ts`** — one-time (but safe to re-run) normalization pass. Fixes: partial dates ("2024" → "2024-01-01"), mixed-case genres ("K-Pop" → "k-pop"), lowercase release_type ("album" → "Album"). Dry run confirmed 153 dates + 3,687 genres to fix, 0 release_types. Actual run started at session end. `npm run normalize:releases` / `normalize:releases:dry`.

### New migration

**`apps/web/supabase/migrations/20260525000000_catalog_ingestion_queue.sql`** — creates:
- `artist_ingestion_queue` table: id, name, name_ko, source, source_id, itunes_artist_id, status (pending/processing/done/failed/skipped), releases_added, error, processed_at, created_at; UNIQUE(name, source)
- `search_misses` table: id, query, type, db_count, searched_at

Must apply with `supabase db push` before running any queue scripts.

### Column consistency — exhaustive audit and fixes

All 9+ write paths to the `releases` table were audited for column format consistency. Issues found and fixed:

| Column | Standard | Issue found | Fix |
|--------|----------|-------------|-----|
| `release_date` | `'YYYY-MM-DD'` | Spotify returns "2024" or "2024-01" | `normalize-releases.ts` pads to full date |
| `genres` | lowercase, comma-separated | Spotify CSV fallback wrote "K-Pop", "Hip-Hop" | `normalize-releases.ts` lowercases all |
| `release_type` | Title Case: 'Album'/'EP'/'Single'/'Compilation'/'Live' | Vote API stored client-provided value without normalization | Fixed in `rankings/vote/route.ts`; normalize script checks historical data (0 found) |
| `cover_url` | iTunes path not to be overwritten by lower-quality sources | `ingest-itunes-queue.ts` enriched path would always overwrite | Fixed: only backfills if `cover_url` is null |
| `total_tracks` | column name | `ingest-itunes-queue.ts` wrote to `track_count` (non-existent) | Fixed column name |
| `cached_at` | written by iTunes ingest | missing from `ingest-itunes-queue.ts` | Added `cached_at: new Date().toISOString()` |

### Changes to existing files

- **`apps/web/app/api/search/route.ts`** — added `logSearchMiss()` (fire-and-forget insert to `search_misses` when DB returns < 5 results). Fires before Spotify fallback so every DB-insufficient query is logged for nightly ingest.
- **`apps/web/app/api/rankings/vote/route.ts`** — added `RELEASE_TYPE_MAP` normalization to enforce Title Case on `release_type` at insert time.
- **`apps/web/package.json`** — added npm scripts: `enrich:genres:lastfm`, `enrich:genres:lastfm:dry`, `queue:build`, `queue:build:dry`, `queue:ingest`, `queue:ingest:dry`, `queue:discover`, `queue:discover:dry`, `backfill:covers`, `backfill:covers:dry`, `backfill:covers:no-spotify`, `normalize:releases`, `normalize:releases:dry`.

### Status at session end

- ✅ `normalize-releases.ts` — completed. 135 dates padded, 3,286 genres lowercased, 0 release_types to fix. (Lower than dry-run estimate because iTunes backfill was running in parallel and pre-fixed some rows between the dry run and actual run.)
- ✅ Migration `20260525000000_catalog_ingestion_queue.sql` — applied via `supabase db push`.
- ✅ `queue:build` — completed. **759 Korean artists** queued from 19 Wikipedia categories (K-pop groups/solo, boy/girl bands, hip-hop, rock, indie, trot, electronic, ballad).
- 🔄 `backfill-genres-itunes.ts` — left **running in background** (~760/4358 processed at session end). Frequent iTunes 403 IP blocks slowing it down; exponential backoff handles them automatically (10s → 20s → 40s → 80s → 120s cap). Safe to leave running overnight.

### Remaining pipeline (next session)

Wait for iTunes backfill to finish, then run in order:
1. `npm run enrich:genres:lastfm` — supplement all existing genres with Last.fm tags (merges, does not overwrite)
2. `npm run queue:ingest` — drain 759 Wikipedia artists through iTunes
3. `npm run queue:discover` → loop back to `queue:ingest` until stable
4. `npm run backfill:covers` — fill remaining null `cover_url` values

See the "START HERE" checklist in README for the if-finished / if-still-running / if-crashed branches.

---

**2026-05-24 (evening) — iTunes-first multi-source catalog + three-tier genre backfill:**

### What was built

- **`apps/web/scripts/ingest-itunes.ts`** — new catalog ingestion script. Pulls full discographies for 126 curated Korean artists directly from the iTunes Search API (no auth, no rate limits). Uses 600ms/req + exponential backoff retry (10s → 20s → 40s → 80s → 120s cap) for both 429 and 403 responses. Deduplicates by `itunes_id` first, then exact title+artist match, then inserts a new row with `id = crypto.randomUUID()`. Noise filter skips sped-up/slowed/karaoke singles with trackCount ≤ 3. State file: `apps/web/scripts/itunes-state.json` (saves after every artist).
- **`apps/web/scripts/backfill-genres-itunes.ts`** — backfills genre for releases with null/empty genres by searching iTunes for each by "title artist", scoring matches with Jaccard similarity (title 70% + artist 30%, min score 0.55), and writing the mapped genre back. Same 429/403 retry. State file: `apps/web/scripts/backfill-genres-itunes-state.json` (saves every 50 records). `npm run backfill:genres` now points here (renamed from old dead Spotify-based script).
- **`apps/web/scripts/backfill-genres-lastfm.ts`** — Last.fm fallback genre script. Calls `album.gettoptags`, walks tags by vote count (min 5 votes), maps first recognizable tag to internal taxonomy. 250ms/req (Last.fm is more permissive). Reads `LASTFM_API_KEY` from env (exits with error if missing). State file: `apps/web/scripts/backfill-genres-lastfm-state.json`. `npm run backfill:genres:lastfm` + `:dry` added to `package.json`.
- **DB migration `20260524000001_add_multi_source_columns.sql`** — additive migration adding `itunes_id bigint UNIQUE`, `canonical_source text`, `cover_source text`, `title_ko text`, `upc text UNIQUE` to `releases`; `itunes_artist_id bigint UNIQUE`, `name_ko text` to `artists`. Applied to prod.
- **`CLAUDE.md`** — added prominent reminder at the top about keeping `.env.local` in sync across both devices.
- **`apps/web/.env.example`** — added `LASTFM_API_KEY=your-lastfm-api-key` placeholder.
- **Merge conflict resolved** — pulled remote changes (from other device, 6 commits ahead); conflict in `apps/web/app/api/search/route.ts`. Kept DB-first releases logic from local + artist/track DB fallback + outer catch-all from remote. Both sides merged cleanly.

### What's incomplete / not yet run — READ BEFORE NEXT SESSION

**► START HERE — run these checks in order at the top of the next session:**

```
1. ps aux | grep backfill-genres-lastfm
   → If still running: wait for it to finish.
   → If not running: check cat apps/web/scripts/backfill-genres-lastfm-state.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['processedIds']), 'processed')"
     · If count < ~4500: it crashed — run: cd apps/web && npm run backfill:genres:lastfm  (resumes from state)
     · If count is ~4500+: Tier 2 done ✓ — proceed to step 2.

2. Run Tier 3 (overrides): cd apps/web && npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts

3. Reset and re-run iTunes catalog ingest:
   cd apps/web && rm scripts/itunes-state.json && npm run itunes:seed
```

**Tier 1 (iTunes backfill) — ✅ DONE. All 4,989 records processed.**

**0. ⚠️ COMMIT AND PUSH BEFORE SWITCHING DEVICES — several files are uncommitted**

The following files exist only on this machine and are not yet in git:
- `apps/web/scripts/backfill-genres-itunes.ts` — the iTunes genre backfill script (currently running!)
- `apps/web/scripts/backfill-genres-lastfm.ts` — the Last.fm fallback script
- `apps/web/package.json` — `backfill:genres:lastfm` + `:dry` npm scripts not committed
- `apps/web/.env.example` — `LASTFM_API_KEY` placeholder not committed
- `CLAUDE.md` — two-device reminder not committed
- `README.md` + `SESSIONS.md` — these doc updates not committed
- `apps/web/scripts/ingest-itunes.ts` — has uncommitted changes (429/403 retry fix added mid-session)

Run this before closing or switching devices:
```bash
git add CLAUDE.md README.md SESSIONS.md \
  apps/web/.env.example \
  apps/web/package.json \
  apps/web/scripts/ingest-itunes.ts \
  apps/web/scripts/backfill-genres-itunes.ts \
  apps/web/scripts/backfill-genres-lastfm.ts
git commit -m "feat(catalog): iTunes genre backfill + Last.fm fallback + docs"
git push
```
Do NOT add `apps/web/scripts/backfill-genres-itunes-state.json` or `apps/web/scripts/itunes-state.json` — those are runtime state files, not source code.
Do NOT add `apps/web/supabase/migrations/20260524000000_multi_source_catalog_schema.sql` — that is the abandoned failed migration, keep it untracked.

**1. iTunes genre backfill (Tier 1) — ✅ DONE**
- All 4,989 records processed successfully (exit code 0).

**2. Last.fm genre backfill (Tier 2) — RUNNING as of session end**
- Started at session end, output logging to `/tmp/lastfm-backfill.log` (4,580 records, ~20 min).
- Check if still running: `ps aux | grep backfill-genres-lastfm`
- If crashed: re-run `cd apps/web && npm run backfill:genres:lastfm` — resumes from state file.
- Quality note: ~50% match rate expected (iTunes got the easy ones). A few false positives with `soundtrack` tag (Joy Division, Talking Heads, Wire — Last.fm users tag weirdly). Fix those individually via genre overrides if needed.

**3. Genre overrides (Tier 3) — NOT applied to DB**
- `apps/web/scripts/genre-overrides.json` has 86 hand-filled rows (2 intentionally blank). Dry-run previously passed with 0 errors.
- Run: `cd apps/web && npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts`
- Run after Tiers 1 and 2.

**4. iTunes seed ingest — artists 1–80 need to be re-run, artists 96–126 need to resume**
- **Problem with artists 1–80**: The ingest ran before the DB migration added the `itunes_id` column. Every `upsertAlbum()` call failed silently because the column didn't exist. State file shows these 80 as "done" but they contributed 0 records to the DB.
- **Fix**: Delete `apps/web/scripts/itunes-state.json` and re-run `npm run itunes:seed`. Artists 81–95 will re-run but their inserts are idempotent (deduplicate on `itunes_id`) so no data loss.
- **Problem with artists 96–126**: Hit iTunes 429 then 403 (IP block) at artist 96 (Nafla). The IP block is temporary (usually 30–60 min). Once cleared, `npm run itunes:seed` will pick up from Nafla automatically (state file has 95 done).
- **Summary of correct run order**: (a) wait for IP block to clear, (b) delete `itunes-state.json`, (c) `npm run itunes:seed`.

**5. Local branch needs to be pushed**
- As of session end, local branch was 2 commits ahead of `origin/main` (the merge commit + our earlier catalog commit). Run `git push` when ready.

### Key technical context for next session

- `genres` column stores a single string tag (e.g. `'k-pop'`, `'hip-hop'`), not an array. The backfill scripts write one genre per release.
- iTunes 403 is an IP-level block (not auth). It follows repeated 429s. The retry handler in all three scripts covers it with the same exponential backoff. If you get an immediate 403 on startup, just wait 30–60 minutes and try again — don't change anything in the script.
- The 126-artist seed list covers K-pop gen 1–4, Korean indie, Korean R&B, and Korean hip-hop. Non-Korean artists are not covered by iTunes ingest; they come from the Spotify-based `expand:discography` / `expand:genre` pipeline.
- The old Spotify `backfill:genres` script (`apps/web/scripts/backfill-genres.ts`) still exists but is dead — `backfill:genres` npm script now points to the iTunes version. Don't confuse them.
- Last.fm API key is at `.env.local` → `LASTFM_API_KEY`. Shared secret is NOT needed (only the API key is used for read-only tag lookups).
- The complex DB migration `20260524000000_multi_source_catalog_schema.sql` (PK restructure) was abandoned because it hit a FK constraint (`ratings_release_id_fkey`). It was marked as applied in Supabase migration history to suppress re-runs: `supabase migration repair --status applied 20260524000000`. The simpler additive migration `20260524000001` succeeded instead.
- **Supabase default row limit is 1,000** — `expand-catalog.ts` logs "X existing releases" using a plain `.select()` which is capped at 1,000 by Supabase. With 5,318 releases in the DB this means expand-catalog consistently under-reports the catalog size. This is cosmetic (the script still works correctly — it only needs the count for logging). The backfill scripts use `.range()` pagination so they fetch all records correctly. No fix applied, just be aware the "existing releases" log line from expand-catalog is wrong.
- **Total releases in DB**: 5,318 as of session start. Only ~329 (~6%) had genre data. That's the gap the three-tier backfill pipeline is addressing.

**2026-05-24 (morning) — search graceful degradation + script circuit-breaker cooperation + 429 instrumentation + runbook:**

- **Symptom that triggered the session**: `/api/search` returned 500 across the board. Root cause: Spotify circuit breaker open for ~4.7h with `{"error":"Spotify circuit breaker open: 16808s remaining"}`. Confirmed via curl. The fallback chain that exists for album pages didn't exist for search.
- **DB-backed search fallback (`/api/search`)**
  - Wrapped each Spotify call in its own try/catch; on any failure (circuit open, 429, network error) falls back to `searchReleasesInDb` / `searchArtistsInDb` (ilike on `releases.title` ∪ `releases.artist` and `artists.name`).
  - Returns 200 + `{ releases | artists, degraded: true }` instead of 500. Tracks/recordings return empty with `degraded: true` since there's no local tracks table.
  - New `lib/dbCache.ts` helpers: `searchReleasesInDb`, `searchArtistsInDb`, plus an `escapeIlike` utility.
  - New `pg_trgm` migration `20260524000000_search_trigram_indexes.sql` adds GIN trigram indexes on `releases.title`, `releases.artist`, `artists.name` so the fallback stays fast as the catalog grows. Applied to prod (required `migration repair --status applied 20260522000001` first because the FK migration had been applied manually earlier and was older than the latest remote migration).
- **Degraded-mode UI banner**
  - `AlbumSearchForm` reads the `degraded` flag from either response and renders an amber notice ("Showing cached results — live search is temporarily unavailable.") above results. i18n strings added to en.ts + ko.ts as `search.degradedNotice`.
- **429 instrumentation in `lib/spotify.ts`**
  - Added high-visibility `console.error('[spotify] 429 path=... retryAfter=...s untilUtc=...')` immediately when a 429 is detected, so the offending endpoint is searchable in Vercel logs. Previously the only log was the breaker-fallback symptom; root cause was invisible without a Pro subscription expanding the log timeline.
  - Path now included in the bailing-fast error message too.
- **Scripts cooperate with the production circuit breaker**
  - **Why this matters**: five scripts (`backfill-genres`, `expand-catalog`, `ingest-music`, `seed-prestige`, `seed-rankings`) hit Spotify directly via raw `fetch()`, bypassing `spotifyFetch` entirely. They share the same Spotify credentials as the web server, so a script burst can trigger an account-wide 429 that breaks production for hours with no clear cause. Most likely root cause of the recurring mystery rate limits.
  - New shared helper `scripts/spotify-circuit.ts` exports `assertSpotifyCircuitClosed()` (pre-flight check, refuses to start if breaker open) and `recordSpotify429(retryAfterSec, source)` (publishes the cooldown to the same Redis key the web app reads).
  - All 5 scripts patched: pre-flight at the top of `main()`, `recordSpotify429` inside each 429 handler.
  - `ingest-music.ts` previously slept unconditionally on Retry-After (could block for hours); now bails fast at > 120s like the other 4.
- **Debugging runbook**
  - New top-level "🔧 Debugging Spotify-related production issues" section in `README.md` placed right between "Current state" and "Local development". Documents the symptom → confirm → find-cause → recover flow, with the exact log filters to grep (`[spotify] 429 path=`, `[scriptCircuit] published 429 from`). The key insight: "Spotify circuit breaker open" is the *symptom* (calls blocked by an already-open breaker), not the cause.
- **Memory updated**: `project_spotify_rate_limits.md` rewritten to reflect new fallback + breaker + script-coordination state.
- **Deferred**: per-user rate limit on `/api/search` (still on Week 4 list); active verification of the new `[spotify] 429 path=` log line (waiting for next organic 429 to validate).

**2026-05-23 — 404 hardening, circuit breaker, Spotify deprecation findings, genre-overrides scaffolding:**

- **404 hardening on album click-through during Spotify outages**
  - `/api/search` now calls `saveBasicReleases(releases)` fire-and-forget after a Spotify search succeeds — so click-through to `/album/[id]` always finds a row in `releases` and never 404s purely because of an in-flight Spotify rate limit. Same pattern that recommendations/personalized routes already used; gap was only in search.
  - Album page already had a 3-step fallback (`getCachedAlbum` → `getSpotifyAlbum` → `getBasicRelease`) that renders a stripped-down page when only the basic row is available. Verified working in prod build with a deliberately deleted row + open circuit breaker.
- **Spotify circuit breaker (`lib/spotify.ts`)**
  - New Redis key `spotify:rate-limited-until` stores a future timestamp when Spotify returns 429
  - `spotifyFetch` checks this key first; throws `SpotifyCircuitOpenError` immediately if set, instead of letting every concurrent request also hit Spotify and individually hang ~10s
  - Verified: closed circuit → 915ms real call; open circuit → 332ms `500 {"error":"Spotify circuit breaker open: 120s remaining"}`
  - Auto-clears via TTL matching `Retry-After`
- **Spotify endpoint deprecations confirmed (late 2024)**
  - `/v1/artists/{id}` now returns `genres: []` for the vast majority of artists. Confirmed empirically: 34/34 consecutive artists returned empty in `backfill:genres` dry run. The script is dead until rewritten against a different source.
  - `/v1/artists/{id}/related-artists` returns 404. `expand:related` mode in `scripts/expand-catalog.ts` is also dead.
  - Documented in memory + README. Long-tail genre backfill plan: Last.fm `artist.getTopTags` / `album.getTopTags` (Last.fm has good K-tag coverage because Korean fans tag heavily). Last.fm rewrite of `backfill-genres.ts` not yet built.
- **Genre overrides workflow (hand-curated for 88 high-value rows)**
  - `scripts/check-genre-coverage.ts` — characterizes the genre-less rows (paginated; full 4,901 rows): 39 tier-1, 22 tier-2, 11 in `curated_releases`, 19 with user ratings. Confirmed 0 of 490 cached artists have populated genres (Spotify deprecation hit before artists were cached); no free local backfill path.
  - `scripts/dump-genre-overrides-skeleton.ts` — generates `scripts/genre-overrides.json` skeleton with the 88 high-value rows + sample of the existing genre vocabulary (top 50 tags).
  - `scripts/genre-overrides.json` — 86 of 88 rows hand-filled with genres in the project's existing vocabulary (K-pop, R&B, Korean hip-hop, k-indie, k-rap, k-r&b, j-rock, j-pop, etc.); 2 left blank intentionally (a Korean language-learning recording mistakenly in `curated_releases`, and one ambiguous K-content release).
  - `scripts/apply-genre-overrides.ts` — reads the JSON, dry-run supported, force-overwrite supported, skips rows that already have genres unless `--force`. Dry-run passes with 86 ready, 0 errors, 0 conflicts. **Not yet applied to DB.**
  - `scripts/remove-curated.ts` — utility to remove a row from `curated_releases` (used to delete the Korean language-learning recording).
- **Album page**
  - Removed `export const revalidate = 60` — was a no-op since the page is dynamic (uses cookies via `getServerT()`), but was suspected to trigger a Next.js `notFound()` status-code bug. Removing it didn't fix the bug. Comment documents the known issue.
- **Next.js patch upgrade**
  - Bumped `next` and `eslint-config-next` from 14.2.5 → 14.2.35 (latest 14.2.x). 30 patch releases of bug fixes / security updates. Did not resolve the `notFound() → 200` issue.
- **Known issue documented (deferred to post-launch)**
  - `notFound()` returns HTTP 200 (with the correct not-found.tsx body) instead of 404 on pages that combine `notFound()` with cookie reads. Confirmed reproducible in dev AND prod. Affects `/album/[mbid]` and `/rankings/[slug]`. `/artist`, `/genre`, `/explore` (also use cookies via `getServerT()` but don't hit the bug) return 404 correctly — the actual differentiator isn't obvious from a code read. Tried patch upgrade, removing `revalidate`, adding `force-dynamic` — none fixed it. Post-launch fix candidates: Next.js 15/16 upgrade or refactor album page to extract cookie-using code into a child Server Component.
- **README + SESSIONS docs updated**: stale "next session" checklist replaced with current state; phase 3 marked broken; new architecture notes for circuit breaker + search writeback; Known Issues section added.

**2026-05-22 — Spotify quota hardening + dynamic recommendations:**
- **Quota protection** (shared dev/prod Spotify app, can't get extended quota until 250k MAU)
  - Removed runtime Spotify fallback from `RecommendationGrid` (homepage), `personalized` API, `recommendations` API — DB-only
  - Migrated all 5 in-memory Spotify caches (`artistCache`, `albumsCache`, `recsCache`, `artistIdCache`, `albumDetailCache`) to Upstash Redis with long TTLs (7–90 days); restarts no longer cost Spotify calls
  - Added Redis caching to `/api/search` (albums/artists/tracks/year+market combos, 1-day TTL) and `fetchMoreArtistAlbums` (per-cursor cache)
  - `spotifyFetch` now bails fast on `Retry-After > 10s` instead of hanging the request for hours
  - 1-hour ISR on homepage (effectively bypassed by auth-cookie read in `RecommendationGrid` — anon traffic still benefits)
- **Recommendation grid: dynamic + taste-driven**
  - Expanded `genre-categories.ts` from 5 → 30 categories with metadata: `onboardingGenre`, `origin`, `isDefault`, `sortOrder`
  - New `lib/category-resolver.ts`: scores categories per user (onboarding match +100, rating-match capped +50, isDefault +20, origin diversification cap of 4)
  - `RecommendationGrid` now reads auth + calls resolver; returns top 10 personalized rows
  - Hide rows with < 6 albums (no more lonely 1–7 album rows)
- **DB pipeline fixes**
  - `recommendable_releases` view: previous edit to the migration file was in-place after first apply, so Supabase never reapplied the `LOWER()` fix; new migration `20260522010000_recommendable_releases_view_fix.sql` forces it (view went from 0 → 3338 rows)
  - `expand:discography` now fetches one `/artists/${id}` per artist and saves genres on all their albums (was leaving genres null, the root cause of 90% missing genres)
  - New `scripts/backfill-genres.ts` script: one artist call per artist, batched DB updates, fail-fast canary + RateLimitError handling
  - New `scripts/check-recommendable-view.ts` and `scripts/check-category-coverage.ts` diagnostic scripts
  - Expanded `expand:genre` sweep tag list from 12 → 35+ tags (jazz, soul, funk, classic rock, alt rock, electronic, country, folk, classical, metal, punk, etc.) to de-center the DB from Korean music
- **PostHog CSP fix** — added `https://us-assets.i.posthog.com` to `script-src` (was blocking web-vitals, dead-clicks, surveys)
- **Audit findings (no action taken per CLAUDE.md scope rule)**
  - Dead `searchSpotifyAlbums` import in `apps/web/app/api/rankings/vote/route.ts`
  - `saveBasicReleases` in `lib/dbCache.ts` is now unused (was called by removed Spotify fallbacks); left exported in case scripts need it
- **Next-session checklist** added to top of `README.md`: wait for rate limit → verify Redis writes + restart behavior → run `backfill:genres` + `expand:genre` + `expand:related` → confirm homepage DB-served

**2026-05-18 — branding:**
- Brand identity locked: tagline "Every record you've loved.", amber accent (#E8A020), flower mark (Asset 20)
- Full cyan/mint purge across 18+ files
- Score badges → periwinkle blue (#5170ad); score display → 1 decimal (toFixed(1))
- Homepage headline: "Your taste documented."; metadata description: "Every record you've loved."
- Copy/voice audit: 17 en.ts strings + 6 hardcoded + 9 ko.ts strings
- Logo assets: public/logo.svg + public/logo-flower.svg both replaced with Asset 20; Asset 15 deleted
- Auth form value-prop card removed

**2026-05-18 — security:**
- Auth checks on mutation routes via `lib/authGuard.ts`; client-side callers send `Authorization: Bearer <token>`
- `/api/auth/resolve-username` GET → POST
- Security headers, image allowlist
- DB indexes + GIN FTS migration `20260517000000_indexes_and_fts.sql`
- TypeScript clean, build passes, all 13 test cases pass

**2026-05-17:**
- Korean ranking titles: `rankingTitles` translations in `en.ts` + `ko.ts`; updated 5 render sites
- Korean copy: 순위 정하기 → 투표하기 / 재투표하기
- Loading UX: `nextjs-toploader` + skeleton screens for `/rankings`, `/rankings/[slug]`, `/album/[mbid]`
- Full-stack audit findings integrated into weekly roadmap
- DB architecture: keep PostgreSQL + Upstash Redis caching layer; Typesense post-launch
- KakaoTalk login: blocked (requires 비즈 앱 / 사업자등록번호); reverted to "coming soon"

**2026-05-16:**
- Dark mode: CSS variables, next-themes ThemeProvider, Light/System/Dark toggle in Settings
- 38 `bg-white` → `bg-page`, 21 `bg-ink text-white` buttons inverted for dark mode
- Logo: text-only on navbar with `dark:invert`; navbar height 58px
- Contact emails: `privacy@` + `legal@` → `admin@sillajuku.com`

**2026-05-14:**
- Password reset flow: forgot mode in AuthForm, `/auth/callback ?next=`, `/reset-password` page
- Auth layout: header removed, logo centered at top
- Signup: username field removed, duplicate email detection, cross-tab confirmation via onAuthStateChange
- Onboarding step 3: renamed → "Your Essentials", MAX_ALBUMS 10 → 6
- Email templates: `supabase/templates/confirmation.html` + `recovery.html`
- OG/social preview: `app/opengraph-image.tsx` + og/twitter metadata
- Homepage: `HomeReadyContext` + `RevealWhenReady` for coordinated load
- Explore page: renamed from ForYou/Lists, DB range() pagination, prestige fallback

**2026-05-13:**
- All 6 ranking categories seeded (kpop-all-time: 29/30 fuzzy + CHUNGHA via spotifyId)
- Homepage load: personalized API skips Spotify when DB has ≥10 albums; grids fade in together
- Recommendation variety: genre rows fetch 80 + shuffle; ForYou community pool top-60 shuffled to 20
- Deleted collisions, contradictions, wrapped pages; lists → explore (/explore); ForYouPage → ExplorePage
- Explore load more: DB pagination with `.range()`; prestige fallback; 5-artist cap removed
- Listen Later hero updated to match Rankings style
- Album page: hero overflow fix; "In Rankings" now shows rank number (#N)
- Add to Ranking modal: checkmarks on already-ranked categories

**2026-05-11:**
- Fixed CASCADE DELETE bug in ranking seed endpoint (upsert instead of delete+insert)
- Seeded RS500 "all-time" (467/500) and hip-hop subset "hiphop-all-time" (59/63)
- K-Pop 30-album dataset added to seed script
- Rankings: pagination (10/page + ellipsis + jump-to-page), silla score → cyan mint, rows clickable
- Rankings thumbnails: fixed to use real Silla Score formula
