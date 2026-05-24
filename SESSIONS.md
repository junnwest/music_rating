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
