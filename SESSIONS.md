# Session history

Historical record of shipped features and session notes. Not needed at conversation start — only useful for tracing why something was built a certain way.

---

## Session summaries (prepended — newest first)

**2026-07-08 (Windows, session 3) — pre-rebuild feature audit (3 revived, 1 declined) + micro-interaction pass:**

Audited everything the 07-06 reconstruction deleted (45 components + 12 route trees, from git history) for what still fits the current product:

- **Revived — written reviews on the album page:** the old `ReviewsSection`'s job. The Ratings & reviews section only showed avatar + score; `review_text` is now selected and rendered under each post. (It was already visible in the Home feed — the album page was the gap.)
- **Revived — "Listen" links on the album page:** the old streaming-platform feature's utility, minus the dead `preferred_platform` column (didn't survive the renovation — verified live). Three compact search deep-links (Spotify / Apple Music / YouTube Music) under the hero meta; no DB, no API.
- **Revived — genre navigation:** album-page genre text is now pill links to `/charts/ranking?genre=<g>`; the ranking drilldown reads the query param (Suspense-wrapped `useSearchParams`) and appends a custom chip when the genre isn't one of the fixed 8.
- **Declined — Daily Question:** API routes survive but the data is dead (latest `daily_questions` row 2026-06-29, 3 answers ever; nothing seeds questions). Not rebuilding UI on a stale pipeline — needs a question-seeding cron first if ever revived. Also declined: leaderboard/tierlist/essentials-era structures (superseded by Charts/Silla and mixes by design).

**Micro-interactions** (strict scope: transient surfaces only, all no-ops under `prefers-reduced-motion`): `sj-pop-in` (140ms) on the omnibox dropdown, avatar menu, bell popover, and peek card (inner wrapper — the outer element's positioning transform must not be clobbered by keyframes); `sj-modal-in`/`sj-fade-in` (180/150ms) on Modal panel + backdrop; `sj-heart-pop` scale bounce on like in FeedCard + ProfilePostCard. Deliberately NOT animated: page transitions, feed cards, list items — content should not move.

---

**2026-07-08 (Windows, session 2) — UX pass 2: everything else from the review (Library, header menus, error states, histogram, table view, peek cards, ranking filters):**

All remaining items from the 07-08 UX review, shipped in one pass:

- **Library tab on Profile** (`ProfileExtras.tsx` → `SavedLibrary`) — the feed's bookmark button finally has a surface: saved albums as a cover grid with hover-remove, own-profile only until `library_visibility` enforcement lands on web. Mock seeds + a `saved_releases` hydrator added so save→Library works offline too.
- **Rated table view** (`ProfileExtras.tsx` → `RatedTable`) — third display mode on Profile→Rated (desktop-only toggle): sortable columns (title/artist/type/score/date, aria-sort semantics), Excel-safe **CSV export** (BOM + quoting), rows link to album/song pages. The old sort dropdown hides in table mode since headers do the job.
- **Header menus** (`HeaderMenus.tsx`): avatar now opens an account menu (identity header, Profile, Settings, Sign out) instead of duplicating the Profile tab; the bell opens a **notifications popover** (recent 8, marks read on open, skeletons, View all → page). Notification row/select/body logic extracted to shared `components/sj/notifications.tsx`; the page reuses it.
- **Error ≠ empty** — Home feed tracks the pool-query error and shows "couldn't load" + Retry instead of the lying "No ratings yet"; the Charts Ranking block got the same failed-state + retry (which also busts the client memo).
- **Album rating histogram** (`RatingHistogram.tsx`, dataviz-skill-guided) — ten 0.5-wide buckets under the community stats, single-hue accent bars with rounded data ends and 2px gaps, per-bar hover values, the viewer's own bucket highlighted, `role=img` aria summary. Distribution computed from the ratings the page already fetches — zero new queries.
- **Hover peek cards** (`AlbumPeek.tsx`) — desktop answer to iOS long-press: hovering any album card/row on Charts (horizontal rails + Trending) or the Home trending rail shows a fixed-position card (cover, title/artist, live community avg + count, session-cached one query per album). Fixed positioning escapes `overflow-x-auto` clipping; any scroll dismisses.
- **Ranking drilldown filters** — `/charts/ranking` gains release-type (All/Album/EP) and era (2020s→1990s/Older) chips, filtering client-side on the fetched 100 (the silla RPC returns `release_group_type` + `release_date` since `20260706000018`; `SillaLeaderboardRPC` type extended, mock updated).
- **Tab a11y refits** — Artist page and Profile tab rows get `role=tablist/tab`, `aria-selected`, focus-visible rings; Artist's active underline switched from ink to accent to match the rest.

New i18n keys for all of it (en + ko). Verified: `tsc` clean, ESLint clean on all touched files, vitest 31/31, all 8 main routes 200 in mock mode.

---

**2026-07-08 (Windows) — UX pass 1: unified search omnibox (Search tab → Add), Silla badge trust fix, empty-state CTAs, accessible TitleTabs:**

Full web UX review done first (findings live in README → Known issues fix list + this entry), then implemented the top slice:

- **Unified search.** The top bar's dumb input (navigate-on-Enter only) is now `SearchOmnibox.tsx`: 200ms-debounced typeahead dropdown, ⌘K/Ctrl-K and `/` global focus shortcuts, arrow-key + Enter navigation, Esc dismiss, stale-response guard, "See all results for 'q'" → `/search?q=`. It's the single canonical search; the sidebar/bottom tab was renamed **Search → Add** (`CirclePlus` icon, `sj.nav.add` = Add/추가, matching iOS) since that page's real job is discovery + quick-rate. **`/api/search/suggest` was rewritten** — it was not just orphaned but *broken*, still querying pre-renovation columns (`releases.artist/release_type/prestige`, `artists.popularity`); now queries `release_groups` (3-arm prefix ilike incl. `native_title`, singles excluded, ordered by `prestige_score`) + `artists` (name/name_native), same Redis 10-min cache + CDN headers. Verified against the live DB (~3.8s cold on a broad prefix, cached after) and in mock.
- **Silla badge mislabel fixed** — the Ranking block's score badge (silla_score×5) was captioned "avg", which it isn't; now captioned **Silla** (실라) with a `title` tooltip explaining the score (`sj.charts.silla`/`sillaExplainer`). Drilldown badges were uncaptioned — left alone.
- **Home empty states got CTAs** — Explore-empty → "Rate your first album" button → `/search`; Following-empty → "Browse Explore" switches tabs. (The error-vs-empty distinction is still open on the fix list.)
- **`TitleTabs.tsx`** — shared page-title tab switcher (role=tablist/tab, aria-selected, roving tabIndex, arrow-key switching, focus-visible ring, animated accent underline). Fitted to Home (Explore/Following) and Charts (Albums/Songs); Artist/Profile tab rows are candidates for a later pass.

Remaining from the UX review (priority order): **Library surface for `saved_releases`** (bookmark button currently writes to a table nothing reads — biggest gap), avatar → dropdown menu (profile/settings/sign out), bell → notifications popover, error-vs-empty states, album-page rating histogram, profile Rated table view with sortable columns, hover peek cards, charts year/type filters.

**2026-07-07 (Windows, session 3) — offline mock backend for the web app (`npm run mock` + `npm run dev:mock`); fix list added to README Known issues:**

*Charts performance pass (same session, deployed):* with the DB incident over, re-measured live: everything recovered **except `get_silla_leaderboard` — ~7.2s even under service role** (live bayesian calibration over all ratings), i.e. permanently over anon's 3s timeout, so the web Ranking block 57014'd on every load (this was masked during the incident; "silla completes via API role" had only ever been checked without the anon budget). Web-side fix, no DB surgery (the silla function has a 4-round timeout-saga history and the Mac just rebuilt it for primary_genre): new **`/api/charts/silla`** route runs the RPC under the service role (8s budget, `maxDuration 15`) and caches via existing `lib/cache.ts` Redis (15 min TTL) + CDN `s-maxage`/`stale-while-revalidate` headers — first hit per filter combo is slow, everyone after is instant. `lib/sj/sillaClient.ts` adds a per-combo client memo; both `RankingBlock` and `/charts/[slug]` ranking now use it. Charts page also loads progressively now: only the unlock gauge gates the layout (was: whole page waited on `Promise.all` of 7 RPCs), the 3 songs-chart RPCs fetch lazily on first Songs-tab open, the Ranking block shows skeleton rows instead of "…", and filter switches dim the stale list in place instead of blanking it.

*Charts layout fix (same session, deployed):* below `lg` the charts grid stacks and the 10-row Silla Ranking block pushed Trending below the fold ("out the window"). `TrendingCard` (pure presentational, no fetching) now renders first in the stacked layout via a `lg:hidden` slot at the top of the grid, with the original right-rail copy wrapped in `hidden lg:block` — wide-screen layout unchanged.

*Follow-up fix (same session):* first in-browser run showed empty feed/charts even in mock mode — the CSP in `next.config.mjs` had `connect-src … https://*.supabase.co` only, so the **browser blocked every request to `http://localhost:54321`** (Node-side probes bypass CSP, which is why all 27 checks passed anyway). Fixed by appending the `NEXT_PUBLIC_SUPABASE_URL` origin to `connect-src` **only when it starts with `http://localhost`** (mock mode) — prod/normal dev CSP unchanged. Also made the mock's CORS preflight echo `Access-Control-Request-Headers`. Verified: served CSP now contains `http://localhost:54321`, preflight 204 with correct allow headers.

Built a standalone fake Supabase so the web app can be tested with zero network/database — motivated by prod being unusable during the `primary_genre` DB-load incident (Explore showed *"No ratings yet — be the first!"*, which is actually error-swallowing: the feed query times out and pages destructure `{ data }` ignoring `error` — added to the fix list). New files: `apps/web/scripts/mock/server.ts` (implements enough GoTrue + PostgREST: implicit-flow OAuth `/authorize` → hash tokens, `/user`, refresh/password grants, logout; REST filters eq/neq/in/gte/is/ilike/cs/ov + order/limit/offset, `Accept: vnd.pgrst.object` single-row semantics incl. PGRST116, `Prefer: count=exact` Content-Range, insert/upsert with per-table conflict keys, PATCH/DELETE, `/rpc/*`) and `apps/web/scripts/mock/data.ts` (pre-embedded dummy rows in the app's exact select shapes — FEED_SELECT embeds, notification `actor:`/`rating:` aliases, `releases→release_tracks→recordings` tracklist chain — 12 release groups, 8 artists, 6 profiles, ~24 ratings, likes/comments/follows/mixes/notifications, 16 RPC handlers; covers are data-URI SVGs, already allowed by the CSP's `img-src data:`). Plus `.env.mock` (committed, no secrets — empty overrides keep PostHog/Upstash/Spotify off) and package.json scripts `mock` / `dev:mock` (port 3100, `node --env-file=.env.mock` so it wins over `.env.local`). Sign-in mapping: Spotify/Apple → seeded `demo` user (onboarded), Google → fresh `newbie` (tests onboarding end-to-end; profile upsert works against the mock). Verified with a 27-check supabase-js probe using the app's real query strings (all pass) + Next dev in mock mode: /login, /, /charts all 200, `/api/check-username` correctly resolves against the mock server-side. Also added a prioritized **⚑ FIX LIST** to README → Known issues (stop the `primary_genre` backfill; error-vs-empty states; visibility web parity; replace hand-maintained `lib/db/types.ts` with `supabase gen types`; session-4 feature parity; `search_artists` at-risk) — `gh` CLI isn't installed on this machine, so the note lives in the repo rather than as a GitHub Issue.

---

**2026-07-07 (Windows, session 2) — web "stuck on onboarding / blank tabs" root-caused and fixed (schema drift from the Mac's visibility overhaul):**

Web bounced every signed-in user to `/onboarding` and all tab pages were blank. Root cause: `SessionContext`'s `PROFILE_COLS` still selected `profiles.listen_later_visibility`, but the Mac session-4 migration `20260706000012_profile_visibility_overhaul.sql` (applied live) renamed it to `library_visibility` — the select failed with 42703, `loadProfile` **silently ignored the error**, so `profile` stayed `null` and the "no username → /onboarding" redirect fired for everyone. Classic parallel-session merge casualty: web was rebuilt (Windows 07-06) against the pre-overhaul schema while the Mac shipped the rename the same day. Fixes, all in `apps/web`:

- `SessionContext.tsx` — `PROFILE_COLS` now selects `library_visibility, stats_visibility`; `loadProfile` logs errors and sets a `profileError` flag; the onboarding redirect is skipped when the fetch *failed* (fetch-failed ≠ never-onboarded — this is what made the bug a lockout instead of a console error).
- `lib/db/types.ts` — `ProfileRow.listen_later_visibility` → `library_visibility`, added `stats_visibility`.
- `settings/page.tsx` — privacy picker writes `library_visibility`; dropped the `'Followers only'` option (000012's new check constraint only allows Public/Private — saving it would 23514).

Verified with a live-DB probe (exact `PROFILE_COLS` select, anon + service): failed 42703 before, passes both roles after. `tsc --noEmit` clean. Full visibility-overhaul web parity (general toggle + Advanced inherit-when-NULL overrides + RPC enforcement) remains open — this was the minimal unbreak. Env vars were checked first and were NOT the issue (`.env.local` already complete on this device).

Follow-up (same day): user reported still stuck — because they were testing **production** (www.sillajuku.com), which it turns out HAD auto-deployed the rebuild from main (README's "not yet deployed" was stale) *with* the bug, while the fix sat uncommitted locally. Confirmed by grepping the deployed JS chunks for `listen_later_visibility` (present). Also end-to-end-verified the full onboarding `finish()` path with a throwaway auth user (sign-in → select → upsert → re-select: all pass; profiles RLS is fine — insert `auth.uid() = id`, select open). Committed + pushed (`b79212b`); polled prod until the new layout chunk went live — stale column gone, `library_visibility` present. **Do NOT revert to the pre-rebuild web** (user floated it): the old UI queries columns the 2026-06-24 renovation dropped; it is strictly more broken. Note: the `primary_genre` backfill incident was still running at this point (4 workers, 15,968/294,797 filled) — feed/trending/most-rated/silla/search still intermittently 57014 under anon until that Mac-side process is stopped; that is a separate issue from the onboarding lockout.

---

**2026-07-07 (Windows) — both timeout-fix migrations APPLIED live (new Management-API path); found an out-of-repo `primary_genre` backfill IO-starving the DB:**

Continuation of the 07-06 session-2 debugging. User supplied a Supabase personal access token (`SUPABASE_ACCESS_TOKEN` in `.env.local`, placeholder added to `.env.example` — **copy to the Mac's `.env.local`**), which unblocked applying SQL from this machine for the first time: new **`scripts/db-exec.ts`** posts a migration file (or `--sql "…"`) to the Management API `database/query` endpoint. No more SQL-editor-only bottleneck.

- ✅ **`20260706000016` (silla precomputed restore) applied + functionally verified** — `get_silla_leaderboard` returns rows again on both the global and country paths (was: never completed at any timeout).
- ✅ **`20260706000017` (search trgm indexes) applied + verified under anon** — the 3 GIN indexes were built with `CREATE INDEX CONCURRENTLY` (Management API runs them fine, ~37–48s each) to avoid blocking live writers. One live correction to the migration as written: hosted Supabase **denies `SET pg_trgm.word_similarity_threshold`** ("permission denied to set parameter" — extension-GUC grants, PG 15+), so the function keeps the operator's default threshold 0.6 instead of 0.5 (fuzzy-typo arm slightly stricter; substring arms + ranking unchanged). `search_release_groups` now passes under anon (~2.9s **during** the load incident below; expect far less on a quiet DB — was: hard 57014 always).
- **Why mobile "worked" while web was blank, confirmed empirically** (throwaway authenticated user, timed): `authenticated` gets the 8s statement timeout (like service), `anon` gets 3s — and the old search RPC sat at ~7.4–8.6s, i.e. on the knife's edge: iOS (authenticated, sequential queries, `try?` fallbacks) usually squeaked through warm; web (parallel queries, sometimes anon) died.
- ⚠️ **Open incident: an out-of-repo PostgREST client is bulk-updating `release_groups.primary_genre`** — a column that exists live but appears in **no migration in this repo** (nothing in the codebase references it at all; not pg_cron; no local process → likely a Mac-side script). `pg_stat_statements`: each UPDATE modifies **exactly 1 row in ~3.8s** (267 calls → 267 rows), 4 workers concurrent, 15,166 filled / **279,646 remaining** — days of runway. Every update rewrites a row in the index-heaviest table (HNSW embedding + 5+ GIN trgm indexes → non-HOT churn), IO-starving the Micro instance. This is what's behind today's across-the-board slowness (trivial PK-join embeds, feed, charts trending/most-rated intermittently 57014 under anon; `pipeline:status`'s own counts read 0 because its count(*)s time out). **Not killed** — terminating DB-side statements is whack-a-mole while the client retries; needs the source process stopped (user action) or a deliberate decision to let it run.
- Verification snapshot (anon, during the incident): search ✅ 2.9s, search_artists ✅ 1.3s, pulse/unlock ✅; silla/feed/trending/most-rated still 57014 — all load-victims now, not plan problems (silla completes in seconds via the API role). **Re-run `scripts/debug-web-queries.ts` once the backfill is stopped** — expect all green.

---

**2026-07-07 (Mac, session 5) — First TestFlight build shipped, own-profile mix-share feed, two small mix-page bugs:**

Started from "I shared a mix but can't confirm it worked" and ended up covering the whole rest of the mix-social loop plus the app's first real TestFlight upload.

- **Profile feed didn't show your own mix shares at all** — mix-share posts only ever rendered in the Home feed (`FeedPost` in `HomeView.swift`); Profile's Posts display mode only ever queried the `ratings` table, so a shared mix had genuinely no confirmation surface. Fixed by giving `ProfileViewModel` its own `mix_shares` fetch (reusing `HomeViewModel`'s `mixShareSelect`/`MixShareRow`/`hydrateCovers`, un-privated to `static`/internal so both view models share one query/cover-hydration path instead of duplicating it) plus like/comment counts and a `toggleMixShareLike`. A new `ProfilePost` enum (`.rating`/`.mixShare`) merges the two into one chronological feed for the Posts tab — merge only applies under the default "Recent" sort order, since top/bottom-rated and A–Z have no sensible slot for a score-less mix share.
  - Rendering was split into named `postCard`/`ratingCard`/`mixShareCard` functions **before** writing the inline version, not after — the exact `switch`-with-multi-arg-initializers-inline-in-a-`ForEach`/`LazyVStack` shape that caused session 4's 133GB Xcode RAM blowup in `HomeView`. Verified with a full `xcodebuild` Debug build both before and after the extraction (both succeeded, but the shape is a known landmine regardless of whether a given Xcode version happens to survive it).
- **Share → navigate to Profile.** On successful post, `MixShareComposerView` now fires a new `.mixShared` `Notification.Name`. `MainTabView` observes it and switches `selectedTab` to `.profile`; `ProfileView` observes it too and resets its own nav stack to root, switches to the Rated tab's Posts view mode, and calls `viewModel.reload()`. Popping the nav stack required converting `ProfileView` from a bare `NavigationStack {}` to an explicit `@State private var navPath = NavigationPath()` / `NavigationStack(path:)`, since a share composed from deep in Profile's own Lists tab (Mix pushed via `NavigationLink(value:)`) needed somewhere to pop back to — a plain `NavigationStack {}` has no externally-resettable path.
- **Two small live-reported bugs, both compiler-verified only (not yet re-tested on-device this session):**
  1. Mix page had two buttons both reading 편집 — confusing, since one is the hero's "edit mix details" button and the other is the system tracklist-reorder `EditButton()` (can't be relabeled, it's an Apple control). Renamed the hero button's catalog key (`mix.editButton`, both `Localizable.xcstrings` and the Swift `defaultValue`) to **"Edit Mix"/수정** so the two read distinctly instead of as duplicates.
  2. "Shared by" row under a mix's hero showed the same person twice if they'd shared the mix more than once — each share is correctly its own `mix_shares` row (each is its own feed post), but "Shared by" is about *who*, not *how many times*. Deduped by `userId` in `MixDetailView.loadMixSocial()` (query already ordered `created_at desc`, so keeping the first occurrence per user keeps the most recent share).
- **First-ever TestFlight build uploaded (Build 2).** `CURRENT_PROJECT_VERSION` had literally never been bumped past `1` since the project was created — bumped to `2` in `project.pbxproj` (both Debug/Release configs) since App Store Connect requires a unique build number per upload; verified with a full Release `xcodebuild archive` (signing resolved fine, automatic signing + team `GGJ5HX3A4M`). User did the actual Archive → Organizer → Upload in Xcode themselves (needs interactive Apple ID/2FA, no App Store Connect API key configured in this repo — discussed Xcode Cloud as a future automation option, not set up).
  - Delivery succeeded but flagged two informational-only warnings: **Sentry symbols upload failed** (Sentry's SPM product is a precompiled XCFramework with no bundled dSYM — only affects Apple's ability to symbolicate frames inside Sentry's own SDK, not this app's own crashes; widely reported elsewhere as benign, e.g. `getsentry/sentry-cocoa#6813`) and **ITMS-90892 missing 152×152 iPad icon** (cosmetic quirk of the modern single-1024px-icon asset catalog workflow — icon renders fine on iPad regardless).
  - The actual blocker for teammates (internal testers) was **"Missing Compliance"** — the export-compliance/encryption question had never been answered. Confirmed via code read that the app only does standard HTTPS (`URLSession`) plus one `SHA256` hash (`CryptoKit`, for the Sign in with Apple nonce) — no custom/proprietary crypto — so the correct App Store Connect answer is "None of the algorithms mentioned above." Also added `ITSAppUsesNonExemptEncryption = false` to `Info.plist` so **future** uploads skip this question automatically (doesn't retroactively fix Build 2 — that needed the one-time manual answer in App Store Connect, which the user did).

---

**2026-07-06 (Windows, session 2) — web RPC timeout debugging: 2 root causes found, 2 fix migrations written (⏳ both need applying):**

Post-reconstruction QA on the rebuilt web app found blank Charts-ranking and Search results. New probe script `apps/web/scripts/debug-web-queries.ts` (runs the exact browser-side queries under anon and `--service`) isolated two hard 57014 timeouts:

1. **`get_silla_leaderboard`** — a regression, not a new bug: `20260706000002_charts_release_type.sql` rebuilt every chart RPC "from its live definition" to add `release_group_type`, but for silla it copied `20260703000004`'s live-computation body — re-introducing the exact full-catalog shape the 07-05 timeout saga took 4 rounds to eliminate. Easy to miss because the durable fix (`20260705000002_silla_leaderboard_precomputed.sql`) lives only in the **root** `supabase/migrations/`, which `apps/web/supabase/migrations/` doesn't mirror. Fix: **`20260706000016_silla_leaderboard_precomputed_type.sql`** — re-applies the precomputed body verbatim (global path reads indexed `release_groups.prestige_score`, no join; country path keeps `enable_nestloop=off`) + adds `release_group_type` to the return, preserving 000002's intent.
2. **`search_release_groups`** — not a regression; a scale cliff. The WHERE is an OR of 5 branches and two were never index-backed (`word_similarity(...) > 0.5` as a bare function call is never an index qual; the `native_title` branch's `coalesce` wrapper matches no index) — one non-indexable arm forces the whole OR to seq-scan all ~295k release_groups computing `normalize_text()`×3 + `word_similarity()`×2 per row (~7.4s; anon's 3s timeout kills it, so the 20260630000000 trigram indexes were likely *never* used by this RPC — it was just tolerable at the 73k catalog it was written against). Fix: **`20260706000017_search_rg_trgm_indexed.sql`** — every OR arm becomes index-backed (`word_similarity` → the GIN-supported `<%` operator + function-level `SET pg_trgm.word_similarity_threshold = 0.5`; 3 new GIN trgm indexes: `lower(title)`, `lower(artist_display)`, `normalize_text(native_title)`). Same signature/return — no client changes. **Known caveat:** normalized queries < 3 chars ("iu") extract no trigram and still seq-scan; needs a separate short-query path someday.

Also observed, not yet explained: *intermittent* 57014s under service_role on trivial queries (`ratings` + `release_groups` embed, the feed select) that pass instantly under anon seconds later — smells like instance-level pressure (Micro Disk-IO burst / a concurrent heavy query), not a plan problem. Re-check after the two fixes land; if still flaky, look at the Supabase dashboard IO budget. `search_artists` passes but sits at 0.7–1.2s of a 3s anon budget with the same unindexable-OR disease (alias EXISTS + `word_similarity` arm) — flagged as at-risk, deliberately not touched.

**⏳ Next step: apply `20260706000016` + `20260706000017` in the Supabase SQL editor** (000017 builds 3 GIN indexes over 295k rows — run when quiet, ~30–90s each on Micro), then re-run `npx tsx --env-file=.env.local scripts/debug-web-queries.ts` (both roles) to verify.

---

**2026-07-06 (Windows) — WEB RECONSTRUCTION: rebuilt `apps/web` around the current schema + iOS product:**

Full rebuild of the web app per the reconstruction brief — the web UI was still the pre-renovation product (leaderboard seed-rankings, tierlists, essentials remnants, email/password auth, amber accent, `releases`-keyed queries against columns the 2026-06-24 renovation dropped). Discarded that UI wholesale and rebuilt it as the desktop sibling of `apps/ios`, reading every iOS screen + the live migrations first rather than trusting the (partly stale) written specs.

**Step 0 findings (mobile/web disagreements, all resolved toward iOS):** accent is blue `#2979B7` (iOS `Theme.swift` aliases `sjAmber → sjBlue` — the "amber theme" in older docs is stale); data paths were all pre-renovation; IA was pre-pivot; web still had email/password + reset-password; no Instinct mode, no song ratings, no mixes/charts/taste/unlock-gate on web; CSP didn't allow the Deezer-hosted artist avatars backfilled 07-01.

**What was built:**
- **Foundation** — `lib/db/types.ts` (canonical schema + RPC row types, hand-derived from migrations and cross-checked against iOS decode structs; `supabase gen types` can't run here — no DB URL/access token in `.env.local`); `lib/sj/display.ts` + `lib/sj/data.ts` (TS mirrors of `Release.swift`'s `isPredominantlyHangul`/display-name guards, `relativeTimeString`, `thumbnailUrl`, the ScoreSpectrum HSL math, and the iOS feed select strings); sj palette in `globals.css`/Tailwind (page/surface/ink/muted/divider from the iOS asset catalog, light + near-black dark, `accent` = sjBlue; legacy `mint*` tokens aliased to accent so retained pages restyle for free); `*.dzcdn.net` added to CSP img-src + image remotePatterns; legacy-route redirects.
- **Shell** — persistent sidebar (Home/Charts/Search/Taste/Profile + Settings) + top bar (global search box, notification bell with unread dot, avatar) on desktop, iOS-style bottom tab bar under `md`. `SessionContext` resolves session+profile once and redirects signed-in-but-unonboarded users to `/onboarding` (mirror of iOS `AppState`).
- **Auth/onboarding** — OAuth-only login (Spotify primary w/ taste scopes, Apple/Google behind "More options", decorative flowers, same layout personality as `AuthView`); onboarding rewritten to iOS's 4 one-question steps (name → username w/ live availability check → rating style → notifications), provider-name prefill; auth callback routes to onboarding when no profile row exists.
- **Rating flows** — `ManualRateModal` (slider 0.5–5.0 honoring `manual_rating_step`, post-rating comment + add-to-list step) and `InstinctModal` (bucket soft-seed → post-rating → ≤3 binary-search comparisons against the Elo-sorted list → reveal at 5 rated), both working for albums (`ratings`/`pairwise_comparisons`) *and* tracks (`track_ratings`/`track_pairwise_comparisons`), using the existing `lib/elo.ts` math verbatim.
- **Pages** — Home (Explore/Following feed with the iOS ranking heuristic, like/comment/save/report/block, desktop right rail = trending + suggested users); Search/Add (debounced `search_release_groups`/`search_artists` + recordings, quick-rate buttons, discovery sections From Your Taste/For You/Popular/Trending when empty); Album `[id]` (sticky cover column, credits via `get_release_group_credits`, mode-aware rating section, canonical-edition tracklist w/ per-track rating, community posts, public mixes); Song `[id]`; Artist `[id]` (uuid or name fallback, Albums/Songs/Community/Stats tabs); Charts (Albums/Songs modes behind `get_rankings_unlock_status` gauges, Silla RankingBlock w/ genre+country chips, Trending Global/For You, Most Rated, Hidden Gems/Controversial, Pulse) + `/charts/[slug]` drilldowns w/ podium; Taste (25-rating lock → full-bleed snap-scroll insight reel: Top Album/Activity/Style/Genre DNA via `get_user_genre_standings`); Profile (own + `/profile/[username]`: header stats, Rated list/posts modes w/ filters+sort+delete, Lists = mixes w/ create, Stats tab, follow lists modal, follow/block); Mix detail; Notifications (marks seen via `notifications_last_seen_at`); Settings (appearance/language/rating mode/precision/notification toggles/privacy visibility/legal/sign-out/delete via `/api/account/delete`).
- **i18n** — new `sj.*` namespace, full en + ko (~230 keys each), reusing the iOS glossary conventions (정규/EP/싱글, 인스팅트, etc.).
- **Deleted** — 12 legacy route trees (activity, explore, friends, leaderboard, my-rankings, rankings, listen-later, collection, genre, reset-password, old album/[mbid] + song/[trackId]) and 45 orphaned components; kept terms/privacy/help/admin pages and **all** API routes untouched (iOS calls `/api/search` and `/api/account/delete`).

**Deliberate desktop translations (not transplants):** bottom tab bar → sidebar; iOS sheets → centered modals reserved for transient actions; long-press context menus → hover-revealed buttons + explicit overflow menus; Home gains a right rail; Album page becomes a split layout; Taste's paging reel becomes scroll-snap sections; global search lives in the top bar instead of a tab.

**Verified:** `tsc --noEmit` clean, `next build` clean (54 routes), `next lint` clean (2 pre-existing warnings in `opengraph-image.tsx`), vitest 31/31.

**Known follow-ups (deliberately not guessed at):** replace `lib/db/types.ts` with `supabase gen types` output once a linked environment exists; web SEO/SSR for album/artist pages (rebuilt pages are client components mirroring iOS query paths — correctness first); avatar upload UI (profiles.avatar_url renders but no uploader — matches needing storage-bucket verification); Spotify top-artists discovery rows on web (`spotify_data_cache` exists, not yet wired); `packages/shared` is still the stale pre-renovation types (nothing imports it — superseded by `lib/db/types.ts`, left for a deliberate deletion); web push notifications UI beyond the permission prompt.

Also ran the due pipeline health check (separate commit): pipeline **not running** (heartbeats ~39h stale), queue fully drained (0 pending / 12,797 done), catalog at 295k release groups; moved cadence to weekly per the schedule.

---

**2026-07-06 (Mac, session 4) — Mix social features (like/share/edit), username format hardening, plus two live bug fixes and a build-memory scare:**

Started from three small fixes, then built a full social layer onto Mixes:

- **Public-mix link fix (`AlbumDetailView.swift`)** — the "In Public Mixes" row on an album page linked to the mix's *creator's profile* instead of the mix itself (`NavigationLink(value: UserProfileDestination(...))`). Fixed to a direct `NavigationLink(destination: MixDetailView(mix:))`, extending `AlbumPublicMix`/`loadPublicMixes` with the extra fields (`isDefault`, `createdAt`) `Mix` needs to construct.
- **Profile feed likers-modal fix** — tapping the like count on `ProfileView`'s `ProfilePostCard` did nothing (only Home's `FeedCard` had `LikersSheetView` wired). Added the same `Button { showLikers = true }` + `.sheet` pattern; fixes both your own Profile and other users' profiles in one change since they share `ProfilePostCard`.
- **Username format hardening** — audited every entry point (web onboarding, web settings, `/api/check-username`, iOS onboarding, iOS edit-profile) and found only web onboarding actually enforced anything; web settings and both iOS paths had zero length/charset validation, and the DB itself had no constraint at all. Unified on 3–20 chars, `[a-z0-9_]` (new `apps/web/lib/username.ts` / `Models/Username.swift` as the shared source of truth on each platform), added `20260706000014_username_format_constraint.sql` (`NOT VALID` so pre-existing bad rows aren't retroactively broken), and added `truncate`/`lineLimit` guards to ~9 UI spots (web + iOS) that could visually break on a long/legacy username, plus a truncation fallback in the two OG-image generators. **✅ Migration applied**, confirmed along with `20260706000015`.

**Mix social features (iOS only — web has zero Mixes UI today and was explicitly descoped by the user; "we will update everything on web once we have a solid 1.0.0 app"):**

Four requirements: mixes shareable as posts (with a caption, showing up to 10 overlapping album covers), likeable mixes, a real hero on `MixDetailView` (bio/like/share/owner-only edit), and a horizontal "shared by" row once a mix has ≥1 share. Planned via `/plan` first (three parallel Explore agents over the existing Mix model, the feed/likes/comments architecture, and web's actual Mixes status) since this touched new schema, a new feed-merge concept, and several new views — confirmed decisions: iOS only; anyone can share/repost a public mix, not just its owner; mix-share posts merge into the *same* Home feed as rating posts, sorted together; a share gets its own full like/comment thread separate from "liking the mix" itself.

- **Migration `20260706000015_mix_social.sql`** (applied live by the user this session): `mixes.description` (mixes had no bio field at all before), `mix_likes` + `mix_shares` + `mix_share_likes` + `mix_share_comments` (each a dedicated table mirroring `rating_likes`/`rating_comments`'s existing shape — this codebase's established per-entity convention, not a generic/polymorphic posts table), `notifications` extended with 3 new types (`mix_like`, `mix_share_like`, `mix_share_comment`) + matching `SECURITY DEFINER` triggers, `get_mix_covers(p_mix_ids, p_limit)` (a window-function RPC bounding cover lookups to 10/mix regardless of mix size), and `get_profile_mixes` rebuilt to thread `description` through (had to `DROP FUNCTION` first — Postgres won't let `CREATE OR REPLACE` change a `RETURNS TABLE` column list).
- **`MixDetailView`** restructured from a bare `List` into hero + conditional "Shared by" row + items, with `@State private var mix` (custom `init`) so an edit can update it in place without a re-fetch.
- **New files**: `EditMixView.swift` (rename/description/public-toggle/delete, gated off for the default "Listen Later" mix), `MixShareComposerView.swift` (caption + stacked-cover preview via `get_mix_covers`), `MixShareCard.swift` (+ `MixShareLikersSheetView`, structurally mirroring `LikersSheetView`), `MixShareCommentSheetView.swift` (mirrors `CommentSheetView.swift`), `Components/StackedCoversView.swift` (the overlapping "hand of cards" visual, reused by both the composer and the feed card).
- **`HomeView.swift`** gained its first-ever multi-source feed: a new `FeedPost` enum (`.rating`/`.mixShare`) that `HomeViewModel` fetches, ranks (Explore: same scoring algorithm, generalized — `releaseArtist` is `nil` for shares so that bonus term just doesn't fire), and renders through either `FeedCard` or `MixShareCard`.
- **Deliberately deferred**: Report on mix-share posts (`ReportSheet` is `private` to `HomeView.swift` and hardcodes `ratingId: UUID`; only Block is offered for v1 — widening it is a small, self-contained fast-follow, not a gap in the 4 stated requirements). Web Mixes UI (not started, by design).

**Three live bugs found after the first build, all fixed before this session ended:**

1. **A 133GB Xcode RAM spike** — traced to `HomeView.swift`'s `feedList`: a `switch` with two multi-argument view initializers (11 and 7 params respectively, several as closures) written *inline* inside a `ForEach` closure, itself nested inside `LazyVStack`/`ScrollView`/`ScrollViewReader`. This exact shape — heterogeneous branches with many-arg initializers inline in a deeply-nested `ViewBuilder` closure — is a known Swift type-checker explosion trigger (runaway memory instead of a fast diagnostic). Fixed by extracting to named `postCard`/`ratingCard`/`mixShareCard` functions; named function bodies type-check independently instead of compounding into one giant expression.
2. **Mix-like reverting instantly** (heart turns red, count increments, reverts within a second) — the optimistic-update/rollback code was correct, but the actual Supabase call was silently failing with no error logging at all (unlike this codebase's established convention of printing swallowed errors elsewhere, e.g. `EditProfileView`'s avatar upload). Added `print` to both `MixDetailView.toggleMixLike` and `HomeViewModel.toggleMixShareLike`'s catch blocks. Root cause is presumed to be the not-yet-applied migration (confirmed separately when sharing errored with "could not find table `mix_shares`" before the migration was run) — not re-verified live since the migration was applied.
3. **Share composer modal had a large empty area, and sharing itself failed** with "could not find the table `public.mix_shares`" (the migration genuinely hadn't been applied yet at that point — this was the direct cause, not a code bug). Separately fixed two real layout bugs while investigating: no `.presentationDetents` had been set at the sheet's call site at all, defaulting it to a full-screen sheet, compounded by a trailing `Spacer()`; and the stacked-covers area reserved a fixed 130pt height even with zero covers (which was *always* the case pre-migration, since `get_mix_covers` lived in the same un-applied migration). Fixed: `.presentationDetents([.medium])` at the call site, `Spacer()` removed, covers only shown `if !coverUrls.isEmpty`.

**Also**: the owner-only edit affordance on the mix hero was an unlabeled `ellipsis.circle` icon — changed to plain text "Edit" (편집 in Korean), added as a new distinct string-catalog key (`mix.editButton`) rather than reusing the app's existing "Edit"→수정 key (used elsewhere for rating edits) so as not to change that string's translation too. Hand-edited `Localizable.xcstrings` twice by mistake first (Python's default JSON serializer doesn't match Xcode's `"key" : value` spacing convention and reformatted the entire 4500-line file both times) before getting a clean, purely-additive diff.

Not yet rebuilt/clicked-through after this session's final round of fixes (error logging, edit button text, composer resize) — see README's "NEXT SESSION" block for the specific re-verification checklist.

**2026-07-06 (Mac, session 3) — Profile visibility overhaul + subtabs on other users' profiles:**

Settings' Privacy section previously had 3 independent Public/Followers-only/Private pickers (Profile, Catalog, Listen Later) that turned out to be purely decorative — auditing the actual RLS this session found `ratings`, `track_ratings`, `profiles`, and `lists`/`mixes` have always been fully open (`USING (true)` / public-mix-only policies with no follow-awareness), so no visibility setting had ever actually been enforced anywhere. Redesigned the model and built real enforcement for the first time:

- **New settings model**: a general Public/Private account toggle, plus an Advanced section with independent per-subtab overrides (Catalog/Library/Stats), each inheriting the general setting unless explicitly overridden (`NULL` in the DB = "same as profile"). "Followers only" removed entirely — Private now directly means followers-only (safe to remap, since nothing ever truly enforced private before).
- **Real enforcement, RPC-based, not RLS**: left the existing blanket RLS untouched (other features like leaderboards/global feed may depend on open reads) and instead gated access at a new RPC layer (`get_profile_subtab_access`, `get_profile_album_ratings`, `get_profile_song_ratings`, `get_profile_mixes`, all built on a shared `_sj_can_view` predicate — owner bypass → Public → Private-and-following). Catalog and Stats read the same underlying `ratings` rows but can have independently different effective visibility, which plain RLS can't express (same table, different gate depending on which UI surface is asking) — hence two separately-gated RPC calls rather than one shared array. Migrations `20260706000012`/`20260706000013`.
- **`UserProfileView.swift` full rewrite**: brought up to parity with the owner's own profile — same 3 subtabs (Rated/Lists/Stats), same filter+sort+list/posts-display-mode controls on Rated (that toggle didn't exist on the other-user view before), real per-subtab lock screens (mirrors `RankingsLockedView`'s visual convention) with a Follow button, since Private literally means followers-only now.
- Extracted `RatingStatsSnapshot`/`RatingStatsView` out of `ProfileView.swift` (verbatim copy of the existing math, `ProfileViewModel`'s own properties just delegate to it now) so the Stats tab logic isn't duplicated between the owner's and other users' profiles.
- `MixLibraryView.swift`: `MixRow` un-privated for reuse; `MixDetailView` now hides edit/delete affordances for a mix you don't own (RLS already blocked the mutation, but the affordance showing at all for someone else's public mix was a real UX bug).

Two real bugs caught and fixed mid-build, before ever reaching Xcode: `NavigationLink(value: mix)` would have silently failed to navigate (the `Mix` destination is only registered in the owner's own `ProfileView.swift` stack, not the several different stacks — Home, Search, comments — that actually present someone else's profile; fixed with a direct `NavigationLink(destination:)` instead), and a first-draft `instinctCount: 0` would have permanently hidden another person's Instinct-mode scores (the reveal threshold needs *their* catalog counts, not the viewer's).

**Two real Xcode build errors hit and fixed** (first actual build of this feature): `.toolbar(content:)` reported as "ambiguous," which was a cascading misdiagnosis from a `isOwnMix ? deleteItems : nil` ternary earlier in the same view (a bare method reference vs. `nil` — the type checker couldn't resolve it to `((IndexSet) -> Void)?`); fixing that same expression a second way then produced an outright compiler crash ("Failed to produce diagnostic for expression"), confirming it was a real ambiguity, not just a confusing error message. Resolved by replacing the ternary with an explicit closure literal (`guard isOwnMix else { return nil }; return { offsets in deleteItems(at: offsets) }`) instead of trying to type-annotate the ternary.

Both migrations applied live by the user via the SQL editor. Not yet rebuilt/clicked through after the second build-error fix.

**2026-07-06 (Mac, session 2) — Referral/quest system debugged live end-to-end; Connected Accounts settings screen built:**

Picked up the quest checklist + referral/invite system (Tiers 1–4, phone verification, custom app icon) from an earlier session's plan and root-caused four separate live bugs blocking it, each via real error text/source reading rather than guessing:

- **Twilio SMS send failing (error 20003)** — Supabase's SMS Provider dropdown was set to plain "Twilio" instead of "Twilio Verify" (a confirmed Supabase bug, `supabase/supabase#41963`). Fixed by switching the dropdown.
- **Phone verification failing with `otp_expired` despite a correct, fresh code** — looked like an OTP-expiry issue at first (Supabase's default is 60s), but Twilio's own Verify logs showed both attempts as **Approved, 1/1** — the code was right both times. Root cause, found by reading `supabase/auth`'s actual Go source (`internal/api/verify.go`, `internal/api/sms_provider/twilio_verify.go`): once Twilio approves a check, it's consumed — a second `/verify` POST (from a retry after an unrelated failure) always 404s and gets mislabeled `otp_expired` by gotrue's generic wrapper. The real failure was a *different* bug: `credit_referral_on_phone_verified()`'s trigger crashed with `relation "referrals" does not exist` because the function referenced `public.referrals`/`verified_phones` unqualified, and the role that fires `auth.users` triggers doesn't reliably have `public` in its search_path (same class of gotcha as Supabase's own documented `handle_new_user()` example, which always pins `security definer set search_path = public`). Fixed via migration `20260706000008` (`ALTER FUNCTION ... SET search_path = public`).
- **Avatar upload silently no-op'ing** — `EditProfileView.swift`'s upload catch block was swallowing the real error with just a comment, no print. Added a debug print, which revealed two stacked bugs: (1) the `avatars` storage bucket had never actually been created (migration `20260706000010` creates it + RLS policies), then (2) the write policies compared the path's folder segment to `auth.uid()` as case-sensitive text, but Swift's `UUID.uuidString` is uppercase while Postgres's `auth.uid()::text` is lowercase — same UUID, never equal as strings. Fixed by casting both sides to `uuid` instead of `text` (migration `20260706000011`).
- **Profile picture not appearing on the Profile tab after a successful save** — `ProfileView` and `QuestChecklistView` each own a separate profile-fetching view model with no shared state; only the checklist's reloaded on the edit sheet's dismiss. Fixed with a `.sjProfileUpdated` NotificationCenter broadcast (same pattern already used for `.ratingChanged`/`.followChanged`), posted from `EditProfileView.save()`, observed by `ProfileView`.

Also shipped, per explicit product decisions this session:
- Quest checklist's "Connect your phone number" row now shows "Verifying gives whoever invited you credit" when the account was itself redeemed via someone else's code and isn't yet phone-verified — this was previously completely invisible (redemption happens silently via clipboard/Universal-Link detection on first launch, no UI at all).
- `PhoneVerificationView` no longer shows a misleading "the person who invited you got credit" message unconditionally on every successful verification — only when this account was actually redeemed via a referral code.
- Entering a phone number already verified on another account now shows a clear message ("already connected to another sillajuku account") instead of a generic failure. **No account-merge flow** — user explicitly chose to defer that (real scope: whose data wins, proving ownership of both accounts) rather than build it speculatively.
- New **Settings → Connected Accounts** screen: shows Spotify/Apple/Google link status with connect/disconnect (`linkIdentity`/`unlinkIdentity`), blocks disconnecting your last remaining sign-in method, and shows phone status (masked) with connect/disconnect. Disconnecting a phone number does **not** revoke referral credit already earned (permanent ledger entry, user's explicit call) but does free the number for reuse (new `disconnect_phone()` SECURITY DEFINER RPC, migration `20260706000009` — required because gotrue's own UpdateUser API, self-service and admin both, can never clear a phone to null; confirmed by reading the source, both gate on `if params.Phone != ""`).

Confirmed already fully built from the earlier session's plan (re-verified against actual files, not assumed): Universal Links (`sillajuku.entitlements` associated-domains + `/.well-known/apple-app-site-association/route.ts` + `onContinueUserActivity` handler), custom app icon (all 7 `AlternateIcons/*.png` variants + `Info.plist` `CFBundleAlternateIcons` + Settings picker).

Not yet live-tested (code complete, unverified in practice): Universal Links tap-through on a device with the app already installed, clipboard handoff on a genuinely fresh install, the 5-verified-invite icon unlock (needs real invite volume), the new Connected Accounts screen (built this session, not yet rebuilt/clicked through).

Five new migrations this session: `20260706000008` (referral trigger search_path), `20260706000009` (disconnect_phone), `20260706000010` (avatars bucket + RLS), `20260706000011` (avatars RLS uuid-cast fix). All applied live by the user via the SQL editor.

---

**2026-07-06 (Windows) — slow album covers: root-caused + caching edge proxy:**

User: some covers still load slowly despite an earlier "fix." Root cause found in data: **~95% of album/EP covers are Cover Art Archive** (`coverartarchive.org/.../front-500`), only ~4% iTunes. CAA URLs **307-redirect to archive.org** — measured a real one at **5.3s** first-load for a 29 KB image (the redirect + archive.org origin, not bytes). The earlier `thumbnailUrl` fix only shrank *dimensions* (`front-500`→`front-250`, `600x600bb`→`300x300bb`); it never touched the redirect, which is the dominant latency for 95% of covers. The instant ones are either already-URLCache-cached or the ~4% direct-from-iTunes-CDN covers.

Fix (option chosen over the pre-built `backfill-fast-covers.ts`, which needs a huge IO-blocked DB rewrite + reintroduces iTunes dependency): a **caching edge proxy**, no DB write.
- **`apps/web/app/api/img/route.ts`** (new, edge runtime) — follows the CAA→archive.org redirect once server-side, returns the bytes with `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` → the Vercel edge caches each image; every client after the first gets an instant CDN hit. SSRF-guarded host allowlist (coverartarchive.org / archive.org / mzstatic.com / dzcdn.net).
- **iOS `Theme.swift` `thumbnailUrl`** — one edit routes only CAA/archive.org URLs through `{webBaseURL}/api/img?url=…` (iTunes/Deezer already fast → left direct). Because nearly every cover flows through the shared `CoverImage` → `thumbnailUrl`, this one change covers the whole app (all `CoverImage` sites + the RankingsView/SearchView prefetchers) with no per-site edits.
- **⏳ To activate:** deploy web (route goes live) + build iOS on Mac (xcodebuild broken on this Windows box).
- 🔴 **BROKEN ON PROD (found 07-08): the deployed `/api/img` returns 502.** The SSRF guard works (403 for bad hosts), but the legitimate CAA fetch fails **fast** (~1s, not a timeout) — almost certainly **archive.org throttles/blocks Vercel's datacenter IPs** (a known archive.org behavior; it allows residential/mobile IPs, which is why the local test worked). So an edge proxy fetching archive.org server-side is the wrong shape. **Not yet fixed.** The robust fix is the same side-table pattern as `primary_genre`: resolve each CAA URL to its direct `ia*.archive.org` image URL **once from an allowed IP** (a local script), store it, and have the client fetch that directly (no Vercel hop, no redirect). Confirm the IP-block hypothesis first with a 2-line diagnostic redeploy (surface the upstream status in the 502 body). Until fixed, the iOS `Theme.swift` change is moot — building iOS now would route covers through a 502. **Consider reverting/guarding the iOS change until the proxy works.**

---

**2026-07-06 (Windows) — genre hierarchy: primary_genre to stop k-pop polluting the style charts:**

User flagged that a k-pop album tagged both k-pop and hip-hop shows up in the Hip-Hop ranking. Confirmed the leak in data: genre charts filter by array MEMBERSHIP (`_rg_has_genre(rg.genres, p_genre)`), and **~60% of k-pop albums carry a generic style co-tag** (193/400 tagged `pop`, 60 `hip hop`, 44 `electronic`, 13 `contemporary r&b`) — so they leak into Pop/Hip-Hop/Electronic/R&B.

Decision (asked the user): **scene-first** hierarchy — national scenes (Korean, then Japanese) outrank cross-cutting styles; each album gets ONE `primary_genre`, and charts match against it only. Chosen so the stored value substring-matches the existing client slugs (k-pop/hip-hop/rock/electronic/indie/r&b), so **no iOS/web change** and the RPC signatures are unchanged.
- **`scripts/backfill-primary-genre.ts`** — ordered scene-first precedence (specific Korean scenes → k-pop umbrella → Japanese → Western styles specific→generic; fallback to the album's own first tag). Validated on an 8k sample: clean distribution, and **all 261 k-pop-primary albums that still carry a style tag now leave the Hip-Hop/R&B/Electronic charts.** IO-safe writes (50-chunk + retry).
- **Migration `20260706000001_primary_genre.sql`** — adds `primary_genre` column + `_rg_primary_matches()` helper (falls back to whole-array while null, so no empty-chart window), and swaps the genre filter in the 4 genre charts (`get_charts_top_rated`/`most_rated`/`hidden_gems`/`trending_for_genres`) to match primary only. Server-side `_compute_primary_genre` + resumable `backfill_primary_genre_proc()` in `20260706000002`.
- **✅ Post-merge reconciliation (07-07, session 3):** pulled the Mac's 21-commit push (web rebuild + sessions 4–5). Got `SUPABASE_ACCESS_TOKEN` + used the Mac's new `scripts/db-exec.ts` (Management API) to **verify the live filter state**: the 4 genre charts **survived** the Mac's parallel `charts_release_type` migration (all still `_rg_primary_matches`). Then **completed the deferred `get_silla_leaderboard` swap** — dumped its exact live body via `pg_get_functiondef` (the 07-05 timeout fix intact: `enable_nestloop=off`, precomputed-prestige global path), swapped its 3 genre-filter predicates, and applied as `20260706000018_silla_leaderboard_primary_genre.sql`. **All 5 genre-filtered RPCs now on PRIMARY.** No effect until the backfill runs (fallback keeps membership behavior while `primary_genre` is null).
- 🔴→✅ **The "07-07 DB-load incident" was orphaned processes, not a daily IO quota.** `TaskStop` detached the harness tasks without killing the node procs, so ~4 backfill runs (~8 procs — the "4 workers" the Mac saw) wrote concurrently for *hours*, IO-starving prod. Killed via `Stop-Process` (0 remaining); the instance recovered instantly. **Direct metrics confirmed it was disk IO, never CPU/RAM:** CPU 1%, disk-IO 0.3%, iowait 0.1% once idle. **Lesson: kill backfills by PID, not `TaskStop`.**
- 🔴→✅ **Root architectural fix (session 3).** Even on a healthy idle instance, a **400-row UPDATE to `release_groups` times out at 120s** — it carries an **HNSW vector index + 7 GIN trgm indexes**, so every row-update maintains all 13 (HNSW graph maintenance is the killer). The `primary_genre` COLUMN (`20260706000001/2`) is therefore **unfillable at any rate**. Fix: a **side table `rg_primary_genre`** — a 3,644-row INSERT ran in **6.5s** (vs the 400-row UPDATE failing at 122s). `20260706000019` recreates all 5 genre RPCs to `LEFT JOIN rg_primary_genre` (`pg.primary_genre`); `20260706000020` adds a trigger to populate a rated album's row on first rating (durability). Populated for the **chart-eligible set only** (rated ∪ prestige = 3,644 — the only albums a genre chart can surface). **Verified live: k-pop-primary albums in the hip-hop chart = 0, in the k-pop chart = 500. Fix complete + working.** The dead `release_groups.primary_genre` column + `backfill_primary_genre_proc` are left unused (a DROP COLUMN would rewrite the indexed table).
- ⚠️ **Migration-number collisions** (cosmetic, both applied live): my `000001`/`000002` vs the Mac's `000001_rankings_unlock_targets_raise`/`000002_charts_release_type`.
- **Also this session:** a caching cover proxy for slow CAA covers (entry above).

---

**2026-07-06 (Windows) — merged Mac's unlock-gate push + executed its flagged coverage action item:**

Picked up the Mac push (`672eae4`: Liquid Glass score badge, Instagram share, **Rankings unlock gate**). Merged into the local bot-work commits (`ed08473`/`4107e88`) — only conflict was the SESSIONS newest-first ordering (resolved by interleaving: Mac 07-06 → Windows 07-05 density → Mac 07-05 badge); README auto-merged. The unlock-gate migration (`20260706000000`) was already applied by the user on the Mac side.

**Executed the Mac's explicitly-flagged Windows action item** — "prioritize zero/low-coverage prestige albums before re-rating popular ones." The gate (`get_rankings_unlock_status`) needs BOTH 10,000 album events AND 350 prestige-pool albums with ≥3 ratings; live status was **8,057 / 213** — locked. The initial seeding had concentrated on the ~380-album critic canon, leaving the broader 1,582-album prestige pool under-covered.
- New **`scripts/topup-prestige-coverage.ts`**: walks the prestige pool **coverage-first** (0-rated albums first, then by prestige), tops each to 3–6 ratings from **origin-matched bots** (Korean album → Korean-persona bots, via `artists.native_language`), quality-anchored scores (`2.6 + prestige·2.0 + persona bias + noise`) + language-matched reviews, backdated, seeded, idempotent (skips existing (bot,album) pairs), dry-runnable. Stops as soon as both gate conditions clear with headroom.
- **Result: +2,195 ratings across 534 low-coverage prestige albums → events 8,057→10,252, coverage 213→747. `album_unlocked` flipped to `true`** (verified live via the RPC). Songs stay locked (5/2,500) — the Mac's deliberate deferral, not touched. Ratings fire no notification triggers, so no push-webhook involvement.

---

**2026-07-06 (Mac) — Rankings/Charts collective unlock gate built:**

Long design thread the day before (SillaScore-vs-ratings visual confusion → "should we defer launching Rankings" → "or lock it like Taste, but collective") landed on: Charts stays locked behind a simple per-user-visible gauge ("X / N ratings"), separately for albums and songs, until the community (bots + real users) collectively crosses it.

Getting the threshold right took real investigation, not a guessed number: live-queried the DB mid-bot-seeding and found 8,057 album ratings already existed — 16x past an initially-proposed N=500 — while only 303/1,589 (19%) of the Silla leaderboard's prestige-eligible pool had been rated *at all*, because bot volume was concentrating on already-popular albums (top individual counts: 42, 41, 40...). Proved empirically that a pure volume counter doesn't correlate with "is the leaderboard actually good."

Drafted a review prompt with the real numbers and sent it to 3 external LLMs for a second (and third, and fourth) opinion — all converged on the same shape (volume alone is provably unreliable; needs a coverage floor), diverged on the actual K. Resolved the disagreement with one more real query: current prestige-albums-with-≥3-ratings = **213**, and the leaderboard's own display depth is **100** (`p_limit: 100` in `RankingsView.swift`) — which ruled out the smallest proposed K (150, already passed, no visible progress left) and grounded the final target in real headroom over the actual display size rather than an arbitrary fraction of the whole pool.

**Final design — user sees one number, server enforces two:**
- Visible gauge: `events / target` ratings, nothing else, per the user's explicit call that a second visible metric ("prestige albums with 3+ ratings") would be confusing.
- Hidden gate (`get_rankings_unlock_status` RPC, migration `20260706000000_rankings_unlock_gate.sql`): albums unlock at **10,000 total events AND 350 prestige-pool albums with ≥3 ratings** (the 3-rating figure matches `get_silla_leaderboard`'s own Bayesian shrinkage prior exactly, not a separately-chosen constant). Songs: **2,500 events, no coverage condition yet** — deliberately deferred, same reasoning as everywhere else this data has come up: `track_ratings` has 5 rows, nowhere near enough to size a real threshold from.
- `RankingsUnlockStatus` (Swift) only decodes the fields the UI is allowed to know about — the coverage numbers exist in the RPC response but are never modeled client-side, so the "hidden" part is structurally hidden, not just unused.
- New `RankingsLockedView` replaces chart content per-mode (Albums vs Songs unlock independently, matching the two separate gauges) — flower icon, one-line framing ("Building the Albums chart together"), a plain progress bar, `X / Y ratings` — no prestige/coverage language anywhere in the UI.

**Also surfaced, not yet actioned:** all 3 external reviews independently suggested the deeper fix is the bot-seeding order itself — prioritize zero/low-coverage prestige albums before re-rating popular ones — which would make the real N and K converge faster than tuning the gate can compensate for. That's a Windows-side script change, flagged for the next handoff, not something built this session.

**Migration applied** (user ran it directly in the Supabase SQL editor) — `get_rankings_unlock_status()` is live.

**First Xcode build of the session — one real compile error, fixed:** `MainTabView.swift`'s dark-mode tab-icon fix (from 2026-07-05) used `UIImage(dynamicProvider:)`, assumed to mirror `UIColor(dynamicProvider:)` — it doesn't exist; that API is `UIColor`-only. Replaced with two pre-rendered static images (`addTabImageLight`/`addTabImageDark`) picked via `@Environment(\.colorScheme)` at the call site, which gets the same live-switching behavior through normal SwiftUI re-evaluation instead of UIKit's (nonexistent, for images) dynamic-provider mechanism. **Build succeeded after the fix.**

**Click-through pass, live on device — 5 of 7 confirmed working:** `ScoreBadge` rendering, `ProfilePostCard` heart/comment now actually functional, the songs-reveal fix, the Rankings locked gauge (English), and the Instagram share preview flow all check out. Two follow-ups from what the user found:

- **Heart/comment icon color** — both `FeedCard` and `ProfilePostCard` used `Color.sjMuted` for the resting-state icon; changed to `Color.sjInk` (adaptive black/white) in both, keeping them in parity per the earlier pass.
- **Rankings locked gauge wasn't localized to Korean.** Root cause was two different things at once: the `%@`/`String(format:)` progress line and one of the two headline strings *were* already correctly extractable (Xcode's build-time scan found them — `Text` treats inline string-interpolation and literal-ternary arguments as `LocalizedStringKey` automatically), but the subtitle line originally used runtime interpolation of a ternary *inside* the string (`"...enough \(kind == "album" ? "albums" : "songs")..."`), and partway through this session it got refactored to computed `String` properties for clarity — which changed the actual catalog keys being referenced, orphaning the auto-extracted entry. Added Korean translations for all 5 real strings (`Building the Albums/Songs chart together`, the two subtitle variants, `%@ / %@ ratings`), reusing the app's existing vocabulary (앨범/곡/평가) rather than inventing new terms, and removed the now-orphaned auto-generated key.

Confirmed unverifiable for now, both correctly deferred rather than chased: pulse-card dark mode (screen is locked, matching the new gate — can't be seen until real data crosses the threshold) and the add-tab icon dark mode (visually confirmed done).

One more round: heart/comment icons bumped from default (regular) to `.medium` weight in both `FeedCard` and `ProfilePostCard`, per user feedback that they read too thin. Korean localization confirmed done by the user.

---

**2026-07-05 (Windows) — bot community-density pass (concentration + multilingual reviews + scale to 150):**

Follow-on to the bot-population work below, driven by a "would a new user feel this is an active community?" data review. Measured the pilot's actual signals and found the answer was **no beyond a first glance**: 2,106 album ratings but only **18 from real humans**; **1 review in the whole app**; ratings smeared across 1,516 albums with **1,110 rated exactly once and a max of 7** — so the feed looked busy but every *album page* (the thing a user actually opens) was a ghost town. Social was near-zero (6 follows / 8 likes / 1 comment).

Root cause: `generate-bot-ratings.ts` sampled each bot's ~80 ratings independently from huge pools (west=50k), so two bots in the same persona had ~zero overlap. Fix = **shared-canon concentration**:
- New sampler: **canon core + discovery tail**. Each bot rates a high fraction (55–80%) of its bucket's *shared* canon, drawn from the CRITICAL `external_scores` via `get_critics_picks` (ko=86, ja=14, western capped at 280 so it stays concentrated), plus a smaller individual discovery tail for feed variety. Many bots converge on the same canon albums → real depth. Thin niche intersections top up from the pool's prestige tier. Removed the now-dead two-tier `wpick`/`prestigeShare`.
- **`scripts/data/bot-reviews.ts`** (new) — persona-voiced, **language-matched** short reviews: bucket `ko`→Korean, `ja`→Japanese, `western`→English (Korean bots with Hangul display names now write Korean, per user note). Sentiment-conditioned (LOVE/LIKE/MID/PAN banks per language), ~25–30% of ratings (biased to strong scores), never names tracks/years (can't state a false fact). Positive persona-flavor clauses only lead *positive* reviews (killed "guitar tone is gorgeous — more hype than substance" contradictions); repeats deduped within a bot.
- Scaled the roster **26 → 150** (`create-bots.ts`, the full persona-defined counts). Deleted the old 2,088 spread/review-less bot ratings (real users' 18 untouched; likes/comments cascade), cleared state, regenerated.

**Result (re-measured live):** album ratings 2,106→**8,057**; reviews 1→**1,425** (language-matched); albums with ≥5 ratings 7→**457**, ≥10 → **254**, ≥20 → **50** (max 42); **Korean critic-canon 84/86 albums rated, avg ~18.8 each** (was ~1). `get_charts_top_rated` (Bayesian min-3) returns a full board. Dry-run + `tsc --noEmit` verified before the prod run.

**Social pass — done (same session).** New **`scripts/generate-bot-social.ts`** — **bot-on-bot-only** follows / likes / comments. Follows are taste-biased (50% same-persona, 30% same-bucket, 20% any); likes concentrate on canon / high-score posts (weighted); comments are sparse + **language-matched to the commenter** (`commentFor` added to `bot-reviews.ts`). All backdated into the signup→now window, seeded, `ignoreDuplicates` on the composite-PK tables, and gated against double-runs (`--force` to override). Inserted **842 follows / 850 likes / 55 comments** → feed engagement is no longer 0/0 (774 posts have ≥1 like; all 150 bots have a follower).

**Safety verified:** every `like`/`comment`/`follow` insert fires a notification trigger → a **pg_net→APNs push webhook** (confirmed live/configured). Kept strictly bot-on-bot so real users are never targeted. Post-run leak check: **0** bot→real follows, **0** bot likes/comments on real ratings, and the only 12 real-user notifications are all pre-existing (newest 2026-07-03, predating the run) — **the 17 real users got zero fake notifications.** (Likes tunable: max 3 per post currently — realistic for a young community; tighten the like pool if more "hot post" social proof is wanted.)

---

**2026-07-05 (Mac) — new score badge (Liquid Glass + spectrum ring) built and wired into the live feed:**

Worked through the Instagram share-card design in an Artifact across many rounds before touching any Swift — landed on: a Liquid Glass circular badge (iOS 26's real `.glassEffect()` material, not a hand-rolled blur), a white flower watermark + score number in an elongated System Sans (`Font.Width.condensed` + a slight vertical scale), and a progress ring around the badge where arc length is `score / 5.0` and arc color follows a red→sjBlue hue spectrum (`hue = 205.7° × (score − 0.5) / 4.5`) — two deliberately different formulas for two different jobs (fraction-of-max vs. mood-color).

Built `Components/ScoreBadge.swift`: `ScoreSpectrum` (the hue/color math, including a custom `Color(hslHue:saturation:lightness:)` initializer — SwiftUI's native `Color(hue:saturation:brightness:)` is HSB, not HSL, and would NOT reproduce the same colors) + `ScoreBadge` (the glass circle + ring view).

Wired into the two live spots that showed scores as a flat blue pill before: `HomeView.swift`'s `FeedCard.scoreView` and `ProfileView.swift`'s `ProfilePostCard` (smaller, to match its narrower inline layout). Removed both files' duplicated `scoreLabel()` rounding helper (`4.0`→`"4"`) since `ScoreBadge` always formats to one decimal internally — the "always show X.X" fix from earlier in the week, now actually live instead of just planned.

**Confirmed before building:** deployment target is `26.0` everywhere in `project.pbxproj`, so `.glassEffect()` needed no `#available` fallback gating.

**Two bugs caught after a real build + test** (user ran it in Xcode): (1) some scores rendered as "3…"/"4…" — different digit glyphs at that weight/condensed-width combo have slightly different advance widths, and the `Text` had no scale fallback, so borderline widths truncated instead of shrinking. Fixed with an explicit width + `.lineLimit(1)` + `.minimumScaleFactor(0.6)` so every "X.X" now guarantees no ellipsis regardless of which digits render widest. (2) the ring sat visibly apart from the badge — root cause was the API shape itself: `size` was the *outer* ring diameter with the badge derived as a fixed 75% fraction of it, so the gap was arbitrary rather than intentional. Reworked the parametrization so `badgeSize` (the glass circle) is now the primary input and the ring is derived as `badgeSize + 2×(ringGap + ringStroke)` — a small, explicit, always-tight margin instead of a proportion that happened to leave a gap. Call sites updated (`HomeView`'s default of 48 unchanged; `ProfileView`'s explicit call moved from `size: 44` to `badgeSize: 33` to preserve the exact prior badge size).

**Not yet re-verified live** — the two fixes above are logic-correct on paper but need another Cmd+B + on-device check to confirm the truncation is actually gone and the ring now hugs the badge as intended; `#Preview` in `ScoreBadge.swift` gives a fast visual check without a full app run.

**Follow-up: `ProfilePostCard` brought to visual parity with `FeedCard`.** User noticed the Profile tab's own-posts view looked different from Home's feed cards — diffing them found real drift beyond the badge: cover 72px vs 80px, title 15/13pt vs 17/14pt, corner radius 14 vs 16, action-bar icons 15pt vs 19pt, and `bubble.right` vs the `bubble.left` fix already applied to Home (2026-07-02 session) that never made it to Profile. Unified all of it in `ProfileView.swift`.

**Three more bugs fixed, same session:**

1. **`ProfilePostCard`'s heart/comment were static decorations, not buttons** — user caught this after I flagged it as a known limitation. Wired real interactivity: added `likedRatingIds`/`toggleLike(ratingId:)` to `ProfileViewModel` (same optimistic-update + `rating_likes` insert/delete pattern as `HomeViewModel.toggleLike`), and a local `CommentSheetView` sheet for the comment button (it already defaults to self-loading when no `preloaded` comments are passed, so no extra plumbing needed there). While wiring this, also **moved the `NavigationLink` from the call site (wrapping the whole card) to just the album row inside `ProfilePostCard`** — the old structure nested the new heart/comment `Button`s inside an outer `NavigationLink`'s label, which `FeedCard` deliberately avoids by scoping its `NavigationLink` to only `albumSection`. Matches that pattern now instead of relying on nested-button hit-testing working out.

2. **Profile → Songs: 4 rated songs weren't appearing.** Traced with a live DB query (service-role script) — the 4 `track_ratings` rows exist with real `recording_id`/title data, but `score` was `null` on all of them. Root cause: `InstinctTrackRatingViewModel.finalize()`/`vote()` (song rating flow) only write the human-readable `score` column once a user has rated **5+** songs total — below that threshold, the rating only exists as `elo_score`. That's the same gating pattern albums use (`instinctAlbumCount >= 5`), and it's by design there because the album read path (`RatingListRow`, already correctly built with a `score → elo_score (if threshold met) → nil` fallback and a "Rate N more to reveal" state) doesn't depend on `score` ever being written. The **actual bug** was that this fallback was never fed for songs: `ProfileViewModel`'s song query didn't select `elo_score` at all (`SongRatingRow.eloScore` was hardcoded `nil`), and the call site passed `viewModel.instinctAlbumCount` as the threshold for song rows too, instead of a real per-song count. Fixed: query now selects `elo_score`, `SongRatingRow` maps the real value, added `instinctSongCount`, and the call site picks the right count based on `item.isSong`. Songs under the reveal threshold now correctly show "Rate N more to reveal" instead of nothing.

3. **Charts pulse card (total ratings / community avg / rated today) was hardcoded dark regardless of system appearance.** `PulseCard` used literal `Color(red: 0.10, green: 0.10, blue: 0.10)` for its background and `Color.white.opacity(...)` for the divider/label instead of the app's adaptive color assets (`sjSurface`/`sjBorder`/`sjMuted`, which have real light+dark variants defined in `Assets.xcassets`). Swapped in the adaptive colors in `RankingsView.swift` — the card now actually follows system appearance like every other card in the app.

**Not yet verified live** — none of today's fixes have been through an Xcode build/run in this session; needs a Cmd+B pass to confirm before considering any of them closed.

**One more layout miss caught after the visual-parity pass:** `ScoreBadge` had been nested *inside* the title/type-artist `VStack` (stacked below the text) instead of being a sibling in the outer `HStack` — so it sat left-aligned under the text instead of pinned right and vertically centered against the cover, unlike `FeedCard` where cover/text/badge are three siblings in one `HStack` (default `.center` alignment does the vertical centering for free). Moved it out to match.

**Instagram Story share feature built** (the original ask that started this whole design thread). Three new pieces:
- `Components/ShareCardView.swift` — the approved card design (header minus ⋯ menu, album row with `ScoreBadge`, review text if present, `logo-flower` brand mark top-right). Takes a pre-loaded `UIImage?` for the cover, not a URL — `ImageRenderer` snapshots whatever's already resolved, so an in-flight async image load would export a blank shimmer instead of the real cover.
- `Components/InstagramShare.swift` — downloads the cover, renders the card via `ImageRenderer` (transparent, `isOpaque = false`), and hands the PNG to Instagram via the documented pasteboard contract (`com.instagram.sharedSticker.stickerImage` etc.) + `instagram-stories://share`. Falls back to the plain system share sheet (`ImageActivityShareSheet`) if Instagram isn't installed or the pasteboard handoff fails.
- Wired a share button into `AlbumDetailView`'s already-rated state, both manual and Instinct modes, next to Edit/Re-rank.
- Added `LSApplicationQueriesSchemes: [instagram-stories]` to `Info.plist` (required for `canOpenURL` to ever return true for a non-system scheme) and `Config.instagramFacebookAppID` (nil by default — needed for Instagram's own tap-back attribution, inert until a Facebook App ID exists, same "public config, dormant until set" pattern as the Sentry DSN).

**Real open risk, not yet checked:** `ScoreBadge` uses `.glassEffect()`, which blurs whatever's live on screen behind it — that works great in the actual feed, but inside `ShareCardView` it's being rendered *off-screen* via `ImageRenderer` for the export, with no real backdrop for it to blur against. What that actually produces (a plain translucent circle, most likely — glass with nothing interesting to blur is still valid — or possibly something blank) is a genuine unknown until tested on a device with Instagram installed. Also unverified: the exact pasteboard key names against Instagram's live behavior (based on the publicly documented contract, not confirmed against a real share). Neither can be checked from here — no Xcode build, no Instagram to test against (confirmed with the user: the Simulator can't run real App Store apps at all — Instagram testing needs the physical device).

**Add-tab icon fixed for dark mode.** The custom Add-tab badge (`MainTabView.addTabImage`) was a single static `UIImage` — always a black rounded-rect with a solid white plus, pre-rendered once and never trait-aware, so it looked wrong in dark mode (same black-on-black-ish badge regardless of system appearance). Rebuilt as `addTabImage(dark:)` + `UIImage(dynamicProvider:)`: the rect's fill is now the inverse of the current color scheme (black in light mode, white in dark mode), and the plus is no longer a colored fill at all — it's a true transparent cutout via `.blendMode(.destinationOut)` inside a `.compositingGroup()`, so it reads as a punched-through hole rather than a printed white plus. Also sized the plus down (16pt arms/3pt thick → 11pt/2.2pt) per request.

**Share flow reworked after real-device testing surfaced two problems.** User tested on their physical iPhone (Simulator can't run Instagram at all): (1) tapping Share jumped straight to Instagram with no preview or choice, and (2) Instagram rejected it outright — "The app you shared from doesn't currently support sharing to Stories."

Fix for (1): new `Components/SharePreviewSheet.swift` + `PendingShare` (an `Identifiable` struct holding the already-resolved card data). `AlbumDetailView`'s share button now calls `prepareShare(score:)`, which downloads the cover and fetches the username, then opens the preview sheet instead of handing off directly. The sheet shows the *same* `ShareCardView` live (not a re-render — same view, so preview always matches export exactly) with three real choices: Share to Instagram Story, Save to Photos (`NSPhotoLibraryAddUsageDescription` added to Info.plist), or More Options (system share sheet).

Root cause for (2), confirmed by the live error, not guessed: Instagram's Stories share intent hard-requires a registered Facebook App ID as `source_application` — this was already flagged as a possible gap when the feature was built, and testing confirmed it's not optional, it's a wall. **This cannot be fixed in code** — it needs an actual Facebook Developer account + a registered app with the "Instagram" product added and this app's bundle ID configured, then the resulting App ID dropped into `Config.instagramFacebookAppID` (currently `nil`). Until that exists, `InstagramShare.canShareToInstagramStories()` correctly returns `false`, and the preview sheet shows that option greyed out with an explanatory caption rather than letting a user hit Instagram's confusing native error — Save to Photos and More Options both work today with no external dependency.

**Facebook Developer signup deferred** — user hit a blocker signing their account up as a developer, punting the App ID setup to a later session. **Nothing pending on the code side**: the app already handles the not-yet-configured state gracefully (that was deliberate, not a stopgap), so the share feature ships today as Save to Photos / More Options, with Instagram as a clearly-labeled "coming soon" once `Config.instagramFacebookAppID` is set. **To resume later**: create a free Facebook Developer app at developers.facebook.com (My Apps → Create App, no Business verification needed for this), add iOS platform with bundle ID `com.sillajuku.app`, copy the App ID from Settings → Basic into `Config.instagramFacebookAppID` — that one-line change is the entire remaining step, no other code changes needed.

**Deliberately out of scope this pass:** other score displays in the app (album detail page's score chip, ranking/leaderboard rows, etc.) still use their prior styling — only the two spots discussed throughout the design process were touched, per the project's scope-discipline convention. The actual Instagram Story share/export feature (the original ask that started this whole design thread) is still next — user chose "badge first, then the share feature" for sequencing.

---

**2026-07-05 (Windows) — data health + native_language mis-tag fix + bot population:**

Started operational (data health, cleanup, covers), took on the bot-population handoff.

**Data health & cleanup (early):**
- Ran `health:audit` repeatedly. Catalog grew to ~295k release_groups / ~2.3M recordings / ~34k artists; integrity clean (0 dangling FKs, 0 orphans, leak fix held). A scary "77k groups with >1 canonical" from the pipeline's QC was proven a **live-write paging-race false positive** (sampled 4,000 groups across the UUID space → 0 real multi-canonical).
- **IO reality:** Supabase Micro's daily Disk-IO burst budget got exhausted by the pipeline; heavy count queries timed out (~9s). Draining the queue doesn't refill it — only the **daily reset** does. The pipeline is NOT "done" just because `artist_ingestion_queue` is empty (DISCOVER lane keeps generating work); stopped it; performance recovered after the reset.
- **Orphan cleanup:** deleted **894** `tracks_done` artists with 0 release_groups + 0 credits + 0 recordings (atomic SQL, verified). Ran the CAA cover sweep (37,153 candidates, ~25% hit).

**native_language mis-tag fix (261) — helps the whole app:**
- The OLD `backfill-native-names.ts` (Wikipedia ko/ja langlinks, pre-`name_phonetic_ko`) wrote the Korean/Japanese **phonetic** rendering of NON-native artists into `name_native` and set `native_language='ko'/'ja'` — so Taylor Swift (US) was `native_language='ko'`, name_native "테일러 스위프트"; Rolling Stones was `ja`. `scripts/fix-native-language-mistags.ts` fixed **261** via the `country` signal (native_language='ko' but country≠KR ⇒ mis-tag; ko ones' phonetic moved to `name_phonetic_ko`). Fixes native-name display + search app-wide. (ko artists 333→294, ja 394→172.)

**Bot population — partially built**
- Built the full machinery per the handoff: `scripts/data/bot-personas.ts` (15 personas, Korea-first, anti-commercial), `scripts/create-bots.ts` (`is_bot`, native-script display names, backdated signups, `--per-persona`), `scripts/generate-bot-ratings.ts` (persona-weighted, quality-anchored, decimal scores, recency-spread timestamps). Migrations `20260705000004_profiles_is_bot` + `20260705000005_top_rated_bayesian` (Bayesian `top_rated`, min-3 — protects real users too). Ran an 8-bot then a **26-bot cross-persona pilot** (still LIVE, ~2,088 ratings).

**Critic-signal infrastructure (the honest core — reuses the research):**
- Insight (validated by 3 independent model reviews): `external_scores` cleanly separates **critical** (serious-listener taste, incl. respected K-pop like f(x) *4 Walls*) from **commercial** (idol/sales). `prestige_score` blends both, which is why it surfaced idols.
- `scripts/data/external-score-sources.ts` — refined critical/institutional(Grammy=weak)/commercial classification + weights.
- `20260705000006_critic_affiliation.sql` — `critic_affiliation` view with **Artist Halo** (artist with any critical album → whole discography respected). **4.3× Korean pool (87→371).** direct_critical=1146, halo=12,319.
- `20260705000007_critics_picks.sql` — `get_critics_picks(limit, scope)`: honest, day-one "Critics' Picks" / "Korean Critics' Canon" (SUMIN, Mid-Air Thief, Silica Gel, Kid Milli, JENNIE *Ruby*), ranked by critic breadth, shown AS critic signal.
- `scripts/backfill-external-score-links.ts` — links unlinked critic entries by title×artist×year.
- **⚠️ Self-inflicted data mistake + recovery (lesson):** ran a destructive revert **without a dry-run** on a bad heuristic (assumed Korean-critic links must point to `native_language='ko'` artists — but only 294 carry that tag) → nulled **263** critic links, ~259 correct. Recovered fully via the original MB resolver (`backfill:external-mbids`): critical links 1,449→(1,380)→**1,459** (net-positive), false positives permanently excluded via a new CJK-title guard. Lesson: **dry-run destructive writes, always.**

---

**2026-07-05 (Mac) — two-track session kicked off: bot population (Windows) + Instagram share card (Mac):**

Product push to solve the cold-start problem (empty app at launch → bad first impression → fewer real users → stays empty) plus a new share-to-Instagram-Stories feature. Split by machine: Windows owns bot population (100% backend/data, zero iOS surface), Mac owns the share card (100% native iOS). Wrote `HANDOFF-WINDOWS.md` (replacing the now-completed native-title/phonetic-search handoff) with the full bot-population task: flagged the existing `create-bot-user.ts`/`bot-actions.ts` as stale (still writes pre-renovation `ratings.release_id`), proposed building bot personas on the already-existing `lib/genre-categories.ts` taxonomy (26 categories, korean/japanese/western/global origins — same vocabulary the onboarding picker uses) rather than inventing a new one, and named the open product tension explicitly: the "serious listener" positioning argues for over-indexing hip-hop/indie/R&B, but the real userbase is Korea-first, so bot proportions shouldn't drift too far from actual Korean listening habits. Recommended adding `profiles.is_bot` before creating any accounts (cheap now, keeps every future option open). Widget/share-card work deliberately not started yet — talking through the design first per user request.

---

**2026-07-05 (Mac) — iOS Profile tab Following/Followers showing 0:**

User report: Profile tab's Following/Followers stat cells showed 0 despite real follow relationships existing. Live-verified the DB and REST protocol are both fine (account `junnwest` correctly has 2 followers / 3 following via both anon-role and service-role queries; a raw HEAD request with `Prefer: count=exact` correctly returns `Content-Range` from PostgREST). Isolated the difference to `ProfileView.swift`'s `ProfileViewModel.load()`: its two follows-count queries were the only ones in the whole function using `head: true` (every other working count-query pattern in the codebase, e.g. `UserProfileView.swift`'s `loadCounts()`, omits it), wrapped in `try?` that silently swallows any failure to a default of `0` with no logging. Removed `head: true` from both queries to match the established working pattern. Also fixed a related but distinct correctness issue in the same function: `hasLoaded = true` was set *before* the `guard let user = supabase.auth.currentUser` check, so if the auth session hadn't finished restoring when the Profile tab first loads (a real race on cold launch), the guard would fail once and `load()` would never retry (only a follow/rating-change notification calls `reload()`) — reordered so `hasLoaded` is only set after a real user is confirmed. **Not yet verified live in the simulator** — `xcodebuild` CLI is known-broken on this machine (see Build note above), so this needs a Cmd+B/Cmd+R pass in Xcode GUI to confirm the fix before considering it fully closed.

---

**2026-07-05 (Mac) — get_silla_leaderboard timeout fixed (iOS "랭킹" card showed "no data"):**

User report: the Charts page's Silla leaderboard card showed "아직 랭킹 데이터가 없습니다." (no ranking data yet). Not a data gap — the RPC was hitting the anon role's statement timeout against `release_groups` (grown to ~290k rows), silently swallowed to an empty array by the iOS client's `try?`, so the failure was invisible from the app side.

Root-caused via direct RPC timing tests (service-role key, confirmed `57014 canceling statement due to statement timeout` while sibling chart RPCs returned in ~1s) and then `EXPLAIN (ANALYZE, BUFFERS)` — first on the wrapped function call (only showed an opaque "Function Scan", since `SECURITY DEFINER` functions are never inlined by Postgres) then on the raw query body run directly (parameters substituted as literals) to see the actual internal plan.

Took 4 rounds to land a durable fix, each round diagnosed from a fresh `EXPLAIN ANALYZE` the user ran in the SQL editor and pasted back:
1. **`20260704000000`** — restructured the `scored` CTE to start FROM the small (~1,823-row) prestige-derived set and JOIN into `release_groups`, instead of the reverse (`release_groups LEFT JOIN prestige ... WHERE prestige IS NOT NULL`, which is logically an inner join but defeated the planner's outer-join elimination against the now much-bigger table). Helped, but still ~40% failure rate — root cause remained.
2. **`20260705000000`** (`enable_nestloop=off`) — the actual bottleneck: Postgres was doing 1,823 individual random-access index lookups into `release_groups` (~5ms each, ~9 of 16.4 total seconds) instead of a batched join. Disabling nested loop fixed the country-scoped path (669-719ms) but the global path still failed 100%.
3. **`20260705000001`** (also `enable_mergejoin=off`) — with nested loop off, the planner picked a Merge Join instead, which needs both sides sorted — satisfied via a full *ordered index scan of all ~294,000 rows* (10.3s). Forcing hash join (only option left) fixed the global path (7.5-7.9s) but now broke the country path (2/3 timeouts) — confirmed the two call shapes (global vs. country-scoped) genuinely need different plans, not one GUC setting.
4. **`20260705000002`** (durable fix) — stepped back from GUC tuning entirely. `release_groups` already had a precomputed, indexed `prestige_score` column from the original (June 28) design, abandoned for live computation once country-scoping needs (June 30) required a per-request calculation. Restructured so the **global path reads `rg.prestige_score` directly** (no join needed at all — exactly the condition its supporting partial index was built for) while the **country path keeps live computation** with just `enable_nestloop=off` (the one setting that helped it, without the merge-join toggle that broke it in round 3). Also dropped a redundant final self-join that re-fetched columns `scored` already had. Verified stable: 359-913ms across repeated calls, both paths, zero timeouts.

**Found in passing**: `reconcile_prestige_scores()` — the function meant to keep `prestige_score` fresh — was never in a tracked migration (created directly via the SQL editor at some point) and still implemented the *old* weighted-average prestige formula, the one `prestige_formula_v2` (2026-06-30) explicitly replaced on the live-computation side because it let a weak source dilute a strong one. Rewrote it to match (`20260705000002`/`20260705000003`) — same per-tier-max/floor-guarantee/diversity-bonus formula as `global_prestige`/`all_prestige`.

**Left incomplete, deliberately**: the actual data refresh (`SELECT * FROM reconcile_prestige_scores(5000)`, ~234 stale-formula rows out of 1,589) hasn't run — its own `UPDATE ... release_groups` join hit the same lock/plan issues, and further investigation found it's colliding with the pipeline's `embeddings` lane, which is *itself* actively erroring against `release_groups` (`err=474 «canceling statement due to statement timeout»` per `pipeline:status`). Confirmed via `pg_stat_activity` this is genuine concurrent write contention, not a bug in the reconcile query. This is the same recurring category logged in `PIPELINE_CHECKS.md` on 2026-06-29/07-01 (reconcile timing out under ingest write-load) — not new, and expected to clear once the embeddings lane's error rate settles. `PIPELINE_CHECKS.md` updated with a new dated entry.

**Also fixed this session** (reported together with the leaderboard bug):
- **"Hidden Gems"/"Controversial" insight cards weren't translating** in Korean despite the translations already existing in the catalog — `InsightCard`'s `title`/`subtitle` were plain `String`, and `Text(String)` never does a catalog lookup (only `Text(LocalizedStringKey)`/`String(localized:)` does). Fixed at the call site.
- **Tab bar text captions reverted** — user decided against the icon-only tab bar from the prior session; restored `Text` labels under all 5 icons, kept the custom black/white Add badge (a separate, still-wanted change).
- **Taste unlock progress bug** ("15 ratings, but told 20 more needed") — `TasteViewModel` only counted album ratings with a manual `score` set, silently excluding Instinct/Elo-only ratings and all song ratings. Fixed to match `ProfileView`'s `totalRatings` definition (mode-agnostic, albums + songs).
- **Trending 전체 vs 맞춤** — clarified what each does (global vs. genre-personalized); flagged as a real product judgment call given sparse per-user rating data pre-launch, not actioned.

Noticed but **not touched**: `Localizable.xcstrings` has an uncommitted diff (208 insertions/206 deletions, new keys with existing Korean translations already present) that wasn't made by any edit in this conversation — likely Xcode re-syncing the catalog during one of today's several builds. Left alone and flagged to the user, per scope discipline (out of scope for this task).

---

**2026-07-04 (Mac) — bug reports from testing: tab bar caption revert, chart translations, Taste unlock count:**

Four items reported after testing the app directly.

- **Tab bar captions reverted**: user decided against the icon-only tab bar from earlier today — reverted to `.tabItem { Image(...); Text(...) }` for all 5 tabs, keeping the custom black/white Add badge design (that part was a separate, still-wanted change, not being undone).
- **"Hidden Gems"/"Controversial" insight cards weren't translating**: `InsightCard`'s `title`/`subtitle` fields were plain `String`, and `Text(String)` never does a catalog lookup (only `Text(LocalizedStringKey)`/`String(localized:)` does) — so even though Korean translations already existed in `Localizable.xcstrings` (숨은 명반/호불호 갈림 + both subtitles), they were never used. Fixed by wrapping the call-site literals in `String(localized:)`. Verified live via simulator (temporarily defaulted `selectedTab` to `.rankings` for a one-off build since simulator coordinate-tap automation was unreliable this session — reverted after screenshotting).
- **Taste unlock progress bug ("15 ratings but need 20 more")**: root-caused. `TasteViewModel.load()`'s query only selected `score` (not `elo_score`) from `ratings`, then filtered to `rows.filter { $0.score != nil }` for the count — silently dropping any album rated via Instinct/Elo mode (no manual star score) from the unlock-progress count. It also never counted song ratings (`track_ratings`) at all, unlike `ProfileView`'s `totalRatings = ratings.count + songRatings.count`. Fixed `ratingCount` to `rows.count + songRows.count` (mode-agnostic, matches Profile's definition) — the `scored`-filtered subset is still used separately for building insight cards (top album, rating style, etc.), unchanged.
- **Trending 전체 vs 맞춤 (open question, not actioned)**: confirmed what each does — 전체 is `get_charts_trending` (global), 맞춤 is `get_charts_trending_for_genres` filtered by the user's top-3 rated genres (falls back to global if no session/genres). User's intuition was that 맞춤 might not be needed; flagged as a real product judgment call (with sparse per-user rating data pre-launch, 맞춤 often falls back to the same list as 전체) rather than removed outright — no code change made, awaiting user's call.

---

**2026-07-03 (Windows) — Korean phonetic search built + native-title source research (HANDOFF-WINDOWS.md):**

Picked up the two open-ended data-sourcing tasks from `HANDOFF-WINDOWS.md`. Reviewed the plan against the live DB first (found schema drift worth catching), then executed the one with a clean source and escalated the one that needs a decision.

**Task 2 — Korean phonetic search (`드레이크`→Drake): ✅ COMPLETE. 3,566 artists populated, verified live.**
- Design per handoff: a **separate** `artists.name_phonetic_ko` column, *not* an overload of `name_native`. `name_native` means "this artist's actual native-script identity" (IU = 아이유); `name_phonetic_ko` means "the standard Korean spelling a Korean would type to find this artist" (Drake = 드레이크). Conflating them would reintroduce exactly the ambiguity the 07-03 Mac native-name cleanup removed.
- Migration `20260703000006_artist_phonetic_ko.sql`: adds the column + a functional trigram index, and rebuilds `search_artists` to match/rank `name_phonetic_ko` in WHERE + ORDER BY. **RETURN signature is unchanged** (phonetic participates only in matching, never the projection) → no iOS/web client changes needed.
- Backfill `scripts/backfill-phonetic-ko.ts` (`npm run backfill:phonetic-ko`, `:dry` variant): sources the rendering from **Korean Wikipedia interlanguage links** (the EN article's `ko` langlink — public API, no scraping). Reuses the proven `backfill-native-names.ts` structure (direct-title → music-biased-search fallback, disambig-suffix stripping, music-category guard) but keeps only the `ko` link and only if it's actually Hangul. Scope: non-Korean-native artists (`native_language IS DISTINCT FROM 'ko'`), famous-first, resumable/idempotent. DB writes are single-row UPDATEs (negligible IO vs the ingest pipeline; the cost is Wikipedia round-trips).
- Validated the resolver live before handoff: Drake→드레이크, Taylor Swift→테일러 스위프트, The Weeknd→위켄드, Kendrick Lamar→켄드릭 라마, Radiohead→라디오헤드, Coldplay→콜드플레이. Correctly returns no-match for nonexistent artists and for ambiguous pages (Nirvana, YOASOBI) — conservative by design (a wrong phonetic spelling is worse than none). Zico correctly no-matches (Korean-native → out of scope).
- **Result:** migration applied, backfill run to completion — **3,566 / ~21.5k non-Korean artists** got a phonetic (~16%; the famous ones — the obscure long tail has no Korean Wikipedia article). Verified live through the `search_artists` RPC: 드레이크→Drake (exact match outranks the "Drake Bell" prefix match), 라디오헤드→Radiohead, 위켄드→The Weeknd, 켄드릭 라마→Kendrick Lamar, 빌리 아일리시→Billie Eilish, 아리아나 그란데→Ariana Grande. Korean-native search unaffected (아이유→IU).
- **Bug caught mid-run (user's "extra careful" instinct):** `stripDisambig` only handled a single paren group, so a nested Wikipedia disambiguator — (G)I-DLE's "I am ((여자)아이들의 EP)" — survived and the Hangul-guard accepted the Hangul *inside the disambiguator*, writing one dirty `native_title`. Blast radius verified as exactly 1 row (the other 2 native fills + all phonetic values were clean). Fixed with a balanced-paren stripper in both scripts, reverted the bad row.
- **One-shot limitation:** future ingests don't auto-populate `name_phonetic_ko`; wiring it into `mb-ingest` is the follow-up if ongoing coverage is wanted.

**Task 1 — Korean native album titles: precision backfill from Wikipedia; Deezer built but held.**
- Schema-drift finding: the old `backfill-native-names.ts` Phase 2 wrote to `releases.title_native`, which post-renovation holds **0 rows** — that data never migrated to the rated entity. The live field is `release_groups.native_title` (12,382 / 208,570 set, mostly Japanese from MB ingest).
- Re-confirmed the handoff's two dead-ends empirically: **iTunes KR** returns the Korean *artist* name but *English* album titles (뉴진스 :: "NewJeans 2nd EP 'Get Up'"; 아이브 :: "REVIVE+", "I've IVE"); **MusicBrainz** carries no Korean RG titles. Ruled out the clean alternatives: **Wikidata** ~0 K-pop album coverage; **Deezer** bare-query search returns wrong artists.
- **Scraping ruled out cleanly:** all four Korean platforms (Melon/Bugs/Genie/Vibe) have `User-agent: * → Disallow: /` in robots.txt — album/search paths whitelisted only for Googlebot/Naver/Daum crawlers. Not building a harvester that ignores four explicit no-crawl directives. User chose "both (curated + Deezer), but no erroneous data" → precision-first.
- **Wikipedia tier (shipped, running):** `backfill-native-titles-wiki.ts` (`npm run backfill:native-titles`). EN Wikipedia `ko` langlinks with three stacked guards — exact title match, artist-category match ("IU (entertainer) EPs"), Hangul-only — so a wrong title can never be written. Validated: "A Flower Bookmark"→꽃갈피, "A Flower Bookmark 2"→꽃갈피 둘; "Palette"/"Map of the Soul: 7"/"Love Poem" correctly return null (genuinely Latin). `wikiGet` retries 429/5xx (rate-limit → re-check, not silent miss).
- **Deezer tier (built, HELD un-run):** `backfill-native-titles-deezer.ts`. Artist-scoped matching (exact Deezer-artist resolution → their own catalog → pair by exact date + unique-on-date + Hangul) — guards are sound (the earlier wrong-artist problem was the bare-query method, fixed here). But a 60-artist dry-run yielded ~0.2% AND dirty title strings (Super Junior "SORRY, SORRY" → "쏘리 쏘리 SORRY, SORRY - The 3rd Album"), so it fails the no-erroneous-data bar. Committed as available-but-not-run; not wired to a default script.
- **Key finding — the gap was overstated:** the raw "6,464 / 7,425 (87%) missing native_title" is misleading. Most nulls are albums with legitimately **Latin** official titles (IU's Palette/LILAC/Love poem/Modern Times) that *should* stay Latin; the genuinely-Korean-titled albums were largely already captured at ingest (꽃갈피 stored in Korean with native_title set). So Wikipedia's fill count is modest by design — it fills only the true residual (romanized-in-DB but officially Korean), every one verified.

**2026-07-03 (Mac) — New device setup + Terms of Service link + operational readiness audit + Start Here fixes:**

First session on a new MacBook Pro (M5 Pro, 24 GB RAM).

**Environment setup:**
- `apps/web/.env.local` created from `.env.example`; values pasted in from the other device.
- `npm install` run at root — resolves workspace node_modules. `npx supabase` (project devDependency, 2.101.0) works — no need for the README's Windows-only global-binary install instructions.
- `xcode-select` was pointed at Command Line Tools instead of `Xcode.app` (`xcodebuild -version` failed) — fixed with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- iOS 26.5 simulator runtime install was messy: first attempt (`xcodebuild -downloadPlatform iOS -exportPath /tmp`) downloaded 8.5 GB but only exported a disk-image bundle to `/tmp` without registering it as a bootable runtime — `xcrun simctl list runtimes` stayed empty and Xcode's Platforms panel showed a stale "Installed" label that didn't match reality (confirmed via `xcrun simctl boot`, which failed with "cannot determine the runtime bundle"). Xcode's GUI "Delete" on the phantom entry also failed ("Unable to remove SimulatorRuntime") since `simctl`'s registry already had 0 disk images — nothing to remove. Fix: quit Xcode, re-ran `xcodebuild -downloadPlatform iOS` **without** `-exportPath` (re-downloaded the same 8.5 GB), which installed correctly — verified this time by actually creating + booting a test simulator device, not just trusting the reported status. Also had to manually `xcrun simctl create` a concrete "iPhone 17 Pro" device since Xcode didn't auto-populate its default device set after the CLI install (the destination picker only showed generic "Any iOS Simulator Device" until then).
- Code signing: "No Accounts" / "No profiles for com.sillajuku.app" — fixed by signing into the Apple ID for team `GGJ5HX3A4M` in Xcode → Settings → Accounts (Automatic signing then regenerates the profile).
- Simulator RAM limitation from earlier sessions (8 GB blocking the simulator, forcing Xcode Previews) no longer applies — this machine has 24 GB.

**Terms of Service link (Settings):**
- New "Legal" section in `SettingsView.swift`, above "Danger Zone" — a `Link` row ("Terms of Service", doc.text icon, external-link arrow) opening `Config.webBaseURL.appendingPathComponent("/terms")`.
- Read the existing web ToS (`apps/web/app/(main)/terms/page.tsx`) fully before wiring the link: 8 sections (acceptance, account, user content, prohibited conduct, music data/Spotify disclaimer, disclaimers & liability, termination, contact `admin@sillajuku.com`), last updated January 2026, references a `/privacy` page too.
- Deliberately linked out to the web page instead of duplicating the legal text in Swift — single source of truth, and legal copy changes don't need an app-store release to take effect.
- Used `Config.webBaseURL` (`https://www.sillajuku.com`, the canonical `www` domain) rather than the bare-domain URL the `AuthView.swift` legal footer hardcodes (`https://sillajuku.com/terms`) — consistent with the 2026-07-01 fix where the non-`www` domain's redirect was found to strip the `Authorization` header on API calls. Not an issue for a plain `Link` (browser navigation tolerates redirects fine), but `Config.webBaseURL` is the established canonical-domain convention going forward. `AuthView.swift`'s footer was left untouched (out of scope for this task).
- **Noted but not fixed in this pass:** README's pre-launch deployment checklist claims "Add jurisdiction to Terms of Service (Republic of Korea)" is done (`[x]`), but no jurisdiction/governing-law clause exists in `apps/web/app/(main)/terms/page.tsx` — still open (separate item from the Music Data fix below, not one of the 5 "Start Here" picks).

**Operational readiness audit (full-stack, all apps + backend + docs):**
- Read across `apps/web`, `apps/ios`, `supabase/migrations`, `scripts/`, and root planning docs via 4 parallel research passes. Produced 23 findings ranked by severity (2 critical, 7 high, 8 medium, 6 low) plus a "what's already solid" list (RLS coverage, security headers/CSP, rate limiting, web i18n, doc discipline). Delivered as an Artifact report; user asked to implement the top 5 ("Start Here") immediately.

**Start Here fix #1 — Help page contact form actually sends somewhere:**
- Was a placebo: `handleSubmit()` only set local React state, no API call, no record anywhere. New `contact_submissions` table (migration `20260703000000_contact_submissions.sql` — insert-open RLS, service-role-only read, `category`/`message`/`email`/`status`). New `/api/help` route (rate-limited via existing `lib/rateLimit.ts`, 5/hour/IP), attaches the signed-in user if present via bearer token. `help/page.tsx` rewired: categories now carry canonical keys (`bug`/`feature`/`question`/`content`) mapped through i18n for display, submit is now async with a real error state. Added `help.sendError` to `en.ts`/`ko.ts`. Deliberately DB-only (no email service) per user's choice — reviewed via the new `/admin/reports` queue, not email.

**Start Here fix #2 — Terms of Service corrected + DMCA process added:**
- §5 "Music Data" previously said metadata is "sourced from Spotify" and disclaimed only Spotify — factually stale, since Spotify was retired from data collection months ago (per README's own "Spotify API — retired from data collection" section). Rewrote to name the actual pipeline: MusicBrainz (CC0), Cover Art Archive, Deezer, Last.fm, Apple/iTunes, with a non-affiliation disclaimer covering all of them.
- New §8 **"Copyright Complaints (DMCA)"** — notice-and-takedown process (the 6 standard required elements: work identification, infringing-material URL, contact info, good-faith statement, perjury statement, signature), repeat-infringer termination clause, routed to the existing `admin@sillajuku.com`. Contact renumbered §8→§9.
- Jurisdiction/governing-law clause intentionally left alone (separate, lower-priority finding — see note above).

**Start Here fix #3 — Sentry error monitoring (web done, iOS handed off):**
- Web: `@sentry/nextjs` added to `package.json`; `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` created; `next.config.mjs` wrapped with `withSentryConfig` (org/project/authToken read from env, `silent: true`); CSP `connect-src` extended with `*.ingest.sentry.io` / `*.ingest.us.sentry.io`. Every config reads `NEXT_PUBLIC_SENTRY_DSN` — Sentry's SDK no-ops safely when the dsn is empty, so this ships inert until a real Sentry project exists.
- iOS: could not safely proceed — adding a Swift Package Manager dependency means hand-editing `project.pbxproj`'s package-reference format, which risks corrupting the Xcode project (matches this project's own documented SPM/CLI fragility notes). Asked the user to add `https://github.com/getsentry/sentry-cocoa` via Xcode's GUI (File → Add Package Dependencies) instead; the Swift init code (`SentrySDK.start` in `sillajukuApp.swift`) is written and ready to paste in once the package dependency exists — **not yet done, blocked on that GUI step**.

**Start Here fix #4 — Report/Block shipped on web (iOS already had it since 2026-06-25):**
- Confirmed via grep before building anything: iOS's `HomeView.swift`/`UserProfileView.swift` already have a full `ReportSheet` (reason picker: Spam/Inappropriate Content/Harassment/Other, matching the `reports.reason` CHECK constraint) and block-user flow — the audit's "nothing uses these tables" finding was scoped to `apps/web` specifically, and was accurate there.
- New `components/ReportBlockMenu.tsx` — a reusable kebab-menu client component (report reasons + block-confirm, direct Supabase client inserts into `reports`/`blocked_users`, same RLS-permitted pattern iOS already uses — no new API route needed for submission). Wired into two surfaces: the Activity feed (per-post, next to each rating/review) and `ProfilePanel` (next to the Follow button, other users' profiles only). Blocking removes that user from the visible feed client-side (`blockedIds` state, matches the DB comment's documented intent: "blocked users are filtered from the reporter's feed on the client").
- `/api/activity/route.ts` now selects `id` on both `ratings` and `reviews` so reports can reference the specific post (`ratingId`, null for review-type items since `reports.rating_id` FKs to `ratings` specifically).
- Coverage note: only the Activity feed + profile page got the menu, not every surface a rating appears (e.g. album-page review lists) — matches the two highest-visibility surfaces iOS covers; left further surfaces for a later pass to avoid scope creep.

**Start Here fix #5 — Admin moderation review queue (net-new on both platforms):**
- Migration `20260703000001_reports_status.sql` adds the `status` column `reports` never had (`open`/`reviewed`/`actioned`/`dismissed`) — needed since nothing could previously mark a report as handled.
- `/api/admin/reports` (GET list + PATCH status) — reuses the existing `x-seed-secret` / `SEED_SECRET` convention already used by `admin/seed-curated`/`seed-rankings`/`seed-votes`, rather than introducing a second admin secret to manage.
- `/admin/reports` page — deliberately outside the `(main)` route group (no site header/nav inherited), not linked from anywhere in the app UI. Client-side password gate (secret stored in `sessionStorage` only, re-prompts on 401). Lists reports and Help-page contact submissions side by side with one-click status buttons.
- Also fixed in passing: `SEED_SECRET` was used by 3 existing routes but was missing from `.env.example` (a real gap — the var existed in practice but wasn't documented for a fresh setup) — added, since this file was already being extended for the same reason.

**Start Here fix #6 — Push notification delivery pipeline (was registration-only):**
- The gap: iOS registers an APNs token and saves `profiles.push_token`; DB triggers (from the 2026-06-19 notifications migration) create `notifications` rows on likes/comments/follows — but nothing ever called Apple's push service. Users only ever saw notifications if the app was already open.
- Migration `20260703000002_push_notification_webhook.sql` — enables `pg_net`, adds a trigger on `notifications` INSERT that POSTs to a new `/api/push/send-webhook` route. Deliberately reads its target URL and shared secret from `current_setting('app.settings.push_webhook_url'/'push_webhook_secret')` rather than embedding either in the migration file — secrets don't belong in git, so the migration's header comment gives the exact `ALTER DATABASE postgres SET ...` commands to run once, out-of-band, in the SQL editor.
- `/api/push/send-webhook` — validates `x-push-secret`, loads the notification + recipient's `push_token` + actor username + (for like/comment) the rated release's title, composes a message per notification type, sends via new `lib/apns.ts`.
- `lib/apns.ts` — thin wrapper around the `apn` npm package (added to `package.json`), lazily builds an `apn.Provider` from `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY` (PEM, `\n`-unescaped) + `APNS_BUNDLE_ID`; every function no-ops safely if those aren't configured. `APNS_PRODUCTION` defaults `false` to match the app's current `aps-environment: development` entitlement — flip only once shipping via TestFlight/App Store with a production profile.
- `APNS_TEAM_ID` (`GGJ5HX3A4M`) and `APNS_BUNDLE_ID` (`com.sillajuku.app`) are filled in with their real (non-secret) values in `.env.example`, since both are already public in project docs; `APNS_PRIVATE_KEY`/`APNS_KEY_ID`/`PUSH_WEBHOOK_SECRET` remain placeholders — real APNs Auth Key still needs generating in Apple Developer → Keys.

**Validation:** `npm install` (added `@sentry/nextjs`, `apn`), `npx tsc --noEmit` clean, `npm run build` clean (63 static pages + all new routes present: `/admin/reports`, `/api/help`, `/api/admin/reports`, `/api/push/send-webhook`). `next lint` could not run non-interactively — no `.eslintrc` exists anywhere in the repo, a pre-existing gap unrelated to this session's changes.

**Still open / needs the user's action (all external, can't be done from an agent session):** apply the 3 new migrations; run the 2 `ALTER DATABASE` push-webhook settings; generate a real APNs Auth Key; create a Sentry project + add the DSN (web) and add the `sentry-cocoa` SPM package (iOS); `npm install` on the Windows machine to pick up the 2 new deps.

**Follow-up — Help & Feedback linked into iOS:** the web `/help` page (FAQ + the now-functional contact form) had no iOS entry point. Added a "Support" section to `SettingsView.swift` (above "Legal") with a "Help & Feedback" link, same `Link`-to-web-page pattern as the Terms of Service row, opening `Config.webBaseURL.appendingPathComponent("/help")`.

**Follow-up — Privacy Policy was missing from iOS Settings (oversight, caught by user):** the original Terms of Service Settings link should have included Privacy Policy alongside it from the start — the web Auth screen's own legal footer links both together. Added a second row in the same "Legal" section, `Config.webBaseURL.appendingPathComponent("/privacy")`.

**Follow-up — the 3 migrations applied cleanly, but `ALTER DATABASE ... SET app.settings.*` failed** (`permission denied to set parameter`) — hosted Supabase's `postgres` role doesn't have instance-level privileges for that, it's reserved for Supabase's own platform. Fixed with migration `20260703000003_push_webhook_config_table.sql`: replaced the `current_setting()` read in `_notify_push_webhook()` with a plain `_app_config(key, value)` table (RLS enabled, zero policies → unreachable via PostgREST, only readable by the SECURITY DEFINER trigger function). Populated via a normal `INSERT ... ON CONFLICT` instead of `ALTER DATABASE`. Verified via a throwaway script (service-role client, deleted after use) that both `push_webhook_url` and `push_webhook_secret` rows exist. `PUSH_WEBHOOK_SECRET` was generated with `openssl rand -hex 32` and written directly into `.env.local` (plus the matching `_app_config` row) — no external account needed for this part, unlike the still-open APNs key and Sentry DSN.

**Follow-up — APNs key already existed (Key ID `48KQZ5RRNK`, created 2026-06-30, user recalled it after I verified `.env.local`/filesystem showed nothing configured).** User located the saved `.p8` file and pasted its contents; written into `.env.local` as `APNS_PRIVATE_KEY` (newlines escaped `\n` per `lib/apns.ts`'s unescape logic) alongside the now-confirmed `APNS_KEY_ID`. Verified by constructing a real `apn.Provider` in a throwaway script (deleted after) — parsed without error, confirming the key is valid. **Push notification pipeline is now fully wired locally** — remaining: add the same APNs/push env vars to Vercel for production, since `.env.local` only covers local dev.

**Follow-up — Sentry (web) account created + verified live, environment-tag bug caught and fixed.** User created a Sentry account + `javascript-nextjs` project (org `sillajuku`), DSN added to `.env.local`. Verified twice via throwaway scripts (deleted after each use): first test event confirmed delivery end-to-end — landed in Sentry's Issues tab with full stack trace and even triggered a real email alert to `admin@sillajuku.com` (proving the forwarding-to-`junn223@gmail.com` setup from earlier this session works too). That first test surfaced a real bug: the event was tagged `environment = production` despite running from local `npm run dev` — none of the 3 config files (`sentry.client/server/edge.config.ts`) set an `environment`, so the SDK defaulted every event to `production` regardless of where it actually ran. Fixed: `environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'` (client) / `process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'` (server/edge — `VERCEL_ENV` isn't inlined client-side, hence the `NEXT_PUBLIC_` variant there). Re-verified: resolves to `development` locally; will read `preview`/`production` correctly on Vercel (auto-injected, no config needed). `npx tsc --noEmit` clean after the fix.

**Follow-up — Sentry (iOS) fully wired.** User added `sentry-cocoa` via Xcode (confirmed via `Package.resolved` + `project.pbxproj` — properly linked as a target framework, not just referenced) and created a second Sentry project (`apple-ios`, same `sillajuku` org) for a separate iOS DSN. `Config.swift` gets a `sentryDSN` constant (deliberately hardcoded like the existing `supabaseAnonKey` — Sentry DSNs are designed to be public/embeddable, submit-only, not a real secret, so no `.env`-equivalent mechanism is needed for a compiled iOS app). `sillajukuApp.swift`'s `AppDelegate.application(didFinishLaunchingWithOptions:)` now calls `SentrySDK.start` first thing, environment tagged via `#if DEBUG` (`development`/`production`) mirroring the web fix. Cmd+B build succeeded. Added a temporary `SentrySDK.capture(message:)` test line to verify delivery — before the user even ran it deliberately, Sentry's automatic HTTP instrumentation had already captured a **real bug** on normal app launch: `HTTPClientError` — `POST /rest/v1/rpc/get_charts_most_rated` returning HTTP 500. That's a stronger delivery proof than the planted test message, so the temporary line was removed without needing it to fire. **The `get_charts_most_rated` 500 is flagged but not investigated** — out of scope for this Sentry-setup task per the project's scope-of-changes rule; worth a follow-up session.

**All 5 "Start Here" audit items are now fully complete and verified end-to-end**, plus the two follow-on systems (push notifications, Sentry on both platforms) are live, not just wired: contact form (DB + admin queue), ToS/DMCA fix, Sentry web + iOS (both delivering real events), Report/Block on web, admin moderation queue, and the full push-notification pipeline (APNs key sourced from an existing key the user had saved, config table workaround for the `ALTER DATABASE` permission wall). Remaining open items are unrelated follow-ups noted along the way: add push/Sentry env vars to Vercel for production, and the `get_charts_most_rated` 500 bug.

**iOS localization (en/ko) — the next audit item tackled, done to completion in one pass, all 24 files.** Web has had full en/ko i18n for a while; iOS had zero (every string hardcoded English) — a real gap for a Korea-first product.

- **Infrastructure:** `apps/ios/sillajuku/sillajuku/Localizable.xcstrings` (Xcode String Catalog) + Korean added as a project-supported language (`knownRegions` now `en, Base, ko`). Took two tries to get right — the first `String Catalog` file landed in the wrong folder and was never linked into the project (0 pbxproj references, since this project uses Xcode 16's **synchronized folder groups** — files are auto-included just by sitting in the right physical folder, no manual pbxproj entry, which is why "Add Files" showed it as already present the second time).
- **Phased approach:** Phase 1 = the "getting started" experience (`AuthView`, all 5 `Onboarding/Step*.swift`, `MainTabView` tab labels, `SettingsView`) — built and build-verified first, before committing to the full remaining scope. Phase 2 = the rest of `Main/`: `HomeView`, `SearchView`, `RankingsView`, `ProfileView`, `AlbumDetailView`, `InstinctRatingView`, `TasteView`, `MixLibraryView`, `UserProfileView`, `ActivityView`, `NotificationsView`, `EditProfileView`, `CommentSheetView`, `PostRatingOptionsView`.
- **Translation approach:** reused web's `ko.ts` glossary wherever terms overlapped (rating mode names, Settings labels, Terms/Privacy) rather than re-deriving Korean phrasing from scratch, so terminology stays consistent across platforms.
- **The real work was code, not just copy** — most `Text("literal")`/`Label("literal")`/`Section("literal")` calls auto-localize for free once a String Catalog exists, but a meaningful fraction of strings don't, and had to be found and fixed one pattern at a time:
  - Reusable subview `let title: String` params (e.g. `RatingModeCard`, `SongHorizSection`, `ChartHorizSection`, `sectionLabel` helpers across 6 files) — retyped to `LocalizedStringKey` so literals passed at the call site actually localize.
  - Enum `rawValue`s displayed directly (`RatingSortOrder`, `RatingTypeFilter`, `GenreDetailViewModel.SortMode`) — fixed via the `Text(LocalizedStringKey(dynamicString))` / `String(localized: String.LocalizationValue(dynamicString))` runtime-lookup pattern, since the value is only known at runtime but still needs a catalog lookup.
  - `?? "someone"` / `?? "user"` fallback patterns for missing usernames — found and fixed **7 separate occurrences** across `HomeView`, `SearchView`, `CommentSheetView`, `NotificationsView`, `AlbumDetailView` (×3), `UserProfileView` (×2) — this exact fallback pattern is copy-pasted throughout the codebase.
  - Mixed fixed-English + interpolated-data strings (`"X liked your rating of Y"`, `"X rated · Y avg"`, count labels) — rebuilt with `String(format: String(localized: "..."), args...)` rather than relying on inline `Text("...\(x)...")` interpolation, which is inconsistent about whether it auto-extracts (confirmed both ways happened during this session — see reconciliation note below).
  - Pure data-joins with a `·` separator (e.g. `"\(title) · \(artist)"`) — changed to plain string concatenation (`title + " · " + artist`) instead of interpolation, since there's no actual translatable content, just formatting.
  - **`Release.typeLabel`** (`Models/Release.swift`) — one shared computed property returning "Album"/"EP"/"Single"/"Release", used across nearly every screen in the app. Fixing this one spot cascaded correctly everywhere it's already called.
  - Singular/plural (`"1 Comment"` vs `"%d Comments"`, likes, ratings, releases) — preserved wherever the original code already bothered to special-case singular; where it didn't, matched that same level of effort with a single format key (Korean doesn't grammatically need the distinction either way).
- **Deliberately out of scope for this pass:** genre/country filter chip labels in `RankingsView` (`SillaLeaderboardCard`/`RankingDetailView`'s `genres`/`countries` arrays) — these double as the actual filter *value* sent to the backend, decoupling display from value would have meant restructuring the filter-chip call sites too; a reasonable trade-off given everything else still to cover, noted here so it isn't mistaken for an oversight later.
- **Reconciliation with Xcode's own string extraction:** after the full pass, Xcode's own build-time re-scan of the catalog surfaced 22 keys with no Korean translation — a mix of (a) harmless symbol/number-only keys it auto-extracts that need no real translation (`"·"`, `"@%@"`, `"0.5"`, etc. — marked `shouldTranslate: false`), (b) **two translations that existed in an earlier write but were gone after Xcode's rebuild** (`"%@ · +%d this week"`, `"1 rating"` — restored), and (c) **genuine misses**: `RankingsView.swift:603`'s `TrendingSongRow` had a raw `"\(entry.artist) · \(entry.albumTitle)"` interpolation that slipped through the original sweep (fixed to plain concat), plus `"Turn on notifications."` (Phase 1 miss), `"Artist"`/`"Follow"`/`"Private"`/`"Followers only"`/`"Your Rating"`/`"Your Instinct Ranking"`/the TasteView month-name sentence — all found and translated. Patched via a Python script operating directly on the `.xcstrings` JSON rather than fragile text-based edits, since Xcode's own re-serialization changed the file's formatting.
- **Final state:** 305 catalog keys, two full-app Cmd+B builds succeeded (once after Phase 2, once after the reconciliation patch). Not independently visually verified in the Korean-language simulator this session — worth a quick look next time before considering this fully done.

**Korean-quality pass (live simulator testing) — awkward translations fixed, missing strings added, native-name display wired into iOS:**

User booted the Korean-language simulator and flagged 5 issues: (1) release data not in Korean at all — data problem, not translation; (2) several awkward phrasings (이 사용자 차단→차단, 많이 평가됨→가장 많이 평가된 앨범/노래, rating-unit labels); (3) missing translations (`Hidden Gems`, `Controversial`, "Follow people to see their ratings here.", Album/Soundtrack/Compilation labels, Rated/Following/Followers); (4) the entire Taste page reading as machine-translated; (5) Korean search not matching international artists (e.g. "드레이크" → Drake). Catalog grew 305 → 331 keys fixing (2)–(4). Item (5) confirmed as a data gap, not a code bug — the search code already handles native-name matching correctly, there's just no Korean phonetic data stored for non-Korean artists.

Item (1) led to wiring real native-name data into iOS display (previously every screen hardcoded `nil` for native title/artist regardless of what the DB had):
- **`Models/Release.swift`** — added `String.isPredominantlyHangul` (counts Hangul-range Unicode scalars vs total letters, >50% = predominantly Hangul). `displayTitle`/`displayArtist` now show the native value only when it's actually Hangul-dominant (guards against a Latin `name_native` — see the bug below — leaking into display).
- **`HomeView.swift` / `ProfileView.swift`** — `feedSelect`/ratings queries extended with `native_title, artists!release_groups_primary_artist_id_fkey(name_native)`; new shared `NativeArtistRef` struct; `FeedRelease`/`ReleaseRef` now carry real native fields through to display instead of passing `nil`. Two manual (non-decoded) struct constructors broke on the new required fields (`ProfileView.swift`, `UserProfileView.swift`) — fixed with explicit `nil` at those two call sites (real native data isn't fetched at those specific paths).
- **Not wired this pass:** `SearchView`, `RankingsView`/charts, `MixLibraryView`, `TasteView`, `ActivityView`, `NotificationsView` — these read from RPCs (`search_release_groups`, `search_artists`, ~11 chart RPCs) that don't select the joined native-name field at all; extending them is a separate backend task.

**Root-cause fix + data correction — wrong Korean artist names (E SENS → "강민호" bug):** user spotted E SENS showing his birth name "강민호" instead of no native name (MusicBrainz doesn't have his actual stage-name transliteration "이센스" on file). Traced to `scripts/mb-ingest.ts`'s `pickNative()`: when MusicBrainz had no alias explicitly flagged `primary_for_locale` for a ko/ja/zh locale, the old code fell back to `cjk[0]` — grabbing *any* CJK-locale alias, including a completely unrelated birth/legal name. Fixed going forward: only trust a flagged-primary CJK alias, or fall through to the artist's own name if it's already non-Latin; otherwise `null` (no native name is better than a wrong one).

Correcting already-wrong data turned out to need three rounds of hardening in **`scripts/fix-bad-native-names.ts`** (new), each caught by spot-checking specific artists before trusting the heuristic at scale:
1. First pass only trusted `primary_for_locale: true` aliases (943/2086 wrong: 871 cleared, 72 replaced) — but its `.range()` pagination was unstable under the live ingest pipeline's concurrent inserts, silently skipping rows as new artists shifted page boundaries. Fixed with `.order('id')` for a stable cursor.
2. That strict rule then wrongly cleared **ENHYPEN**'s correct "엔하이픈" to null (a non-primary Hangul alias with no birth-name pollution, indistinguishable from the E SENS case by the primary flag alone). Root cause of *that*: E SENS has a separate `locale='en'` "Kang Min-Ho" alias that reads as a distinct real name; ENHYPEN has no such pair. Added a `hasRealNameAlias` check for a real-name-shaped alias elsewhere on the artist. This also surfaced a structural bug: the script's query scoped to `artists.name_native IS NOT NULL`, so any row a prior pass had wrongly nulled (like ENHYPEN) became permanently invisible to future runs. Rewrote the query to scope by `artist_aliases` membership instead.
3. Broadening the rescan then surfaced two more false-positive classes via spot-checks: (a) **Lily Chou‐Chou** (a fictional stage persona) has her real performer's name "Keiko Suzuki" tagged `locale=null`, not `'en'` — MusicBrainz doesn't reliably tag real names with `locale='en'`, so the signal was broadened to any non-CJK alias that reads as a 2+-word distinct identity (not a substring/variant of the stage name, so "THE BLANKEY JET CITY" containing "BLANKEY JET CITY" doesn't false-trigger). (b) Korean idols with an already-Hangul mononym stage name (가은, 윤상, 지민, 나훈아, etc.) routinely have their *full legal Korean name* stored as another plain Hangul alias (이가은, 이윤상, 신지민) — both names being Hangul means there's no non-CJK signal to catch it at all, so the rule was tightened to never guess from an unflagged alias once the stage name is already native script. A third class ("aiko" → real name "柳井愛子" in kanji) was caught the same way: genuine Japanese transliterations of Latin names are conventionally katakana (Toto → トト), so a kanji-only `ja` alias with no katakana at all was added as a rejection signal.
- **One known residual case, not fixable by this script:** `郭靜` (Claire Kuo) → `郭伯瑜` (her real name) — MusicBrainz's own data has the real name flagged `primary_for_locale: true` for zh_Hant. That's an upstream MB curation error, not a gap in this script's guessing logic; closing it would need cross-referencing an external source (e.g. Wikipedia), out of scope here.
- Final corrected run applied for real: **626 corrections** across 19,461 artists with alias data (493 cleared to null, 133 replaced). Spot-verified post-write: E SENS/가은/윤상/지민/aiko → null, ENHYPEN → 엔하이픈, Metallica → 메탈리카, 歐得洋 → 欧得洋 all correct in production.

**Native-name display extended to the rest of iOS (Search, Charts/Rankings, Mix Library, Taste, Notifications):**

Continuation of the item flagged above as "not wired this pass." Scoped first via an Explore agent that mapped every RPC and Swift call site touching title/artist display — confirmed the ~13-RPC estimate and surfaced three adjacent bugs in files this work already had to touch, all approved by the user to fix in the same pass: `get_user_genre_standings` missing entirely, `ActivityView`'s query referencing a dropped FK, and a `TasteView` decode type mismatch.

- **New migration `20260703000004_native_names_charts_taste_activity.sql`** — rebuilds (`DROP FUNCTION` + `CREATE`, required since adding output columns changes the return type) `get_charts_top_rated`, `get_charts_most_rated`, `get_charts_trending`, `get_charts_trending_for_genres`, `get_charts_hidden_gems`, `get_charts_controversial`, the 3 song-chart RPCs, `get_silla_leaderboard`, and `search_release_groups` — all gain `native_title`/`artist_native` via a `LEFT JOIN artists ON a.id = rg.primary_artist_id`, following the exact `HomeView`/`ProfileView` join pattern. Also rebuilds `get_user_genre_standings` from scratch on the current schema (`ratings.release_group_id`, `release_groups.genres text[]`) — it was dropped during the schema renovation (`20260624000001`) and never recreated, so TasteView's "Genre DNA" card has been silently absent for every user since; output shape matches exactly what `TasteView.swift`'s `GenreStandingRow` already expected, so no Swift change was needed for that part.
- **`RankingsView.swift`** (largest change) — 7 bespoke RPC-decode structs (`ChartEntry`, `ChartSongEntry`, `SillaLeaderboardRow`, `RankedRPCRow`, `TrendingRPCRow`, `SongRPCRow`, `TrendingSongRPCRow`) plus 2 locally-scoped ones inside `GenreDetailViewModel` gained `titleNative`/`artistNative` fields and `displayTitle`/`displayArtist` computed properties (song entries: `displayAlbumTitle`/`displayArtist`, since track titles have no native-script column anywhere in the schema). ~13 `Text(entry.title)`/`Text(entry.artist)` call sites across `HorizAlbumCard`, `HorizSongCard`, `TrendingRow`, `TrendingSongRow`, `PodiumItem`, `RankedListRow` updated to the display variants.
- **`SearchView.swift`** — two independent fixes: artist search rows now render `SearchArtist.displayNativeName` below the name (data was already there via `search_artists`, purely a missing display line); album search results get `artist_native` for free once `search_release_groups` was extended, since `Release`'s existing `artistNative` CodingKey already maps `"artist_native"` — no Swift change needed there at all.
- **`MixLibraryView.swift` / `TasteView.swift` / `NotificationsView.swift`** — same join added to each screen's direct `.select()` query (not an RPC), `NativeArtistRef`-shaped fields added to each screen's own decode struct, display call sites updated. `TasteView`'s `ReleaseEmbed.genres` fixed from `String?` to `[String]?` in the same edit (the DB column is `text[]`; the mismatch would have silently thrown and swallowed the whole query via `try?` for any row with genre data). `ProfileView.swift`'s song-ratings tab had a smaller instance of the same hardcoded-nil pattern, fixed in passing since already touching this exact struct shape.
- **`ActivityView.swift`** — confirmed via a live query (not just suspected) that its `releases(...)` embed off `ratings` was broken: that FK was dropped in the schema renovation in favor of `release_group_id`, so the query threw `PGRST200`. Fixed to `release_groups(...)`, which surfaced a second latent bug — `profiles(...)` was ambiguous between two FK paths (`ratings_user_id_fkey` vs. the `rating_likes` many-to-many), needing an explicit `!ratings_user_id_fkey` hint. **However:** grepping the whole iOS app found `ActivityView` is never instantiated outside its own SwiftUI preview — `MainTabView.swift` only has 5 tabs (Home/Charts/Add/Taste/Profile), no Activity/Feed tab exists. The fix is correct but the screen is currently dormant/unreachable; flagged rather than wired up further, since that's a separate task from what was asked.
- **Second bug found during verification, unrelated to native names:** `get_charts_top_rated_songs`/`get_charts_most_rated_songs` timed out under the `anon` role (`57014`) — not a grants/RLS issue (confirmed RLS is permissive and these are `SECURITY DEFINER` anyway). Root cause: the shared `loc` subquery's `ORDER BY rtk.recording_id, rel.is_canonical DESC` sorts on a key spanning both joined tables (`release_tracks` + `releases`), so no index on either table alone can satisfy it — Postgres has to materialize and sort the *entire* release_tracks⋈releases join (every track of every release in the catalog) before it can pick one row per recording. New migration **`20260703000005_song_charts_lateral_fix.sql`** rewrites it as a `LATERAL` join scoped to only the recording_ids already present in `stats` (i.e. only rated tracks), turning an O(catalog size) sort into O(rated recordings) indexed lookups via the existing `idx_release_tracks_recording` index.
- **Verified live** in the Korean-locale simulator (build success alone wasn't treated as sufficient) — automated via `xcrun simctl` + AppleScript `System Events` clicks (required enabling Accessibility permission for the terminal; calibrated tap coordinates against the actual device content area by accounting for the simulator window's bezel padding, then found clicking elements by their accessibility `description` — e.g. "뒤로" for the back button — far more reliable than coordinate guessing, since it also dumps the visible Korean text of every on-screen element for verification without needing a screenshot). Confirmed correct: artist search row native names, album search result artist names (에스파 across all 8 aespa albums), Charts trending/most-rated sections (에스파, 에이티즈, 마마무, 엔시티 127 all correct; E SENS/Drake/NewJeans correctly stay Latin). Taste/Notifications/Mix Library couldn't be visually exercised — the logged-in test account (`@sillajuku`) had zero ratings/notifications/mixes — but are code+RPC verified the same way the rest of this session's fixes were.
- **Applied and reverified:** `20260703000005` ran clean — all three song-chart RPCs went from timing out under `anon` to <500ms.

**Small terminology fix:** Album release-type label changed 앨범 → 정규 (user's own suggestion). 앨범 is a generic loanword that doesn't distinguish full-length from EP; 정규/미니/싱글 is the three-way split Korean music platforms (Melon, Genie, Bugs) and K-pop fans actually use, shown as standalone tags exactly like this app's badges. Changed in both places it appears: iOS `Localizable.xcstrings` (drives the badge everywhere via `Release.typeLabel`) and web's search filter chip (`lib/i18n/ko.ts`). EP intentionally left as "EP" per explicit direction, 싱글 was already correct. First attempt at the `.xcstrings` edit via a Python JSON round-trip produced a 2000-line diff (Xcode's own key-value spacing conventions don't survive `json.dump`, even without `sort_keys`) — reverted and redid it as a precise text substitution instead, one-line diff.

**Task split with Windows, two follow-up bugs fixed on Mac:** wrote `HANDOFF-WINDOWS.md` dividing the remaining open threads — Windows takes the two open-ended data-sourcing problems (Korean release-title backfill, Korean phonetic search backfill for non-Korean artists), Mac took the smaller/iOS-specific items:
- **`get_charts_most_rated`'s intermittent 500, root-caused:** not a bug in that RPC — the schema renovation dropped `ratings.release_id`/`track_ratings.release_id` (and their indexes) in favor of `release_group_id`/`recording_id`, but never created replacement indexes. The only indexes touching these tables are on `(user_id, release_group_id)`/`(user_id, recording_id)` — useless for the chart RPCs, which join/group on `release_group_id`/`recording_id` alone without a `user_id` predicate, since a composite index only helps via its leading column. Every chart/leaderboard RPC has been running this way since 2026-06-24 — explains "intermittent" well (more likely to tip over as `ratings` grows or under concurrent load, not a deterministic failure). New migration `20260703000007_ratings_release_group_index.sql` adds both missing indexes.
- **`ActivityView.swift` deleted** (previous session's finding: unreachable from any tab). Confirmed it's not just unreachable but genuinely redundant — `HomeView`'s Explore tab already queries `ratings` for the same global-feed concept, just actively maintained (like/comment counts, Explore/Following split) where `ActivityView` wasn't. Its `Date.relativeTimeString` extension was still depended on by 5 other files, though — moved to new `Models/DateFormatting.swift` before deleting, caught by a full rebuild (missed on the first `rm`, build broke with a clear "no member" error, fixed immediately).

---

**2026-07-04 (Mac) — working through the operational-readiness audit's remaining 16 findings:**

User asked to just keep ticking off the original 23-finding audit (the "Start Here" 5 plus 2 more were already done). Picked a batch of the ones that don't need a new external account/service or a dedicated multi-session effort, so forward progress didn't have to wait on any of that.

- **Governing Law clause added to Terms of Service** — the deployment checklist's `[x] Add jurisdiction to Terms of Service (Republic of Korea)` had been a false claim since the audit first caught it (noted 2026-07-03, left alone as lower-priority at the time); now genuinely true. New §9, Contact renumbered to §10.
- **GDPR + CCPA + cookie clarity added to Privacy Policy** — GDPR section covers lawful bases (contract, legitimate interests, consent) and EU user rights including the right to complain to a supervisory authority; CCPA section covers the right to know/delete and confirms no sale of personal information (nothing to opt out of). Cookie section rewritten to state plainly that only strictly-necessary functional cookies are used, which is *why* no consent banner exists — that's the compliant answer for that class of cookie under GDPR/ePrivacy, not a gap to build a banner for. Also fixed the exact same stale "Spotify" data-source reference in §3 that the Terms of Service's §5 had already been corrected for on 2026-07-03 — missed in the Privacy Policy at the time since only Terms was in scope for that fix.
- **`SECURITY.md` added** — scope, response-time expectation, and a request not to test against other users' data or run scanners against prod without asking first.
- **README's Supabase-setup claim corrected** — "Schema is managed via Supabase CLI migrations — no manual SQL editor needed" hasn't been true in practice for a long time (this exact session alone pasted several migrations into the SQL editor because the Mac environment isn't `supabase link`ed). Rewritten to say so plainly, with a pointer to treat the migrations folder as intent, not as proof of what's live.
- **Basic CI added** (`.github/workflows/ci.yml`): a `web` job (Ubuntu — `next lint`, `tsc --noEmit`, `next build`) and an `ios` job (macOS — `xcodebuild` build-only for the simulator destination, no signing needed). Getting `next lint` to actually pass required first noticing *why* it "couldn't run non-interactively" (flagged as a pre-existing gap in an earlier session): `eslint`/`eslint-config-next` were already installed as dependencies, there was just no `.eslintrc.json` telling it what to do, so it fell into an interactive first-run prompt. Added a minimal one extending `next/core-web-vitals`. That then surfaced 6 real `react/no-unescaped-entities` errors (literal `'`/`"` characters in JSX text) across `my-rankings/page.tsx`, `AuthForm.tsx`, and `PlaylistPanel.tsx` — fixed all six (`&apos;`/`&quot;`), confirmed `next lint` exits 0. Confirmed separately that `next build` succeeds even with zero environment variables set (tested via `env -i`), so the workflow doesn't need any GitHub repo secrets configured to produce a meaningful pass/fail signal. **Not yet validated by an actual CI run** — every command was verified locally on this Mac, but a truly fresh Ubuntu/macOS runner (no local caches, no locally-installed toolchain versions) could still turn up something this environment already smoothed over.
- **DB backup script added** (`scripts/backup-db.ts`, `npm run backup:db`) — dumps the user-generated tables to a timestamped JSON under `backups/` (gitignored), paginated per table with a stable order column (most tables key on `id`, but `follows`/`blocked_users` use composite keys with no `id` at all — first run surfaced this immediately as a real bug, `.order('id')` doesn't exist on those tables). Deliberately scoped to user-generated content only, excluding: the music catalog (artists/release_groups/releases/recordings/tracks — re-derivable from the pipeline, would balloon the dump to hundreds of thousands of rows for no DR benefit) and `spotify_connections` (live OAuth access/refresh tokens — copying credentials into a backup file is an exposure, not a safeguard, and this data isn't "content" in VISION.md's "the ratings table is the real asset" sense anyway). Restore is deliberately manual, not a one-command tool.
- **Found while building the backup script: `blocked_users` was never actually created live.** `.from('blocked_users').select()` returned `PGRST205` — table doesn't exist — despite being defined in `20260625000001_report_block.sql` in the *same* `BEGIN`/`COMMIT` transaction as `reports`, which does exist. Since a single transaction is atomic, this can only mean that migration was applied partially (e.g. only the `reports` half was pasted into the SQL editor), not that the table was dropped afterward. **Practical impact: every block attempt, on both web (`ReportBlockMenu.tsx`) and iOS, has been silently failing since Report/Block shipped** — reports work, blocking specifically does not, and nothing in either client's error handling would have made that obvious. New migration `20260703000008_blocked_users_missing.sql` recreates it verbatim (`CREATE TABLE IF NOT EXISTS`, safe regardless of actual current state). **Needs to be applied** before Block will actually work.
- **Deliberately not attempted this pass** (each needs either a new external account/service, or is large enough to be its own session): no staging environment, no uptime/health alerting (needs an external monitor), no lifecycle/transactional email (needs an email-sending account), iOS accessibility support, deep linking/Universal Links (needs Apple Developer Portal + hosting coordination for the domain-association file), feature flags (PostHog already supports them, just nothing to flag yet), unstructured logging, sitemap/structured data (the audit itself says this is correctly deferred pre-launch, per `robots.ts`'s intentional `Disallow: /`).

---

**2026-07-04 (Mac) — first automated tests, both platforms:**

Picked "zero automated tests" off the same audit list next — the highest-severity remaining finding that didn't need a new external account. Scoped deliberately narrow for a first pass: pure, dependency-free business logic only, not an attempt at broad coverage.

- **Web (Vitest):** installed as a devDependency, `vitest.config.ts` pointed at `lib/**/*.test.ts`. `lib/elo.test.ts` — 31 assertions covering `kFactor`'s three-tier schedule, `expectedScore`'s symmetry property, `updateElo`'s winner-up/loser-down + games-increment + K-factor-by-experience behavior, `eloToScore`'s monotonicity and its documented sentiment-seed anchors (bad≈1.4, neutral=2.5, good≈3.6), `starToElo`'s monotonicity, and `deriveInstinctScores`. `lib/sillaScore.test.ts` — `computeTierlistScores`' effective-position math (including the tied-rank averaging case) and `combineSillaScores`' 0.55/0.45 rating/rank blend and within-category normalization. All 31 passed on the first run, confirming the tests' understanding of the documented behavior matches the implementation exactly. Deliberately skipped `accomplishments.ts` and `rateLimit.ts` — both are thin Supabase/Redis/Upstash wrappers, not pure logic; testing them meaningfully would need real mocking infrastructure for comparatively low value versus the rating-math modules the audit specifically called out.
- **iOS (XCTest):** no test target existed in `project.pbxproj` at all. Hand-editing the pbxproj to add a new *target* (not just a file reference) is a materially bigger risk than the file-reference edits already done safely elsewhere this session — this project's own history already avoided raw pbxproj edits once this session for exactly this reason (the Sentry SPM package reference was punted to Xcode's GUI). Used the `xcodeproj` Ruby gem instead — the same purpose-built library CocoaPods and Fastlane rely on for this — to create a `sillajukuTests` unit-test-bundle target, wire its `TEST_HOST`/`BUNDLE_LOADER`/dev team/code-sign-style to match the main target, and add file references. One real bug in the process: the gem's `new_target` helper didn't set `PRODUCT_NAME`, which surfaced immediately as a hard build failure ("Multiple commands produce '.../PlugIns/.xctest'" — an empty product name), fixed by setting it explicitly to `$(TARGET_NAME)`. Final `project.pbxproj` diff was cleanly additive (134 insertions, 0 deletions) — the gem preserved the existing file's structure, unlike the earlier JSON-round-trip lesson with `Localizable.xcstrings` this session.
- **`ReleaseTests.swift`** (15 tests) and **`DateFormattingTests.swift`** (7 tests) — covering `isPredominantlyHangul`'s script-detection edge cases (pure Hangul, pure Latin, Japanese katakana specifically since that's a real production case for non-Korean artists, mixed-script majority/minority, empty string, punctuation-only), `displayTitle`/`displayArtist`'s native-vs-fallback branching, `typeLabel`'s case-insensitivity and unknown-type passthrough, and the exact minute/hour/day/week boundaries in `relativeTimeString`. Two tests failed on the first run — both were wrong test assumptions, not code bugs, and instructive ones: (1) assumed `isPredominantlyHangul` would reject a birth name stored in Hangul (e.g. E SENS's "강민호") — it can't, because it's a *script* check, not an *identity* check; distinguishing "genuinely this artist's Korean name" from "technically Korean script but the wrong identity" is exactly why that correction had to happen in the database via `fix-bad-native-names.ts`, not in this display function, which has no way to know the difference on its own. (2) miscounted Latin vs. Hangul letters in a hand-picked mixed-script test string ("NCT 드림" is actually a Latin-letter majority — 3 vs. 2 — not the Hangul-majority case the test claimed to cover). Fixed both once the mistake was clear; all 22 iOS tests pass, and the full app build was reverified unaffected by the new target.
- **Wired into `.github/workflows/ci.yml`** from the previous session's CI work: web job runs `vitest run` before `next build`; iOS job switched from build-only to `xcodebuild test`, which needs a concrete simulator destination (`platform=iOS Simulator,name=iPhone 16 Pro`) rather than the build-only job's generic one — flagged in a comment in case that exact simulator isn't preinstalled on the actual runner image, since this hasn't been validated by a real CI run yet (same caveat as the rest of the CI setup).

---

**2026-07-04 (Mac) — Add tab icon as a standalone action button:**

Follow-up to the icon-only tab bar: user wanted the Add tab to visually stand out rather than blend in as a 5th destination (like Threads/TikTok/Instagram's center compose button), then asked to make it bigger and wider than tall.

- **First pass**: `"plus.app.fill"` SF Symbol with `.symbolRenderingMode(.palette)` + `.foregroundStyle(.white, .black)` + `.renderingMode(.original)` — a black rounded-square with a white plus, immune to the tab bar's selection tint (stays black/white instead of shifting to `sjAmber` like the other 4 tabs). Verified via screenshot.
- **Wider/bigger request**: SF Symbols can't be non-uniformly scaled — every symbol has a fixed baked-in aspect ratio, so `"plus.rectangle.fill"` still rendered close to square. Switched to a fully custom icon instead: a `RoundedRectangle` + two white bars (a plus, not an `Image(systemName:)` — SF Symbols rendered via `ImageRenderer` outside a live view hierarchy came back blank, likely a context/timing issue) at an explicit 40×26pt frame, rasterized once via `ImageRenderer` into a static `UIImage`.
- **Bug caught via screenshot**: the custom bitmap first rendered as one solid black pill with no visible plus — the tab bar was treating the raw `UIImage` as a template/silhouette image (alpha-only, ignoring RGB), so the black background and white plus (both fully opaque) flattened into a single shape. SwiftUI's `.renderingMode(.original)` modifier doesn't propagate through the legacy `.tabItem`/`.tag()` bridge for a plain bitmap. Fixed with `image.withRenderingMode(.alwaysOriginal)` on the `UIImage` itself (the UIKit-level property, not the SwiftUI modifier) — confirmed via screenshot: correct black rounded rect, wider than tall, larger than the other tab icons, white plus clearly visible.

---

**2026-07-04 (Mac) — icon-only bottom tab bar:**

User request: remove all text labels from the 5-tab bottom `TabView`, icons only. Reverted from the modern `Tab(_:systemImage:value:)` struct API (which always renders a text label under the icon, no way to suppress it) back to the classic `.tabItem { Image(systemName:) }` + `.tag()` pattern — omitting `Text` from `.tabItem`'s content is the reliable way to get icon-only tabs. Added `.accessibilityLabel(String(localized:))` per tab reusing the already-translated catalog keys (Home/Charts/Add/Taste/Profile → 홈/차트/추가/취향/프로필) so VoiceOver isn't regressed by the switch. Verified: `xcodebuild build` clean, screenshot confirmed no text under any of the 5 icons, and tab-switching re-tested (tapped Charts icon → correct tab highlighted + content loaded) since the selection binding moved from the `Tab` struct's `value:` to `.tag()`.

---

**2026-07-04 (Mac) — iOS accessibility, first pass:**

Picked "iOS has no accessibility support" off the audit list next. Confirmed the finding first — `grep -rc "accessibilityLabel\|accessibilityHint\|dynamicTypeSize" --include="*.swift" .` across all 37 Swift files returned nothing. Scoped deliberately to purely additive, low-risk fixes (icon-only controls, meaningful images) — explicitly NOT a Dynamic Type / font-size overhaul, since the app's layouts are tuned to fixed point sizes throughout this whole session and blanket-converting to scalable text risks breaking many screens without dedicated per-screen visual testing. That's a real, separate, bigger follow-up, not something to fold in here.

- **Scoped via an Explore agent** across all 37 files rather than ad-hoc grepping — found ~20 icon-only interactive control sites (kebab/"more" menus, like/comment toggle buttons, 4 separate "clear search (×)" buttons, ProfileView's 3-icon tab bar + 2-icon display-mode toggle, delete/send/add buttons) and ~35 cover-art/avatar image sites, with file/line/symbol-name detail for each.
- **Icon-only controls** all gained a real `accessibilityLabel`, reusing whatever string was already in scope at that call site (`release.displayTitle`, `track.title`, `profile.displayName`, a user's `handle`) rather than writing throwaway fresh copy wherever one was available. A few needed fresh copy since nothing was nearby: settings gear, find-people icon, bell, ellipsis menu, send-comment arrow, the 4 clear-search buttons, ProfileView's tab bar (added a `label` computed property to `ProfileTab` — reused the already-Korean-translated "Rated"/"Stats" keys, only "Lists" was new), and the list/post display-mode toggle.
- **`StarRatingView`** (`AlbumDetailView.swift`) got a proper treatment, not a token label — the 5 individual stars are meaningless to VoiceOver navigation since the half/full tap zones don't map to swipe gestures. Restructured as one `accessibilityElement(children: .ignore)` with a spoken `accessibilityValue` ("3.5 out of 5 stars" / "Not rated") and, when `interactive`, an `accessibilityAdjustableAction` incrementing/decrementing by 0.5 — matching how a native slider behaves. First implementation used a generic `View.modify { }` extension to conditionally attach the adjustable action only when interactive; simplified to a plain `let base = ...; if interactive { base.accessibilityAdjustableAction {...} } else { base }` instead, since the custom extension wasn't pulling its weight for a one-off conditional.
- **Cover-art/avatar images**: the large majority sit directly beside a visible title/artist `Text` in the very same row (feed cards, search results, ranking rows, mix items, etc.) — giving the image its own `accessibilityLabel` there would make VoiceOver announce the same title/artist twice. Marked `.accessibilityHidden(true)` instead, which is the actually-correct pattern per Apple's accessibility guidance (don't caption an image when adjacent text already conveys the same information), not a shortcut. Real labels were reserved for the minority of cases where an image is the *sole* content with nothing nearby: `RankingBlock`'s collapsed 3-item teaser (cover + rank badge only, no visible title anywhere in that specific view) got a full `"#1 Title by Artist"` label built from `entry.displayTitle`/`displayArtist`; `EditProfileView`'s photo picker and `ProfileView`'s own-avatar circle got `"Change profile photo"` / `"Your profile photo"`.
- **21 new strings** added to `Localizable.xcstrings` with Korean translations, checked individually against the existing catalog first — `"Notifications"`, `"Settings"`, and `"More options"` already existed (알림/설정/더 보기) and were reused rather than duplicated; the other 21 were genuinely new. Inserted as a precise text block (not a JSON round-trip) immediately following the existing `"Rated"` entry, keeping the same lesson from the 앨범→정규 fix earlier this session: `json.dump` reformats the *entire* file's key-value spacing even without `sort_keys`, since Xcode's own convention (`"key" : value`, space before the colon) doesn't survive a Python re-serialization. Confirmed via `git diff --stat`: 210 insertions, 0 deletions — purely additive.
- **Verified clean at every stage, not just at the end** — full `xcodebuild build` and the `sillajukuTests` suite (22 tests) both reverified after the icon-button pass, after the image pass, and again after the Korean-translation insertion.

---

**2026-07-02 (Mac) — iOS UI polish pass (20 items):**

All changes are iOS Swift. No migrations, no web changes.

**Rating modal fixes:**
- `InstinctRatingView` + `InstinctTrackRatingView`: all phases (bucket, postRating, comparing, done) now stay locked at `.fraction(0.36)` — no size change after first tab. `onChange(of: vm.phase)` forces `sheetDetent = .fraction(0.36)` on every transition.
- Instinct bucket tap no longer writes to DB. `seedAndContinue()` only sets local Elo state (`newElo`, `newEloGames`). The initial DB upsert + ratingId fetch moved into `continueFromPostRating()` — no rating row exists until the user taps Continue.
- `ManualRatingSheet.ratingView` + `TrackRatingSheet` redesigned to match instinct modal: horizontal header (52pt cover + VStack(title, type badge, artist)), `Spacer(minLength: 0)` top+bottom for centering, `Divider`, 26pt score — fitting within `.fraction(0.33)`. Removed the manual drag handle widget (system `presentationDragIndicator(.visible)` handles it).
- Tapping the rated score pill on the album page opens the re-rank/edit modal: instinct score pill → `Button { showInstinctSheet = true }`; manual stars+score → `Button { showManualSheet = true }`.
- `ManualRatingSheet` back button: `PostRatingOptionsView` has `onBack: (() -> Void)?`; tapping "← Back" returns to the rating phase at `.fraction(0.33)`.

**Song page instinct routing:**
- `SongDetailView` accepts `var ratingMode: String = "manual"` and routes "Rate this track" to `InstinctTrackRatingView` when `ratingMode == "instinct"`. `AlbumDetailView` passes `viewModel.ratingMode` at the call site.

**Type labels everywhere:**
- `Release.typeLabel` computed property added to `Release.swift` (Album/EP/Single/Song).
- Applied to: `DiscoveryAlbumCard` (badge next to artist), `SongRow` ("Song" badge next to title), `InstinctRatingView` + `InstinctTrackRatingView` bucket views, both redesigned manual rating sheets, and `PostRatingOptionsView` album header.

**Home feed:**
- Title 15→17pt bold, type·artist 13→14pt, score moved to trailing (chevron removed).
- `contentMargins(.top, 90)` → 52 to close gap between floating Explore/Following header and first post.
- Post card padding trimmed (cardHeader top 12→10, bottom 10→6; actionBar vertical 8→6; albumSection bottom 14→10).

**Charts + Rankings:**
- Country filter: flag emojis removed (`"🇰🇷 KR"` → `"KR"` etc.) in `RankingSection` + `RankingDetailView`.
- Rank "100" line-break fixed: `RankedListRow` frame width 22→30 + `.lineLimit(1)`.
- "See all" → "View all" throughout `RankingsView`.
- Empty `GenreScrollSection` + `YearScrollSection` removed from Albums tab (structs kept, unused).
- Charts breathing room: section bottom padding 22→30, final 32→40, `contentMargins` 54→64 on both tabs.

**Delete confirmations:**
- `ProfileView`: `pendingDeleteItem: ProfileRatedItem?` drives a `.confirmationDialog` before `viewModel.deleteRating()` fires. Both list-mode and posts-mode long-press menus set `pendingDeleteItem` instead of deleting immediately.
- `AlbumDetailView`: trash button sets `showDeleteRankingConfirm = true`; `.confirmationDialog` guards the delete.

**Dark mode + visual:**
- `sjCream` dark: 0.067 → 0.020 (near-pure black #050505). `sjSurface` dark: 0.118 → 0.067 (#111111). `sjBorder` dark: 0.173 → 0.118 (cascaded).
- `TrackRow` title color: `Color.sjBlue` → `Color.sjInk` (tracklist songs no longer appear blue).
- Comment icon: `bubble.right` → `bubble.left` (Instagram-style).

---

**2026-07-01 (Mac) — Delete account fix + post-rating comment flow + profile posts view + delete ratings:**

Four features shipped, all iOS.

**Delete account fix:**
- Root cause: Vercel silently redirects `sillajuku.com` → `www.sillajuku.com`; iOS `URLSession` drops the `Authorization` header on redirect per HTTP security spec. Fix: `Config.webBaseURL` changed to `https://www.sillajuku.com` — app now hits the canonical domain directly, no redirect.
- `authGuard.ts` also updated from raw fetch to `supabase.auth.getUser(token)` via SDK (old approach used raw fetch with `sb_publishable_` key format that Supabase no longer validates the same way). Debug logs added to diagnose, removed once confirmed working.

**Post-rating comment + list flow (`ratings.review_text`):**
- Migration `20260701000001_ratings_review_text.sql` adds `review_text text` to `ratings` — ✅ applied.
- New `PostRatingOptionsView.swift`: inline expandable comment field (no sub-save button), "Add to a list" opens `MixPickerView`. "Continue" passes text to caller; "Skip" passes nil.
- Instinct mode (`InstinctRatingView.swift`): new `.postRating` phase after bucket selection. `pendingReviewText` stored in VM, written to DB in `finalize()` alongside the final ELO update. Comment is never saved prematurely.
- Normal mode (`AlbumDetailView.swift` `ManualRatingSheet`): after save, fetches rating ID, expands sheet to `.medium`, shows `PostRatingOptionsView`. `saveReviewAndDismiss()` writes `review_text` then dismisses (rating already saved).
- `HomeView.swift` `FeedCard`: shows `review_text` (if non-empty) between the album section and the action bar.

**Profile posts display mode (`ProfileView.swift`):**
- `RatingDisplayMode` enum (`.list` / `.posts`). Toggle on the right side of the `[All|Albums|Songs]` filter row — `list.bullet` / `newspaper` icons.
- Posts mode: `ProfilePostCard` — 72px cover, title, type·artist, score chip, review text if set, action bar (♡ likes · 💬 comments · relative date). Backed by bulk-fetched `likeCounts` + `commentCounts` from `rating_likes` / `rating_comments`.
- `ReleaseRef.typeLabel` computed property added (Album/Single/EP/Release).

**Delete ratings from profile:**
- `ProfileViewModel.deleteRating(_ item: ProfileRatedItem)`: optimistic local remove + DB delete. Albums: `DELETE FROM ratings WHERE id = r.id`. Songs: `DELETE FROM track_ratings WHERE user_id = userId AND recording_id = r.recordingId`.
- Long-press context menu ("Delete Rating", destructive) wired to both list-mode rows and posts-mode cards.

**Commits this session:** `fddecec`, `6b33b99`, `20923b5`, `06c3f5d`, `2b5d748`, `ee2122a` — all pushed.

---

**2026-06-30 (Windows) — Data-quality review + iOS hand-off:**

Investigated 6 reported catalog/UX gaps directly against prod (read-only query scripts, since removed). Findings:
- **#1 Missing artists** — `yanghongwon, ksmartboi, paloalto, zico, jmin, okashii, don toliver` are absent from `artists` **and** the ingestion queue → won't be collected after the drain. MB has almost all of them (ZICO[KR], Paloalto[KR], Don Toliver[US], ksmartboi, OKASHII, JMIN, BewhY, YANGHONGWON "formerly Young B"); `lov3rboi` is **not** in MB (Deezer-fallback only). Resolver caveat: bare "Zico" resolves to a French rapper above the KR ZICO → must queue by **MBID**.
- **#2 Collab albums** — schema has only one `primary_artist_id` per release group (no multi-artist join table; `release_group_artists` etc. don't exist). "4 the Youth" (`artist_display="JUSTHIS & Paloalto"`) is attached to JUSTHIS only; Paloalto has no row. 4,207 RGs have `&`, 1,788 `feat`, 208 `X`.
- **#3 Kanye/Ye** — **not** a duplicate row. One artist (`Ye`, name_native "Kanye West", aliases incl. "Kanye West"). The app splits him because it derives artist entries from the free-text `artist_display`: his 201 RGs carry 119×"Kanye West" + 37×"Ye" + collab variants. Same root cause as #2.
- **#4 Search** — lexical, not embeddings. Both web (`search_releases` RPC) and iOS (`ILIKE %q%`) match raw substrings with no punctuation/space normalization. "new jeans"✗"NewJeans"; "sikk"✗"Sik-K" — and Sik-K is stored with **U+2010** (typographic hyphen), so even "Sik-K" with a normal hyphen misses.
- **#5 Covers** — `Get Up (EP)` genuinely null; **21,476/72,908 (29.5%)** release_groups have no cover (album 28.2% / ep 24.2% / single 29.2%). GAPFILL is behind.
- **#6 Avatars** — `artists.cover_url` exists, **0/2641** populated.

**Plan → 5 work items:** A artist-identity join table (`release_group_artists`, fixes #2+#3), B search normalization (#4), C cover backfill (#5), D queue-missing-by-MBID (#1), E avatar backfill (#6). User confirmed the join table (per stated spec: each credited artist a separate tappable link on the album page; album shows on both artist pages). Wrote **[`DATA_FIXES_IOS.md`](DATA_FIXES_IOS.md)** — full Mac/iOS hand-off with the DB contracts (table + `search_release_groups` / `search_artists` / `get_artist_release_groups` / `get_release_group_credits` RPCs) Windows is building, so Mac can build in parallel (`try?`-degrades until the migration lands).

**Windows build (all 5 items, typecheck-clean, committed):**
- **B — search normalization:** migration `20260630000000_search_normalize.sql` — `normalize_text()` (lowercase + strip `[:space:][:punct:]`, keeps Hangul; catches the U+2010 hyphen), `search_release_groups()` + `search_artists()` RPCs (functional trigram indexes), repointed web `lib/dbCache` (`searchReleases`→`search_release_groups` over release_groups, fixing post-renovation edition-dupes; `searchArtistsInDb`→`search_artists`, identity-deduped). Removed dead `escapeIlike`.
- **C — covers:** `backfill-rg-covers-caa.ts` (`covers:caa`) — Cover Art Archive **release-group** endpoint (the ingest only tried release-level). **Ran the album/EP batch** (5,600): ~50% hit (the rest have no CAA art → iTunes/Spotify territory), incl. NewJeans *Get Up*. `--all` extends to the ~16k singles.
- **D — missing artists:** `data/missing-artists.ts` (8 MBID-verified) + `seed-missing-artists.ts` (`seed:missing`). Generalized pipeline.ts MBID-direct path to a curated `source='mbid'` (was listenbrainz-only) so a name search can't mis-resolve (Zico→French rapper). **Restart-gated:** restart pipeline (loads `mbid` source) → then `seed:missing`.
- **A — join table:** migration `20260630000001_release_group_artists.sql` (`release_group_artists` + `get_artist_release_groups` UNION-ing primary_artist_id with credits + `get_release_group_credits` with primary fallback). Ingest write-path: `MbReleaseGroup.credits` surfaced in mb-client; `findOrCreateArtistStub` (clickable `credit_stub` rows for un-ingested collaborators, keyed by MBID) + `writeReleaseGroupCredits` in mb-ingest (guarded if table absent). Backfill `backfill-rg-credits.ts` (`backfill:rg-credits`) for existing collab groups — **MB-contending, run during a pipeline pause (~2h)**.
- **E — avatars:** `backfill-artist-avatars.ts` (`backfill:avatars`) — Deezer `picture_xl`, strict normalized name/native match (no wrong faces; ~88% match in sample). **Ran** the full 2,641-artist pass.

Activation order in README START HERE: apply 2 migrations → deploy web → restart pipeline → `seed:missing` → (pause) `backfill:rg-credits`. Pushed.

**Catalog expansion (after the fixes landed):** the `backfill:rg-credits` run created **4,665 `credit_stub` artists** (every collaborator on an album we have, MBID-known but no own discography) — total artists 2,641 → **7,243**. Three expansion lanes, all queue `source='mbid'` (MBID-direct, no name resolution):
- **#1 stubs — `queue:stubs`** (`queue-stubs.ts`): queued **4,660** stubs for full ingestion — the strongest non-arbitrary signal (artists demonstrably connected to existing catalog). Pure DB inserts, safe alongside the live pipeline. (Bug found+fixed: a 500-UUID `.in()` overflows the request URL and silently returns nothing → batch to 100.)
- **#2 curated KR roster — `queue:names --list=kr-scene --region=KR`** (`queue-by-name.ts` + `data/kr-scene.ts`, 111 names): **86 queued** (all correct), 1 ambiguous (Young B → already YANGHONGWON), 9 no-match (Gray/Dean/BIBI/Woo Won Jae/Sole/George/Blase/Jasmine Sokko/Hate the Sun — generic-name/MB-indexing hard cases needing explicit MBIDs in `data/missing-artists.ts`).
- **#3 search-miss recovery — `queue:misses`** (same script, reads `search_misses`): **2 queued** (the black skirts→검정치마, fred again..); *dress* safely skipped as ambiguous. Pre-launch only 4 misses exist; this is the post-launch self-healer (wire to a cron later). `queue-by-name` only queues confident, UNAMBIGUOUS resolver matches.

~4,750 artists now pending MBID-direct ingest; the live pipeline drains them over time (each stub ingest spawns its own collaborators → re-run `queue:stubs` periodically to snowball). Scripts committed + pushed.

**Comprehensive area discovery + search-miss cron (follow-up — "way more than 9 missing"):** the kr-scene no-match analysis exposed the real limit — English-name search structurally misses Korean artists stored under Hangul (그레이/딘/비비/우원재…). **MB has 15,540 `country:KR` artists vs our ~525.**
- **`discover-mb-area.ts` (`discover:area`)** + `mb-client.searchArtistsByQuery`: pages an arbitrary Lucene query (`--country=KR [--tag= --type= --limit=]`) and queues each artist by the **MBID in the result** — so Hangul-named artists (incl. 7 of the 9 kr-scene no-matches) come along with no name resolution. **⚠️ pages MB heavily → run during a pipeline pause** (a dry-run alongside the live pipeline got throttled to 0; a single direct call confirmed 15,540). Verified working (TWICE/BoA/BTS…). The 2 resolvable no-matches (BLASÉ [KR], Jasmine Sokko [SG]) pinned in `data/missing-artists.ts`.
- **Search-miss self-healer (cron, built into the pipeline):** migration `20260701000000_search_misses_queued.sql` adds `search_misses.queued_at`; `pipeline.ts` `tryMisses()` runs in the ingest lane's **idle** time — resolves un-queued misses → queues confident matches by MBID, marks `queued_at` (tried once). Pre-launch `search_misses` is ~empty; this is the post-launch self-healer with no external cron needed. Restart-gated + needs the migration.

**Urgency-based discovery (discover by fame, not region — `discover:popularity`):** `discover-popularity.ts`. Per the decision "do the famous global gaps before Korea's long tail." Signal = **Last.fm** (mainstream-weighted + carries MBIDs, unlike LB sitewide which is Western/indie-skewed and MBID-less): worldwide `chart.getTopArtists` + per-country `geo.getTopArtists` (~24 countries for J-pop/Latin/etc. balance; KR has no Last.fm chart → stays on `discover:area`). Ranks by listeners, resolves the MBID-less minority via MB (unambiguous only), **queues with `created_at` staggered by rank from a backdated base (2018) so the FIFO ingests most-famous-first**, ahead of the launch tail/stubs. Verified (global top-500 dry-run → 201 new famous artists: Queen/Maroon 5/SOAD/Pink Floyd…; the very top like Radiohead/Beatles already ingested → skipped). **Run during a pipeline pause** (Last.fm fast, but the MBID-less resolution hits MB). Tunable: `--limit`/`--global-pages`/`--geo-pages`/`--countries`/`--base`.

**2026-06-29 (Windows) — Prestige Western-ingest + RS500/Pitchfork/Brit sources + padDate fix:**

Executed the Windows prestige prompt (pulled the Mac's `external_scores`/seeder/`get_silla_leaderboard` work first — merged `origin/main` twice incl. `becbb47` TS-fix, no conflicts).

- **Track 1 — Western ingest:** the leaderboard was Korean-only because Western prestige artists weren't ingested (no `release_groups` to reconcile against). Queued **726 modern (post-1990) prestige artists** from the pending `external_scores` set into `artist_ingestion_queue` at **priority** (`source='prestige'`, backdated `created_at='2020-01-01'` → claimed ahead of the 5k tail); obscure pre-1990-only artists left to drain naturally. Catalog grew **16k → ~71k release_groups** (canon is compilation-heavy — Beatles 1,730 releases, Sinatra, etc.; comps now 23% + soundtracks 4.6%, kept as authentic). `reconcile_prestige_scores` `updated=` climbs as they land.
- **Track 2 — 4 new sources** (all typecheck-clean, seeder cases added; `/browse` isn't registered in this harness → used WebFetch, allowed under the "no chrome-MCP" rule):
  - **`data/rs500.ts`** — Rolling Stone 500 (2020), all 500 with **hardcoded MB release-group MBIDs** pulled from MB's curated series (`?inc=release-group-rels+artist-credits`, one call → rank/album/artist/year/MBID). Hardcoded MBIDs = seeder skips MB search = zero pipeline contention.
  - **`data/pitchfork-perfect.ts`** — 175 perfect-10.0 albums (Wikipedia "List of albums awarded 10 by Pitchfork"; VA comps excluded).
  - **`data/brit-album.ts`** — BRIT Album of the Year 1977–2026, 222 (46 winners).
  - **`grammy-dance-electronic.ts`** — filled 2009–2013; corrected the 2009 winner (was mislabeled `2008`) + 2018 (real winner Kraftwerk *3-D The Catalogue*; dropped wrong Calvin Harris nominee).
  - **Seeded all:** `external_scores` 2,250 → **3,219**. reconcile climbed **315 → 378 (RS500) → 402 (Pitchfork) → 409 (Brit)**, then the Grammy-Dance reconcile **timed out (57014)** — the prestige UPDATE can't finish while 726 artists hammer `release_groups`. **Re-run `npm run prestige:reconcile` once the queue drains / pipeline paused** for the real (much higher) number. 28 entries (9+8+11) stored without MBID (pending; symbol/comp titles MB search missed).
- **`padDate` bug found + fixed (committed `2928721`):** MB emits partial dates with `??` ("1994-??-11", "????-03-01") that Postgres rejects → aborted the whole artist ingest (Mariah Carey, Luther Vandross, Damon Albarn `failed`). `padDate` now normalizes `??`→`01` (unknown year→null). After restart, verified live — Luther Vandross re-ingested cleanly (71 RGs, no crash); the 3 re-queued (attempt_count→0).
- **Cleanliness audit (post 4× growth):** clean — source-pure (70.6k MB · 358 deezer · 0 itunes/null), special-MBID blocklist holding (0 VA leaks), 0 broken FKs, canonical intact. Benign: 3 duplicate names (김광석 singer/drummer · S.E.S. group/jungle · Cream supergroup/Polish-DJ — each partner 0 RGs). Cleaned 1 orphan release ("Salad Days", null RG).
- **Git:** 5 local commits (this session's pipeline + prestige work), **not pushed** (hold-push preference).

**2026-06-29 (session 3) — Grammy genre sources blitz + RankingBlock wired (Mac):**

Finished the Western prestige collection pass on Mac and wired the iOS Charts RankingBlock to real data.

**iOS: RankingBlock self-contained (`apps/ios/sillajuku/sillajuku/Main/RankingsView.swift`):**
- Was reading `viewModel.topRated` (community avg via `get_charts_top_rated`); genre/country filters were decorative.
- Now manages its own state: `@State private var entries/isLoading/isExpanded/selectedGenre/selectedCountry`.
- Calls `get_silla_leaderboard` (p_limit=10) on `.task` and `.onChange(of: selectedGenre/selectedCountry)`.
- `sillaScore × 5.0` for badge display (maps [0,1] → [0,5]). Spinner shown while loading/reloading.
- Call site simplified: `RankingBlock()` (no `entries:` param).

**New data files (`apps/web/scripts/data/`):**
- **`grammy-rap.ts`** — Grammy Best Rap Album, 1996–2026, ~130 entries (winners + nominees).
- **`grammy-rnb.ts`** — Grammy Best R&B Album, 1995–2026, ~140 entries.
- **`grammy-rock.ts`** — Grammy Best Rock Album, 1995–2026, ~120 entries.
- **`grammy-alternative.ts`** — Grammy Best Alternative Music Album, 1991–2026, ~115 entries.
- **`grammy-pop-vocal.ts`** — Grammy Best Pop Vocal Album, 1968 + 1995–2026, ~100 entries.
- **`grammy-dance-electronic.ts`** — Grammy Best Dance/Electronic Album, 2005–2026 (2009–2013 omitted — uncertain nominees; 2018 winner TBD, needs Windows `/browse` to verify).

**Seeder updated (`apps/web/scripts/seed-external-scores.ts`):**
- 6 new cases: `grammy_rap`, `grammy_rnb`, `grammy_rock`, `grammy_alternative`, `grammy_pop_vocal`, `grammy_dance_electronic`.
- Available sources list in help text updated to full inventory.
- All 6 sources seeded successfully. Reconcile runs automatically at end of each seed.

**Status after seeding:** reconcile updated/pending numbers TBD (ran automatically after each seed). The leaderboard is still Korean-dominant because 452 pending entries in `external_scores` are Western artists not yet ingested by the pipeline.

**Windows prompt drafted (ready to send):** Two tracks — (a) pipeline: ingest Western artists to resolve the 452 pending entries; (b) sources via `/browse`: RS500 (500 entries, `list_rank`, `normalizedScore=(501-rank)/500`, tier 2), Pitchfork 10.0 (`normalizedScore=1.0`, tier 2), Grammy Dance/Electronic 2009–2013 + 2018 winner gaps, Brit Award Album of the Year (optional). After seeding: `npm run prestige:reconcile`.

**Year convention note (all Grammy files):** `year` = ceremony year, not album release year. Consistent with grammy-aoty.ts convention.

---

**2026-06-28 (session 2) — Korean prestige sources blitz (Mac):**

Completed Weiv AOTY 2015–2019 and seeded 5 new Korean prestige sources. Total: 15 sources in `external_scores`, 247 release_groups with `prestige_score`, 452 pending (will resolve as pipeline ingests more artists).

**Data files created/updated:**
- **`scripts/data/weiv-aoty.ts`** — Completed: 50 entries, 2015–2019. 2019 unranked (rank=null, score=0.8); 2015–2018 ranked top-10 (score=(11-rank)/10). 2016 has tied rank 8 (실리카겔 + 구텐버즈, both score=0.3); rank 9 skipped; rank 10 = BTS Wings. 2017 rank 1 = Red Velvet — Perfect Velvet. Source: Weiv.co.kr archive (2020+ confirmed doesn't exist — HTTP 500 on all IDs above 24366).
- **`scripts/data/golden-disc-daesang.ts`** — NEW: 40 entries, 1986–2025. 음반 대상 (Album Grand Prize) winners. `award_win`/1.0/tier3. Key: 조용필 (1986), H.O.T. (1997), god (2001), TVXQ (2006, 2008), Super Junior (2009, 2011, 2012), Girls' Generation (2010), EXO (2013–2016), BTS (2017–2022), Seventeen (2023–2024), Stray Kids (2025). Source: Wikipedia.
- **`scripts/data/golden-disc-bonsang.ts`** — NEW: 134 entries, 2017–2025. 음반 본상 (Album Main Prize). `award_nomination`/0.35/tier3. Daesang winners not duplicated here. Counts: 2017(9), 2018(10), 2019(10), 2020(29), 2021(29), 2022(20), 2023(9), 2024(9), 2025(9). Source: Wikipedia individual ceremony pages (32nd–40th). ⚠️ English Wikipedia 38th page had wrong winner (NewJeans/FML) — used Korean Wikipedia which correctly shows Seventeen.
- **`scripts/data/mma-aoty.ts`** — NEW: 17 entries, 2009–2025. Melon Music Award for Album of the Year. `award_win`/1.0/tier3. Source: Wikipedia.
- **`scripts/data/sma-album.ts`** — NEW: 10 entries, 2013–2023. Seoul Music Awards Best Album Award (years with confirmed titles only; 2019 and 2024 omitted — no confirmed album title). `award_win`/1.0/tier3. Source: Wikipedia.
- **`scripts/data/izm-aoty.ts`** — UPDATED: added 2023 (10 entries). Now 2023–2025. Note: RM's *Indigo* (Dec 2022 release) appears in IZM's 2023 list — kept as year=2023.

**Seeder cases added** (in `seed-external-scores.ts`): `weiv_aoty`, `golden_disc_daesang`, `golden_disc_bonsang`, `mma_aoty`, `sma_album`.

**Sources inaccessible (gaps):**
- Weiv 2020+ — confirmed doesn't exist (Weiv stopped publishing domestic AOTY after 2019).
- IZM 2015–2022 — m.izm.co.kr ENOTFOUND; archive.izm.co.kr domain-squatted (SSL mismatch pointing to bombit.or.kr). Only 2023–2025 accessible on new site.
- Hiphopplaya Awards 2001–2016 — awards.hiphopplaya.com ECONNRESET / rate-limited during session.

**Golden Disc year convention:** ceremony year ≈ album release year; coverage window ~Nov 1(year-1)–Oct 31(year); e.g. BTS - *BE* (Nov 20, 2020) falls under year=2021. All entries follow Golden Disc's own labeling, not album release date.

**Final reconcile stats:** updated=247, pending=452. BTS albums (Love Yourself: Her, Answer, Map of the Soul: Persona/7) stored as pending — will resolve when pipeline ingests them.

---

**2026-06-28 (session 1) — Prestige system redesign + Grammy AOTY + Mercury Prize seeded (Mac):**

- **Architecture pivot:** scrapped Spotify-ID-keyed `external_scores` — the MB pipeline never writes `releases.spotify_id`, so the old 3-hop bridge `external_scores.release_id → releases.spotify_id → release_group_id` was broken for all MB-ingested albums. Redesign: `external_scores` is now MBID-keyed (`mb_release_group_id`), no scope columns (filtering is UI-only), deferred injection pattern (store with MBID → `reconcile_prestige_scores()` pushes to `release_groups.prestige_score`).
- **Migration `20260628000000_prestige_redesign.sql` ✅ applied:** TRUNCATE old Grammy data; DROP `release_id`/`scope_genre`/`scope_country`; ADD `mb_release_group_id text`; new UNIQUE on `(album_title, artist, source, year)`; ADD `release_groups.prestige_score float8`; CREATE `reconcile_prestige_scores()` (idempotent, tier-weighted blend); rebuilt `get_silla_leaderboard` reads `prestige_score` directly; `p_country` now filters by `artists.country` not prestige scope.
- **Seeder rewritten:** MB release-group search (`searchReleaseGroups()` added to `mb-client.ts`) replaces Spotify search. Fuzzy match on title+artist. Stores MBID or null (pending). Auto-reconciles after run.
- **Grammy AOTY re-seeded (360/360, 0 failed):** MB found Fugees — *The Score* this time. 340 matched with MBID, 20 pending. `reconcile_prestige_scores()` updated 67 release_groups.
- **Mercury Prize seeded (332/332, 0 failed):** 326 matched with MBID, 6 pending (Florence and the Machine ×3, Robert Plant & Alison Krauss ×2, Kae Tempest — *Let Them Eat Chaos*). After both sources: 86 release_groups have `prestige_score`, 26 total pending.
- Xcode Cmd+B verified 2026-06-28.

---

**2026-06-27 — Silla Score system: external_scores table, Grammy AOTY seeder, get_silla_leaderboard RPC, iOS leaderboard wired (Mac):**

- **Decision:** build the Silla Score from scratch with a new `external_scores` table (prestige signal) rather than repurposing existing data. Formula: `silla_score = 0.55 × rating_norm + 0.45 × prestige` (adaptive: rating-only or prestige-only albums use α=1.0 so no signal is penalized for lacking the other).
- **Prestige philosophy:** global hierarchy (Grammy = most prestigious globally) + equal weight within scope (KMA = Grammy when KR filter active, Mercury = Grammy when UK filter active). Achieved naturally via `scope_country` on `external_scores` — regional awards don't fire in the global view. No schema changes needed.
- **`external_scores` table (`20260627000000_external_scores.sql` ✅ applied):** one row per source per album. `normalized_score` [0,1]. `source_tier` (1=aggregators/0.45, 2=critics/0.30, 3=awards/0.25). `scope_genre`/`scope_country` = null → global; non-null → fires only under that filter. `UNIQUE(release_id, source, year)`. Indexed. `get_external_prestige_scores(release_ids text[], p_genre, p_country)` RPC also created.
- **Grammy AOTY data file (`scripts/data/grammy-aoty.ts`):** 360 entries (1959–2025), winners + nominees. `won → normalized_score=1.0/award_win`; `!won → 0.35/award_nomination`; `source_tier=3`; no scope (global award). 5 fixes applied (Saturday Night Fever artist, Fugees prefix, Pharrell G I R L spacing, Jay-Z 4:44 + Killer Mike hardcoded Spotify IDs).
- **Generic seeder (`scripts/seed-external-scores.ts`):** `npm run seed:external -- --source grammy_aoty [--dry-run] [--year YYYY]`. Spotify search → fuzzy match → upsert (`ON CONFLICT DO NOTHING`). State saved to `scripts/seed-external-scores-state-<source>.json` so re-runs skip completed rows. Spotify circuit breaker (`spotify-circuit.ts`) prevents running while rate-limited.
- **Grammy seed status:** 68 rows inserted before Spotify 429 at Neil Diamond "Moods" (1973). Rate limit clears ~21:30 UTC 2026-06-27. **Re-run `npm run seed:external -- --source grammy_aoty` to continue (~292 remaining).**
- **`get_silla_leaderboard` RPC (`20260627000001_silla_leaderboard.sql` ✅ applied):** combines Bayesian calibrated rating + tier-weighted prestige per `release_group_id` (post-renovation schema). Rating joins via `ratings.release_group_id → release_groups`. Prestige bridges via `external_scores.release_id → releases.spotify_id → releases.release_group_id`. Genre filter uses `_rg_has_genre()`. Returns `release_groups.id AS release_id`, metadata from `release_groups`, `silla_score float8 [0,1]`, `rating_norm`, `prestige_score`, `rating_count`, `source_count`. First attempt failed: `ratings.release_id` doesn't exist (renovation dropped it in §8). Fixed to use `ratings.release_group_id`.
- **iOS `RankingDetailView` wired:** added `SillaLeaderboardRow` + `SillaLeaderboardParams` codable structs; `load()` now calls `get_silla_leaderboard` (was `get_charts_top_rated` placeholder); `.onChange(of: selectedGenre/selectedCountry)` triggers reload; `silla_score × 5` displayed in score badge (maps [0,1] to [0,5] to match rating scale).

---

**2026-06-29 — "Various Artists" mega-match incident + special-MBID blocklist (Windows):**

- **Symptom:** user saw the MB worker stuck — no artist completed for **~71 min**, log spamming `[503] MB throttled` + `[mb] capped at 1376/324926 releases for 89ad4ac3…`. Diagnosis: queue name **"Ray" (wikipedia_japan) mis-resolved to MBID `89ad4ac3` = MusicBrainz "Various Artists"** (324,926 releases). The worker was crawling its capped 1,376 releases under throttling AND **actively polluting** the catalog (75 junk RGs / 72 releases / 1,143 recordings written before it was stopped).
- **Why the watchdog didn't (and shouldn't) catch it:** MB calls *were* still flowing (the 503 retries), so the dual-signal watchdog correctly read "alive, just slow." Different failure mode than a hang → needs a different fix.
- **Fix — special-MBID blocklist** ([mb-ingest.ts](apps/web/scripts/mb-ingest.ts) `SPECIAL_MBIDS`): Various Artists + [unknown]/[anonymous]/[no artist]/[data]/[traditional]. Applied in **two places**: filtered out of `resolveArtist` candidates, and a guard at the top of `ingestArtist` (covers the ListenBrainz path that carries an MBID directly, bypassing the resolver). Typecheck clean. Validated: `resolve("Ray")` → **needsReview** (no longer VA).
- **Cleanup:** purged the partial VA footprint FK-safe — 1,142 release_tracks · 72 releases · 75 RGs · **1,143 recordings** · 215 aliases · 1 artist. Recordings deleted only after a **shared-check** (compilation tracks can be MBID-shared with real artists) — all 1,143 were VA-exclusive (0 shared, 0 rated). `verify` 6/7 (only the benign 김광석 dup), catalog structurally clean.
- **State:** pipeline restarted (blocklist **and** the new watchdog now live), drain resumed; "Ray" sits `pending` → will resolve to needs_review on re-claim. **Open follow-up:** optional release-count sanity cap (skip/needs_review any artist with an absurd RG count) as a second-layer guard beyond the MBID blocklist.

**2026-06-28 — Data-health audit + genre backfill + orphan cleanup (Windows):**

- **Health check (due per PIPELINE_CHECKS):** throughput recovered to **84/hr** (was 20/hr) → ETA ~2.4d for the 5k, comfortably inside the window (local-mirror plan dropped). `pipeline:verify` 6/7 — the lone "duplicate artist" fail is a **false positive** (김광석 ×2 = two distinct MB artists, `singer` vs `drummer`). Catalog now ~14k release_groups / 84k recordings.
- **Deep data audit (the structural verify doesn't cover data quality):** 0 orphans / 0 broken FKs / 0 missing titles, 100% embedded, source pure (336 deezer expected). Found 3 things: (1) **compilations = 24.3%** of the catalog (3,407), dominated by public-domain jazz/classic reissues (Beatles 474, Miles Davis 375, Charlie Parker 322…) — 909 are generic-/self-titled noise, 2,498 distinctive; the 1.9% "dup" RGs are these legit-but-redundant comps, **not corruption**. (2) **genre coverage only 51.7%**. (3) one **null-source iTunes-shadow orphan**.
- **Compilation root-cause (investigated) + decision: KEEP, no change.** MB models every reissue/"Best of"/box set as its own release group (primary-type=Album + secondary-type=Compilation), so they pass the ingest's primary-type filter; `shouldIngestRG` ([mb-ingest.ts:284](apps/web/scripts/mb-ingest.ts#L284)) deliberately keeps `compilation` (only drops live/remix/dj-mix/interview/audiobook/spokenword). The volume is **85% concentrated in ~25 legacy canon acts** (Beatles/Miles Davis/Parker/Coltrane/Dylan…), who each have hundreds of MB compilation RGs; modern/K-pop acts have 0–2. So it's `(filter keeps comps) × (seed = RS500 + jazz/classic canon)`, i.e. authentic catalog history, not a bug. **Decided 2026-06-28: leave them in** (authentic data, no harm). One-line lever if ever reconsidered: add `'compilation'` to `SKIP_SECONDARY`.
- **Orphan cleaned:** `Woo – "We Are (feat. Loco & GRAY) - Single"` (source=null, mb_release_group_id=null, mislabeled type=album, created 2026-06-27, **0 user refs**) — deleted FK-safe (release_tracks → release → release_group → its 1 orphaned recording). Verified gone.
- **Genre backfill (new tool):** the old `backfill:genres*` scripts write the **dead `releases.genres`** column (pre-renovation); charts/discovery now read `release_groups.genres`. Built **[`scripts/backfill-genres-rg.ts`](apps/web/scripts/backfill-genres-rg.ts)** (`npm run backfill:genres:rg` / `:dry`) — derives each artist's top-3 genres from their MB-tagged release groups and propagates to their untagged ones. Fully offline, idempotent (writes only where `genres IS NULL`), race-safe alongside the live pipeline. **Filled 6,417 RGs across 243 artists → coverage 51.7% → 97.5%.**
- **Genre backfill — Last.fm residual pass:** built **[`scripts/backfill-genres-rg-lastfm.ts`](apps/web/scripts/backfill-genres-rg-lastfm.ts)** (`npm run backfill:genres:rg:lastfm` / `:dry`) for the residual artists with **zero** MB-tagged RGs (propagation can't reach them). Calls Last.fm `artist.getTopTags` and keeps only tags that **already exist in the catalog's genre vocab** (norm-matched, hyphen/space-tolerant) → no new/inconsistent values, charts stay intact. **Matched 59/110 artists → 343 RGs → coverage 97.5% → 98.2%.** The ~51 no-match are multi-artist collab-credit strings + obscure acts with no Last.fm presence (genuinely unfillable). Remaining ~1.8% untagged = those + freshly-ingested RGs the next propagation run will catch.
- **Resolver false-match class found + fixed (the "우디" bug):** user spotted `[ingest] 우디 → Woodie Gochild` — 우디 (ballad singer) and 우디 고차일드 (Woodie Gochild, rapper) are different people; the singer's queue row was **silently shadowed** (mis-resolved to the rapper, marked `done`, real artist dropped). **Breadth scan** (done queue rows whose queued name matches no artist name/alias): **7 of 262 Hangul `done` rows** (2.7%) — all `wikipedia_korea`, all 2–3 char names (감자·멜로디·산희·우디·우유·리제·신건). Bounded now but systematic + will grow as the 5k drains. **Root cause** in [`resolveArtist`](apps/web/scripts/mb-ingest.ts): (1) exact-match compared the query only against each candidate's **Latin primary name**, never aliases — so a Hangul query couldn't exact-match a romanized primary and fell through to the fuzzy `score≥90` branch; (2) MB's search fuzzily substring-matches short queries ("우디" ⊂ alias "우디 고차일드" → wrong artist at score 100) while the real artist scores lower or is unreachable (its Korean form sits in `disambiguation`, which the `artist:/alias:` query can't see). **Fix (2 parts):** (a) **alias-aware exact match** — match query against name **or** any alias/sort-name (added `aliases` to `MbArtistCandidate` in [mb-client.ts](apps/web/scripts/mb-client.ts)); rescues real matches (validated: 산희→sannie, 리제→LeeZe@85, 아이유→IU). (b) **short-CJK guard** — a 1–3 char Hangul/CJK query with **no** exact name/alias hit returns `needsReview` (→ INGEST marks it `skipped/needs_review`, surfaced for overrides) instead of grabbing the fuzzy top-hit. Validated: 6/7 shadows → needsReview, 리제 → correct, controls (뜨거운 감자/아이유/NewJeans) unaffected. Typecheck clean. **Activates on next `npm run pipeline` restart.** Tradeoff: a few legit short-Hangul names may need a one-time override — consistent with the existing dean/kai/gray "missing > wrong" handling.
- **Remediation done:** pipeline restarted (fixed resolver live), and the 7 shadow queue rows reset `done→pending` — they keep their early `created_at` so INGEST (oldest-first) re-claims them within a few cycles. Expected: 리제→done(LeeZe); 감자·멜로디·산희·우디·우유·신건→skipped(needs_review), recoverable via `mb-overrides`. Wrongly-grabbed artists (Woodie Gochild etc.) left intact (real, correctly stored).
- **MB worker hung overnight (silent stall) → heartbeat watchdog added:** after a clean overnight drain, the **ingest lane froze ~15 min** right after `Dialogue → DIALOGUE+` — no error thrown (an unguarded `await`; MB fetches already abort at 30s so it's a Supabase-call hang), DISCOVER/EMBEDDINGS kept beating so not a sleep. The supervisor only restarts lanes that **throw**, so a hang escaped it. User restarted manually (drain resumed). **Fix — watchdog** ([pipeline.ts](apps/web/scripts/pipeline.ts) `supervise()` now takes `staleMs`, armed on the ingest lane via `INGEST_STALE_MS`=10 min): races the lane against a monitor that forces a restart only when **both** the heartbeat **and** MB request activity (`mbLastActivityAt()`, new export from [mb-client.ts](apps/web/scripts/mb-client.ts)) are stale — so a slow/throttled artist (MB calls still flowing between beats) is never mistaken for a hang. Dual-signal + idle-branch beats every 30s = no false-trips; the dangling hung promise is harmless (restarted loop re-claims via `resetStale`, writes are MBID-idempotent). Typecheck clean; watchdog primitive unit-tested 3/3 (fires on true hang · no-fire when throttled-but-alive · clean completion). **Activates on next pipeline restart.**
- **Open:** (1) add `mb-overrides` MBIDs for the 6 needs_review shadows where a correct MB artist exists (manual, musicbrainz.org). (2) re-run `relink:ratings` after the 5k drains. (3) optional: arm the watchdog on EMBEDDINGS too (Jina hangs) by passing a `staleMs` to its `supervise()`.

---

**2026-06-27 — Deezer fallback for MB-missing artists (replaces the killed GAPFILL job C):**

- **Decision:** for artists MB can't resolve, fall back to **Deezer** (over iTunes/Spotify) — it exposes **ISRC** (so fallback recordings can auto-link to MB later, unlike iTunes), needs **no auth**, and carries no baggage from the sources the renovation left. Collaborators come back as text contributors (not entities), so it structurally can't spawn shadow artists (job-C's failure).
- **Built:** `deezer-client.ts` (open API, ~220ms limiter; ISRC fetched per `/track/{id}`); `mb-deezer-fallback.ts` (`npm run mb:deezer-fallback`, dry-run default, `--write`, `--limit`). Processes `skipped` queue rows; **disambiguation guard**: generic names (override candidates + short single tokens) are **excluded → handled by mb-overrides, not Deezer**; the rest require an **exact or token-set name match** (catches "Hoshino Gen" ↔ "Gen Hoshino"; intentionally skips pure romanization variants like "shik"/"sik" — missing > wrong). Clean writer: one artist row only, `source='deezer'` / `source_status='gapfill_unverified'`, country = seed-region hint or NULL (never a store country), recordings carry Deezer ISRC (`mb_recording_id` null). Standalone + bounded (NOT an auto lane) so it can't repeat job C.
- **Validated (dry-run):** 6 current skips correctly routed to overrides; Hoshino Gen → Gen Hoshino [JP] matched; Song Chang Shik correctly skipped (romanization). Found + fixed 3 CHECK constraints en route: `source_status` allows only `mb_verified`/`gapfill_unverified` (used the latter; also why job-C's `itunes_gapfill` tagging had silently failed); `source` allow-lists + `artist_external_ids` source lacked `deezer`.
- **Migration `20260627000000_deezer_source.sql` ✅ applied + validated `--write`:** Gen Hoshino → 35 groups, `source='deezer'`, ISRC present, single artist row, no dups/shadows. QC source-purity accepts `deezer`.
- **Gated DEEZER lane built:** refactored the core into `runDeezerFallback(db, {limit, write})`; `pipeline.ts` runs a supervised `deezerLoop` **gated behind `DEEZER_FALLBACK=1` (default OFF)** — integrated + opt-in (same caution pattern as job C, since it's a blind auto-writer; it's clean-by-construction but unproven at volume). `DEEZER_BATCH`/`DEEZER_POLL_MS` tunable.
- **Fixed the recurring orphan leak (root cause, web side):** `apps/web/app/api/search/route.ts` was persisting Spotify/iTunes search hits via `saveBasicReleases`/`saveItunesReleases` → bare `releases` rows (`spotify_id` set, `release_group_id`/`source` null) on every DB-insufficient search. Removed both persistence calls (search now returns live results without writing — the catalog is the pipeline's job post-renovation).
- **Closed out (end of day):** web fix **deployed** in `fd66fea` (verified: my fix `e200216` is its parent), then the 20 orphans **cleaned** — leak gone for good. **DEEZER lane enabled** (`DEEZER_FALLBACK=1`) and running (idle until a non-generic MB-miss appears). `pipeline:verify` **7/7, structurally clean**. Throughput ~20 artists/hr (ETA ~10.6d for the 5k — within the 2-wk window, tight; watch it, mirror if it holds ≤20/hr). Open/optional: `mb-overrides` for the generic skips; re-run `relink:ratings` after drain.

---

**2026-06-26 — iOS session 17 (Mac): Workstream C complete — all iOS Swift files updated to new DB schema:**

All 9 Swift files updated to read/write against the renovated DB schema (`release_groups`, `recordings`, `release_tracks`). The DB renovation (session 14/15 Mac) was applied on Windows; this session wires the iOS app up to it.

**Files updated:**

- **`Models/Release.swift`** — `CodingKeys` updated: `artist` → `"artist_display"`, `releaseType` → `"release_group_type"`, `releaseDate` → `"first_release_date"`, `titleNative` → `"native_title"`.
- **`AlbumDetailView.swift`** — Full refactor: `trackRatings` keyed by `UUID` (recording ID, not position); 2-step track loading (canonical release → `release_tracks` + `recordings`); all ratings/mixes queries use `release_group_id`; `rateTrack` upserts on `recording_id`; pairwise comparison columns `winner_id`/`loser_id`.
- **`InstinctRatingView.swift`** — Opponent embed via `release_groups`; upsert conflict `"user_id,release_group_id"`; `logComparison()` uses `winner_id`/`loser_id` (was `winner_release_id`/`loser_release_id`).
- **`HomeView.swift`** — `feedSelect` uses `release_groups` embed; `FeedItem` CodingKey `"release_groups"`; `FeedRelease` CodingKeys → `"artist_display"` / `"release_group_type"`; `prestige` removed from `ranked()` scoring; personalization artist seeds use `release_groups(artist_display)`.
- **`SearchView.swift`** — Discovery (popular/personalized/taste/trending): all query `release_groups`, sort by `first_release_date`, lowercase type values; song discovery returns `[]` until Windows rebuilds RPCs. Song search: 2-step (`recordings` title match → `release_tracks` for cover art). `loadRatedReleaseIds` uses `release_group_id`. `ArtistPageView`: queries `release_groups`, `artist_display` exact match, `release_group_id` for ratings.
- **`ProfileView.swift`** — `UserRating` embed key `"release_groups"`; `ReleaseRef` CodingKeys → `"artist_display"` / `"release_group_type"`; `SongRatingRow` now keyed by `recordingId: UUID` (removed `releaseId`/`position`); song ratings load via `track_ratings → recordings` + `release_tracks → release_groups` for cover art; `displayTitle` falls back to `"Unknown Track"`.
- **`MixLibraryView.swift`** — `MixItem` CodingKey `"release_group_id"` / `"release_groups"`; `MixRelease` → `"artist_display"` / `"release_group_type"`; `MixDetailView.load()` selects `release_group_id, release_groups(...)`; add/remove mix functions use `release_group_id`, conflict `"mix_id,release_group_id"`.
- **`UserProfileView.swift`** — `ProfileRating` embed key `"release_groups"`; `SongRating` keyed by `recordingId: UUID`; `loadRatings()` uses `release_groups` embed; `loadSongRatings()` 2-step via `recordings` + `release_tracks → release_groups` for cover art; `displayTitle` falls back to `"Unknown Track"`.
- **`TasteView.swift`** — `TasteRatingRow` embed key `"release_groups"`; `ReleaseEmbed.artist` CodingKey → `"artist_display"`; select uses `release_groups(id, title, artist_display, cover_url, genres)`.

**Known deferred items (out of scope):**
- `ActivityView.swift`: one broken `releases(...)` embed — will silently return nil/empty. Not in scope per CLAUDE.md.
- `RankingsView.swift`: chart RPCs already gracefully degraded via `try?`. No changes needed until Windows rebuilds them.
- Song discovery sections (popular/personalized/taste) return empty arrays until Windows rebuilds the views/RPCs.
- `get_user_genre_standings` RPC referenced in `TasteView` was dropped in the renovation — Taste genre cards will silently return nothing until Windows rebuilds it.

---

**2026-06-26 (cont. 14) — integrity-check bugfix + periodic-check infra:**

- **Fixed the empty-artists false alarm** (`mb-qc.ts` `integrityCheck`): the per-batch `.in()` query truncated at Supabase's 1000-row default, so prolific artists' release_groups were missed and their owners falsely counted "empty" (the 25→47 scares). Now a **full paginated scan** of `release_groups.primary_artist_id` → accurate count (4, all benign). `pipeline-verify` now treats empty-artists as a **soft review-note**, not a hard fail (features-only acts legitimately have 0 core releases). Cleanup verified durable: `pending_resolve`=0, `USA`=0, gapfill lane `artists 0` (job C off). verify **7/7**.
- **Periodic-check infra:** new [`PIPELINE_CHECKS.md`](PIPELINE_CHECKS.md) — schedule (daily while 5k drains → weekly), commands, a "what's fine vs a real problem" guide, and a dated Check log. `CLAUDE.md` now instructs each session to read it and **auto-run the checks if `next due` has passed** (and after any restart/migration/code change), then append a log row.
- **⚠️ Throughput watch:** today's reading dipped to ~18/hr (ETA ~12d, tight vs the 2-week window) — likely the restart/cleanup downtime in the 60-min window + the prolific-artist stretch. Re-check 2026-06-27; if it holds ≤20/hr, revisit the local-MB-mirror option.

---

**2026-06-26 (cont. 13) — Data check: disabled GAPFILL job C (iTunes shadow-artist pollution):**

- **Audit verdict:** MB data clean (correct countries, perfect canonical integrity, composition filter trimming prolific artists to 43–69 groups, high ISRC). **But GAPFILL job C (recover MB-skipped artists from iTunes) polluted the catalog:** ingesting skipped names' (H.O.T, god, …) full iTunes US-store discographies created **56 shadow artist rows** — store-country `USA` (wrong for Korean acts), `source=null` (provenance tagging never ran), `ingest_state='pending_resolve'`, collab-string junk ("Loco & GRAY"), and **duplicates of real MB artists** (DOK2[USA] vs Dok2[KR]). Dragged ISRC 88%→59%. Compounding (2→6 recovered as it ran).
- **Fix (user chose A = disable, not rework):** gated job C behind `GAPFILL_RECOVER_ARTISTS=1` (default OFF) in `pipeline.ts` — covers + tracklists (jobs A/B) stay (they're clean, append-only on MB groups). MB-skipped generic names are recovered via **mb-overrides** instead (proper MB identity + ISRC), not iTunes.
- **Cleanup:** new `cleanup-itunes-shadows.ts` (`npm run cleanup:itunes-shadows [-- --write]`) deletes the `pending_resolve` shadow artists + their full graph (185 groups / 189 releases / recordings / tracks) and resets the 6 `error='itunes-gapfill'` queue rows → `skipped`. Identified by `ingest_state='pending_resolve'` (iTunes-core default; MB never uses it). Dry-run verified. **Run order: restart pipeline (job C now off) → `cleanup:itunes-shadows --write`** (so no new shadows mid-cleanup). Typecheck clean.

---

**2026-06-26 (cont. 12) — Launch-5k composition plan + queue tooling (proportional, ko-wiki):**

- **Goal set:** 5k artists for launch (floor), then continuous growth; ~2-week window; quality non-negotiable. Same-IP so a 2nd worker is a no-op (MB limit is per-IP). Mirror deferred (needs external SSD; not required for 5k — public API does ~20k/mo).
- **Composition locked (CATALOG_EXPANSION_PLAN §2 shares):** KR 28 · West 30 · JP 15 · CN 7 · SEA 5 · S.Asia 4 · Latin 5 · Africa 3 · Other 3. User chose West 30 / KR 28.
- **`build-global-queue.ts` upgraded:** restored the `--dry-run` preview (per-region/category counts — I'd broken it in the cont.5 refactor); added a **`latin`** region + a **`korea`** region; broadened **western_canon** to genre-diverse *canon* (awards/HoF + Motown/Stax/Blue Note/Verve/Def Jam/Death Row/Sub Pop/Matador/4AD — soul/jazz/hip-hop/indie/country/blues); added **`--target=N` proportional mode** (caps each region at `SHARE×N`) + `--limit`.
- **Saturation finding:** English Wikipedia caps Korea at **~765** artists — couldn't hit the 1,400 KR target, which would've made Western 2× Korea. **Namuwiki rejected** (no MediaWiki API + CC BY-**NC** = illegal for a commercial app). **Fix = Korean Wikipedia** (`ko.wikipedia.org`, CC BY-SA): added `wiki:'en'|'ko'` per region; ko titles are Hangul (= native name, resolves via MB Hangul aliases, no langlink fetch). `대한민국의_가수` alone yields 1,303 → Korea now clears 1,400.
- **Dry-run confirms 5,000 at the planned proportions.** Queued for real via `npm run queue:build:global -- --target=5000` (safe alongside the running pipeline — insert-only, hits Wikipedia not MB). LB snowball (DISCOVER lane) keeps deepening Korea during the run (the "B" in A+B).

---

**2026-06-26 (cont. 11) — Crash fix + `pipeline:verify` harness (caught 2 real bugs):**

- **Pipeline crashed on restart** — a transient `ECONNRESET`/`fetch failed` (to Jina) threw out of `embeddingsLoop` (which only handled the `-1` HTTP-error return, not a raw network throw) → killed the process. **Fixed:** wrapped the batch call in try/catch (treat a throw as transient → sleep + continue); the `supervise()` backstop (cont.10) also now catches any lane throw. Ingest's per-row catch already handled its `fetch failed` (marked failed → QC requeues).
- **Built `pipeline:verify`** (`npm run pipeline:verify`): a repeatable battery — migrations present, integrity, freshness-cadence ordering, tiering RPC, QC requeue round-trip (disposable row, cleaned up), gapfill wired, all 10 charts RPCs return arrays. It immediately caught **two real bugs**:
  - **Tiering SQL bug:** `first_release_date` is a `date`, not text → my `latest >= to_char(...)` was `date >= text` (runtime fail). Fixed migration to `(now() - interval 'X')::date`. ⏳ **re-run the corrected `20260626000004`.** Also narrowed `recomputePriorities`' `needsMigration` regex (it had matched the operator error's "does not exist" and mislabeled it "not installed").
  - **10 orphan `releases`** (null `release_group_id`/`source`/`itunes_id`, all created 21:30:24, "dress"-search titles) — from the **web app search-insert path**, NOT the pipeline. `integrityCheck` now counts these as a distinct `orphanReleases` anomaly instead of fake "0-canonical groups". Recommend deleting the 10 + investigating the web search path (separate, out of pipeline scope).
- Typecheck clean. Next: restart on fixed code, re-run `pipeline:verify` (should be green once the tiering SQL is re-applied + orphans cleared).

---

**2026-06-26 (cont. 10) — Pipeline gap audit (2 fixes) + sustainability review:**

- **Fixed (bug I'd introduced):** QC `integrityCheck` counted every `source != 'musicbrainz'` as an anomaly — but GAPFILL legitimately writes `source='itunes'`, so QC would flip to `warn` forever once gapfill ran. Now allows `('musicbrainz','itunes')`; anything else is the anomaly.
- **Fixed (run-for-a-week robustness):** the per-iteration reads at the top of `discoverLoop`/`qcLoop`/`ingestLoop` sat outside their try/catch, so a transient Supabase blip there would reject `Promise.all` and kill the WHOLE pipeline. Added a `supervise()` wrapper in `main()`: a lane that throws is logged + restarted after 30s (ingest also re-runs `resetStale` to free a row stranded mid-claim); bounded `--once` runs still surface errors immediately.
- **Identified, NOT yet built — the one real design gap (freshness cadence):** every artist is `ingest_priority='known'` (30-day re-poll) because nothing assigns the hot/active/dormant tiers. So a new release from an active artist can lag up to 30 days. The FRESHNESS engine itself is correct (idempotent re-poll adds only new RGs); the gap is tiering by release-recency + engagement. Proposed plan pending user decision (see below).
- **Sustainability verdict:** the user's "record batch date → ingest releases past that date" idea is unnecessary — MBID-idempotent re-poll already adds only new releases AND catches back-catalogued/old-dated releases a date-cutoff would miss. Keep FRESHNESS; add priority tiering for cadence.
- **Built the tiering job** (closes the gap): `recompute_ingest_priorities()` SQL function (migration `20260626000004`, ⏳ apply) sets `ingest_priority` + re-derives `next_check_at` from release-recency (max `first_release_date`) + engagement (any rating) — released ≤3mo → hot · ≤18mo or rated → active · catalog → known · old+unrated → dormant; only rows whose tier changes are touched. `recomputePriorities()` wrapper in `mb-qc.ts`; QC lane calls it daily (`TIER_INTERVAL_MS`), degrades gracefully until the migration lands. Manual: `npm run mb:tiers`. Typecheck clean.

---

**2026-06-26 (cont. 9) — iTunes GAPFILL lane (§2) — completes the lane list:**

- **`itunes-client.ts` (new):** reusable iTunes Search client — store rotation (native-lang bias + lean GB/JP/KR/DE/BR fallback) lifted from `backfill-tracklists` but with a **NON-FATAL** 403 breaker (throws `ItunesBlockedError` instead of `process.exit`, so a block backs the lane off without killing the pipeline). Match key = `releaseGroupKey` + extra strip of iTunes release-TYPE suffixes (`- The 3rd Mini Album - EP`, `- Single`) the MB title lacks → smoke hit 9/10 on null-cover groups.
- **`mb-gapfill.ts` (new):** **append-only + MB-authoritative.** `gapfillGroups` fills null `release_groups.cover_url` and empty canonical tracklists (recordings + release_tracks, `source='itunes'`); `gapfillSkippedArtists` re-ingests MB-`skipped` queue rows from iTunes via the shared `itunes-ingest-core` writers, then **tags every new row `source='itunes'`** (release_groups/recordings/releases) + artist `source_status='itunes_gapfill'`, all guarded `.is('source', null)` so an alias-merge onto an MB artist can never relabel MB rows. Retry caps reuse the QC `attempt_count` column; cover retries gated by new `release_groups.gapfill_checked_at`.
- **Migration `20260626000003_gapfill_checked.sql` (⏳ apply):** adds `gapfill_checked_at` + a partial index. The lane self-disables (`MigrationNeeded` → status `off (apply migration)`) until it's applied — integrity of the rest is unaffected.
- **Wired `gapfillLoop` into `pipeline.ts`** (concurrent; iTunes ≠ MB so no contention) — slow/bounded (`GAPFILL_GROUP_BATCH` 25, `GAPFILL_ARTIST_BATCH` 3, 30m idle poll, 2h block cooldown), `--no-gapfill` to disable. `npm run mb:gapfill` for standalone bounded runs. Typecheck clean throughout.
- **Why bounded/non-fatal:** iTunes is exactly what the renovation fled (region mismatch + IP-level 403 blocks) — GAPFILL keeps volume low and degrades gracefully so it can never take the catalog or the pipeline down. **167 groups currently missing a cover; 0 skipped artists yet** (skipped grows as MB hits generic names). Activates on next restart + the migration.

---

**2026-06-26 (cont. 8) — Chart RPC rebuild (§5, drop-in for iOS):**

- **Got the exact iOS contract from the Mac session:** `RankingsView` was NOT updated in the renovation — it still decodes OLD column names (`release_id`, `artist`, and for songs `track_position`/`track_title`/`album_title`), all via `supabase.rpc(...)` (no embeds/views). 10 RPCs are actively called (+ controversial exists as a case but falls through to top_rated). Charts read **manual `score` only** (`elo_score` not surfaced).
- **Built `20260626000002_charts_rpcs_rebuild.sql` (⏳ apply in SQL editor) — DROP-IN, no iOS change:** all 11 charts RPCs rebuilt on the new schema but aliased back to the Swift-expected shape — `release_groups.id AS release_id`, `artist_display AS artist`. Song charts (`get_charts_{top_rated,most_rated,trending}_songs`) aggregate `track_ratings` by `recording_id`, then map each recording → ONE placement via a `DISTINCT ON (recording_id)` `loc` CTE that prefers the canonical release (`position AS track_position`, parent `release_group_id AS release_id`) — so tap-through still hits `AlbumDetailView(release: <group id>)` and `ChartSongEntry.id = "release_id_track_position"` stays stable.
- **New-schema adaptations:** genres moved text→`text[]` → `_rg_has_genre()` helper (unnest + hyphen/space tolerant so iOS slug `hip-hop` matches stored `hip hop`); `first_release_date` may be partial → year filter uses `LEFT(...,4)::int`; `get_user_top_genres` unnests the array directly.
- **Validation:** no direct PG conn in env (PostgREST only) so DDL validates on apply; reviewed against confirmed columns + the live `ratings→release_groups` join (proven by the re-link). Charts will read empty until ratings re-link + catalog drain.
- **Left open (NOT charts, separate iOS contract needed):** `get_user_genre_standings` (TasteView still calls it), `get_calibrated_bayesian_scores`, `recommendable_releases` view.

---

**2026-06-26 (cont. 7) — Rating re-link (§7):**

- **Restart verified** — all 5 lanes live (discover/embeddings/freshness/ingest/qc); QC shows `clean «integrity ok»` (migration `20260626000001` applied → auto-requeue active).
- **`relink-ratings.ts` built** (`npm run relink:ratings`, dry-run default, `-- --write` upserts): the pre-renovation backups (`backups/ratings_pre_renovation_20260624_win.json` 97 album + `track_ratings…_win.json` 20 track) are matched by `_release.{title, artist}` → new `release_groups` (then track ratings → the group's canonical-release tracklist → `recording_id`). Idempotent (upsert on the unique keys) and **re-runnable** as the catalog fills in.
- **Matcher robustness:** MB stores clean titles while Spotify backups wrap them (`NewJeans 2nd EP 'Get Up'`, `IU 5th Album 'LILAC'`) and list collab credits (`Sik-K, Lil Moshpit`). Added quoted-segment extraction + `- EP/Single/Album` suffix strip + primary-artist fallback → recall 4→8 on the current partial catalog.
- **Ran `--write`:** 8 matched → 7 distinct `ratings` rows (one user had two editions collapsing to one group; upsert kept the latest — expected). Scores + Elo preserved, `release_groups` join resolves. **Most misses are simply un-ingested artists (only ~23/275 drained); RE-RUN after the pipeline finishes draining.** Track ratings 0 so far (parent albums not yet ingested).
- **Caught + noted:** `release_groups`' artist FK is **`primary_artist_id`** (no `artist_id`) — documented in README for iOS too.
- **Remaining in #4:** chart RPC rebuild (dropped in renovation; coordinate with iOS — song RPCs key on `recording_id`).

---

**2026-06-26 (cont. 6) — FRESHNESS + QC lanes:**

- **Health check first:** confirmed the restarted pipeline is clean — `err=0` all lanes, `skipped/failed 0`, canonical integrity perfect, no dup artists, 100% MB source purity (the one `recordings other=1` was a transient mid-write race; re-checked → 0). Self-feeding DISCOVER idling correctly. TXT dropped from sample (pending correct re-ingest).
- **#3 FRESHNESS (built):** `mb-ingest.ts` now sets `artists.next_check_at` on every `tracks_done` from the priority tier (`nextCheckAt`, hot 1d/active 7d/known 30d/dormant 90d). `pipeline.ts` weaves freshness into the single MB worker (no separate MB lane → no contention): every `FRESHNESS_EVERY` (20) ingests, and whenever the queue is empty, it claims a due artist (`next_check_at <= now`) and re-ingests (MBID-idempotent → adds only new groups). Startup `bootstrapFreshness` schedules legacy null rows.
- **#3 QC (built):** new DB-only `mb-qc.ts` — `integrityCheck` (structured mb-audit invariants + `ok`/anomalies) and `requeueFailures` (failed→pending, capped by `attempt_count`, self-healing). `pipeline.ts` runs `qcLoop` concurrently (default 1h); `--no-qc` to disable. Migration `20260626000001_queue_attempt_count.sql` (⏳ apply) adds the queue retry counter; `requeueFailures` degrades gracefully (`needsMigration` flag) until it's applied — integrity checks run regardless.
- **Caught a bug via read-only smoke test:** QC `emptyArtists` + freshness delta-counter used `release_groups.artist_id`, which **doesn't exist** — the FK is **`primary_artist_id`**. First smoke run false-flagged "19 tracks_done artists with 0 release_groups"; fixed both to `primary_artist_id`, re-ran → `ok: true`, 0 anomalies. (Noted the column name in README for iOS artist→releases queries.)
- **⚠️ Activation = restart** (+ apply migration `20260626000001` for QC auto-requeue). Currently-running pipeline keeps draining on the prior code; FRESHNESS/QC/`next_check_at` take effect on next `npm run pipeline`. Typecheck clean throughout.

---

**2026-06-26 (cont. 5) — Self-feeding DISCOVER lane + generic-name overrides:**

- **Oriented (pipeline running, clean):** fresh re-run mid-drain (~11/275 seed artists done), 100% `musicbrainz` source purity, canonical integrity perfect, no dup artists. Did **not** restart it.
- **Found + fixed a live false-match:** seed **TXT** had resolved to *"Depeche Mode remixer"* (MBID `dcc522aa…`, country null, **0 release_groups**) — content-harmless but a wrong artist row. Deleted via the new `mb-requeue-overrides` (cleanup mode, safe live).
- **#1 Self-feeding DISCOVER lane (built):** refactored `mb-discover.ts` → exported `listenBrainzTopUp(db, opts)` (now **random-samples** sources so the snowball stays productive as the catalog grows) and `build-global-queue.ts` → exported `wikipediaTopUp(db, opts)` (bounded, incremental insert, region-curated); both keep their CLIs via an `argv[1].endsWith()` guard. Added `discoverLoop` to `pipeline.ts`: concurrent with INGEST (hits LB+Wikipedia, **not** MB), tops up when `pending < DISCOVER_LOW_WATER` toward `DISCOVER_TARGET`, bounded by a lifetime `DISCOVER_CEILING` on non-seed rows, **region-rotated Wikipedia** as the counterweight to LB drift. Env-tunable; `--no-discover` for drain-only. Typecheck clean; import smoke test confirms no CLI side-effects on import.
- **#2 mb-overrides filled (5 of 8):** MBID-verified against MB (KR country + alias carrying the stage name): **txt** `9d027d72`, **a pink** `9102bdf6`, **loco** `9e9e2a33`, **woo** `b22efa02` (우원재, alias "Woo"), **miso** `175f54d4`. **dean / gray / kai** deliberately left `needs_review` — their Korean artist doesn't surface in MB search even KR-filtered (missing > wrong). New `npm run mb:requeue-overrides` (`--requeue` resets mis-ingested names' queue rows; run at restart).
- **⚠️ Activation = restart:** the running process loaded the old (empty) override map + has no discover loop. Both changes take effect on the next `npm run pipeline`. Recommended restart sequence: kill → `npm run mb:requeue-overrides -- --requeue` → `npm run pipeline`. Restart is cheap here (only ~11 seed artists in, crash-resumable).

---

**2026-06-26 (cont. 4) — Clean catalog re-run + iOS schema reference + production-pipeline status:**

**2026-06-26 — Session 16 (Mac): Profile share URL fix; OG images overhaul:**

- **Pushed** discovery + composition filter (`77dc815`), then caught a real bug: `browseReleaseGroups` lacked `inc=artist-credits` → `release_groups.artist_display` was `'(unknown)'` AND the guest-feature/VA filter was silently disabled (`primaryArtistMbid` null = nothing filtered). Fixed (`d621fcb`).
- **Clean truncate + re-run on final code** (decided: the existing ~163 artists were built across pre-filter / pre-inline-cover / buggy code versions → inconsistent; cheaper to rebuild than to clean in place). Verified the fresh run: **0 `(unknown)`** artist_display, filter live (aespa 61 → core), covers + embeddings attaching from the start, all lanes healthy. Re-run draining the 275-seed (~1–2 min/artist).
- **iOS schema reference delivered to Mac** (for the Swift rewrite): `release_groups` / `recordings` exact columns — **no `prestige`**; artist display = **`artist_display`**; release type = **`release_group_type`** (lowercase: album/ep/single/compilation/live/soundtrack/other); recordings `artists` → **`artist_display`**, track identity = **`recordings.id`** (uuid, what `track_ratings.recording_id` references). PostgREST embeds `ratings→release_groups` and `mix_items→release_groups` **auto-detect** (single FK, no hint needed). Track loading: **no view** → 2-step (canonical `releases` where `is_canonical=true` → `release_tracks` join `recordings`). Chart song RPCs **not rebuilt yet** (will key on `recording_id` uuid).
- **Production-pipeline status — core done, full autonomy NOT yet.** Working: INGEST (resolve → composition filter → inline covers, crash-resumable) + EMBEDDINGS (concurrent) + heartbeat + clean data. **Missing:** (1) **self-feeding DISCOVER lane** (seed drains → pipeline idles; discovery is manual `mb:discover`/`queue:build:global`), (2) **FRESHNESS** lane (re-poll for new releases), (3) **QC** lane (`mb-audit` is manual), (4) iTunes **GAPFILL** + `mb-overrides` (~8 generic names), (5) **rating re-link** (§7), (6) **chart RPC rebuild**. ≈80% data-collection, ≈60% of the "run-for-a-week autonomous" engine.

---

**2026-06-26 — Session 16 (Mac): Profile share URL fix; OG images overhaul:**

- **Profile share URL fixed (iOS):** `ProfileView.profileURL` `/@username` (404) → `/profile/username`.
- **`/@username` redirect (web):** added to `next.config.mjs` redirects for old shared links.
- **Taste page:** "Rate X more albums" → "releases"; added "Find releases to rate" button.
- **OG images (web):** `og:image` set in `generateMetadata` to content's own image (avatar / album+song cover); main `opengraph-image.tsx` → flower logo; new `logo-dense.svg` + `logo-flower.png`.

---

**2026-06-26 (cont. 3) — Discovery (breadth) + composition filter:**

- **DISCOVERY — ListenBrainz similar-artists** (`mb-discover.ts`, `npm run mb:discover`): CC0, MBID-based snowball replacing rejected Last.fm. For artists we have → queues NEW similar ones (source='listenbrainz', source_id=MBID), deduped + capped (`--from`/`--per`/`--limit`). Validated (LB returns `[{artist_mbid,name,score}]`; dedup correctly filters already-have). **Kept controlled/standalone** (auto-snowball caused the old Western drift). Wikipedia breadth already works via `queue:build:global`. INGEST now ingests `listenbrainz` rows **directly by MBID** (no resolve).
- **COMPOSITION FILTER (decided: trim to core):** `shouldIngestRG` — keep the artist's OWN album/EP/single (+compilation/soundtrack via primary-type Album); **drop guest features** (rg primary artist ≠ this artist) and **live/remix/dj-mix/interview/etc.** Applied in `ingestArtist`. Cuts prolific-artist bloat (Future 227 → ~core only).
- ⚠️ **Consistency note:** the existing ~163 ingested artists were built across earlier code (pre-filter, pre-inline-covers, pre-fast-path, with feature/live bloat). Filter/covers apply to NEW ingests only → a clean truncate + re-run on final code (or a cleanup pass) is needed for a consistent catalog.

**2026-06-26 (cont. 2) — Pipeline running; enrichment lanes + speed + robustness:**

- **Overnight run audited (`mb-audit.ts`, read-only): clean.** ~152 artists, ~6.7k groups, 30k recordings; canonical integrity perfect (0 groups with >1 or 0 canonical), no dup artists, source all `musicbrainz`, sample eyeball all-correct. 8 skipped = correct safe-fails (needs_review for generic names Dean/GRAY/SOLE/BIBI/H.O.T/god; no_match for romanization variants) — **zero false data**.
- **Batch-fetch speedup:** `browseArtistReleases` bulk-fetches an artist's editions WITH tracks+ISRCs in pages of 100, grouped by RG client-side — replaces (browseReleases + getReleaseTracks) per RG. ~10× small artists, ~50–75× prolific. `ingestArtist` refactored; canonical-demote safeguard (exactly 1 canonical per group across re-ingests).
- **Robustness (found via the "Future" hang):** browse-by-artist over-fetches heavily-featured artists → **30s per-call AbortController timeout** + **40-page cap** (Future now 227 groups/1122 recordings in ~1 min instead of hanging). Jina `embedBatch` retries 5xx + 429.
- **Enrichment lanes (non-MB, concurrent):** EMBEDDINGS (`mb-enrich.ts`, Jina v3 → `release_groups.embedding`) as a pipeline lane + standalone `npm run mb:embed`; COVERS captured **inline** from MB's `cover-art-archive.front` flag (hotlink CAA, never cached) → `cover_url`. `pipeline:status` shows embedded/covered. `npm run mb:audit`.
- **Rate-limit facts:** MB ~1 req/s **per IP** → 2 devices help only on *different* public IPs; pipeline already supports concurrent workers (atomic queue claim). Local MB mirror = unlimited endgame (deferred).
- **Still NOT done (data pipeline ≈75%):** DISCOVERY for breadth (Wikipedia/ListenBrainz — pipeline idles after seed drains), iTunes GAPFILL by completeness, `mb-overrides` population (~8 generic names), QC lane (mb-audit is manual), FRESHNESS lane, composition filter (trim prolific-artist features?), covers backfill for pre-inline groups, per-RG heartbeat, rating re-link (§7).

**2026-06-25 — iOS session 15: Report/Block; clickable tracklist songs:**

- **Clickable tracklist songs:** Track titles in `AlbumDetailView` are now tappable blue links (when `trackId != nil` — i.e., the track has a stable UUID from the `tracks` table). Tapping navigates to the new `SongDetailView` via `.navigationDestination(item: $selectedSong)`. Tracks without a UUID (JSONB fallback) remain non-clickable plain text. The `+` rate button alongside each title is unchanged and still opens `TrackRatingSheet`. `TrackRow` gained `onTap: (() -> Void)? = nil` param; `tracklistSection` passes `onTap: track.trackId != nil ? { selectedSong = track } : nil`.
- **`SongDetailView`** (new, in `AlbumDetailView.swift`): cover + title/artist/track number/duration header; community stats (avg score + rating count from `track_ratings`); your rating (score + Edit button, or "Rate this track" button → `TrackRatingSheet`); "Appears on" → `NavigationLink(value: release)` → pushes `AlbumDetailView`. Community + user stats loaded via `loadStats()` using current `(release_id, track_position)` key — **note:** after DB renovation, update to `recording_id`. `isLoaded` guard prevents re-fetch on reappear.

**Report/Block wired (also this session):**

- **Report flow:** (same session) Tapping "Report" on a feed card opens a `ReportSheet` half-sheet. User picks a reason (Spam / Inappropriate Content / Harassment / Other), which writes to the new `reports` table (`reporter_id`, `reported_user_id`, `rating_id`, `reason`) via Supabase insert. On success: in-sheet confirmation state ("Thanks for helping keep sillajuku safe.") + Done button to dismiss. Error banner if the insert fails. `ReportSheet` is a `private struct` in `HomeView.swift`.
- **Block flow:** Tapping "Block this user" shows a native `.confirmationDialog` ("Their posts won't appear in your feed."). Confirming calls `HomeViewModel.blockUser(userId:)` which: (1) immediately removes all their posts from `exploreItems` and `followingItems`; (2) inserts to `blocked_users` table. On next app launch, `loadPersonalization()` fetches the full block list in parallel with follows/liked-artists, and all feed load paths filter the pool before assigning.
- **Migration written:** `apps/web/supabase/migrations/20260625000001_report_block.sql` — `reports` + `blocked_users` tables with RLS. ⏳ **NOT YET RUN** — run in SQL editor (Windows). Safe alongside the DB renovation (references stable `profiles.id` and `ratings.id` uuid PKs).
- **`CardSheet` enum** gained `.report` case; `FeedCard` gained `onBlock: () async -> Void` param + `@State private var showBlockConfirm = false`.

---

**2026-06-24 — DB renovation: architecture design, migration written, backups saved:**

- **Root cause identified:** `artists` table had only 1,533 rows vs ~418k releases — 98% of releases had `null artist_id`. Supabase 1000-row default limit was silently capping backfill queries. Fixed `backfill-itunes-artist-ids.ts` with `while(true)` pagination using `.range(from, from + 999)`.

- **Architecture decision — full DB rebuild (pre-launch window):** Only ~98 ratings from friends/bots. Three structural problems warranted a full rebuild: (1) artist identity fragmentation ("드레스" vs "dress" as separate rows), (2) no `release_groups` entity means every album edition creates permanent dedup debt, (3) song ratings keyed on `(release_id, track_position)` break with every remaster.

- **New tables created (in migration):**
  - `artist_aliases` — `UNIQUE(alias)` ensures every name variant resolves to exactly one artist entity
  - `artist_external_ids` — `PRIMARY KEY(source, external_id)` allows N iTunes IDs per artist (split catalog support)
  - `release_groups` — the album/EP/single as a concept; users rate this, not specific pressings
  - `recordings` — stable audio entity with ISRC; `track_ratings` keys on uuid not position
  - `release_tracks` — maps recording → release → disc_number + position

- **Changed tables:**
  - `artists`: text PK (was Spotify ID) → uuid PK; added disambiguation, country, ingest_priority (hot/active/known/dormant), last_ingested_at, next_check_at
  - `releases`: added release_group_id FK, is_canonical bool, region
  - `ratings`: release_id → release_group_id (with new UNIQUE constraint)
  - `track_ratings`: (release_id, track_position, track_title) → recording_id
  - `pairwise_comparisons`: winner/loser_release_id → winner_id/loser_id → release_groups
  - `track_pairwise_comparisons`: winner/loser_(release_id+position) → winner_id/loser_id → recordings
  - All user-content tables (reviews, list_items, mix_items, saved_releases, pinned_albums, ranking_votes, curated_releases): release_id → release_group_id

- **Dropped (to rebuild post-migration):** `recommendable_releases` view; all Charts RPCs (`get_charts_top_rated`, `get_charts_most_rated`, `get_charts_trending`, `get_charts_trending_for_genres`, `get_user_top_genres`, `get_charts_hidden_gems`, `get_charts_controversial`); `get_user_genre_standings`; `get_calibrated_bayesian_scores`. `record_rating_change` trigger rebuilt in the migration with correct column name.

- **Sustainability pipeline designed:** `ingest_priority` tiers — hot (daily re-check), active (weekly), known (monthly), dormant (quarterly). `next_check_at` column drives a scheduled Edge Function. iTunes chart polling for 15 markets: US, UK, KR, JP, BR, MX, FR, DE, IN, NG, ZA, AU, CA, ES, TW.

- **Backups exported before truncation:**
  - `backups/ratings_pre_renovation_20260624.csv` — 98 rows from 7 users (gitignored)
  - `backups/track_ratings_pre_renovation_20260624.csv` — 20 rows (gitignored)
  - `.gitignore` updated with `backups/` entry

- **Migration file:** `apps/web/supabase/migrations/20260624000001_db_renovation.sql` — written, ⏳ **NOT YET RUN**. Run in Supabase SQL editor on Windows next session.

---

**2026-06-25 — DB renovation migration pre-flight review (Windows):**

- **Blocking bug #1 found + fixed:** §1 `TRUNCATE` used `RESTART IDENTITY` without `CASCADE`. Five tables hold FKs into the truncated set but weren't listed — `rating_likes`, `rating_comments`, `notifications` (→ `ratings`), `comment_likes` (→ `reviews`), `list_item_tracks` (→ `list_items`) — so Postgres would abort with "cannot truncate a table referenced in a foreign key constraint" and roll back the whole migration. Changed to `RESTART IDENTITY CASCADE` (those 5 dependents are leaf tables, disposable pre-launch, not in backups).
- **Blocking bug #2 (surfaced on first prod run) + fixed:** §8 `DROP COLUMN ratings.release_id` failed — `ERROR 2BP01: trigger trg_release_ratings_count depends on column release_id`. This is the `releases.ratings_count` maintainer from migration `20260527000002`, declared `AFTER … UPDATE OF release_id ON ratings` (the `UPDATE OF` clause hard-binds it to the column). The renovation's §0 missed it. Added `DROP TRIGGER trg_release_ratings_count` + `DROP FUNCTION _sync_release_ratings_count()` to §0. The `releases.ratings_count` column is kept (read by `search_releases()`); the counter must be rebuilt on `release_groups` during the RPC/view rewrite (step 5).
- **Dependency sweep (verified clear):** introspected prod via `information_schema.triggers` (only the two known triggers on `ratings`, both dropped; nothing untracked on the other 12 altered tables) and via `pg_depend`/`pg_rewrite` for views/rules depending on any dropped column (zero rows). Only view is `recommendable_releases`, dropped in §0.
- **✅ APPLIED 2026-06-25 (SQL editor).** Post-run verification confirmed: 5 new tables present, `artists.id` = uuid, `ratings.release_group_id` exists + old `release_id` gone, `track_ratings.recording_id` exists, `artists.next_check_at` exists, `releases`/`artists` truncated (0 rows).

**2026-06-25 — Renovation step ①: ingest scripts rewritten for new schema (Windows):**

- **New shared core `scripts/itunes-ingest-core.ts`** — single source of truth for the entity-graph writes so the two ingest scripts can't drift. Exports `findOrCreateArtist` (resolve via `artist_external_ids` → `artist_aliases` → create; links iTunes ID + name/native aliases; legacy `artists.itunes_artist_id` kept populated), `findOrCreateReleaseGroup` (matches on edition-suffix-stripped normalized title), `ingestEdition` (inserts the `releases` edition, maintains exactly one canonical edition per group by earliest `release_date`, writes per-release `recordings` + `release_tracks`), plus all shared helpers (normalize, genre/type maps, language detection, collab detection). Per-run caches (artist-by-iTunes-id, artist-by-alias, group-by-key) cut DB round-trips.
- **`ingest-itunes-queue.ts`** (`queue:ingest:albums`) and **`ingest-itunes.ts`** (`itunes:seed`/discography/artist) both refactored onto the core; dead "enrich existing Spotify row" paths removed (catalog is truncated → all fresh inserts). `releases.tracklist` JSONB still populated for display continuity until the app reads `release_tracks`/`recordings`.
- **Design decisions (locked):** recordings are **per-release** for v1 (iTunes returns no ISRC; cross-release unification deferred); release groups collapse Remaster/Deluxe/Anniversary/Mono/etc. suffixes; `region` = iTunes store country.
- **Validated:** `tsc --noEmit` clean (0 errors project-wide). Smoke test `ingest-itunes.ts artist --artist="IU" --with-tracks` → 53 editions / 53 groups / 53 canonical (1 per group) / 0 orphans / 193 recordings == 193 release_tracks / 10 artists (IU + 9 feat. collaborators) each with 1 alias + 1 external id. Idempotent: re-running skips existing `itunes_id`s, so the IU test rows are safe to leave.
- **Next:** ② full re-ingest (`itunes:seed` → `queue:build:global` → `queue:ingest:albums`) → ③ re-import rating backups → ④ rewrite RPCs/views → ⑤ sustainability scheduler.

**2026-06-26 — Build started: pipeline migration + MB client + §12.3 coverage gate (PASSED):**

- **Migration `20260626000000_pipeline_schema.sql` ✅ applied** (SQL editor; verified `3|2|4|4|1|0|0`): RG embedding(1024)+HNSW + native_title + source + mb_release_group_id; releases source+mb_release_id; recordings mb_recording_id (UNIQUE) + source, **dropped UNIQUE(isrc)**; artists ingest_state machine + claimed_at/attempt_count + source_status; artist_aliases **dropped UNIQUE(alias)** + alias_norm/locale/script/primary_for_locale/source; pipeline_lanes table; lane/lookup indexes.
- **Built (typecheck clean):** `mb-client.ts` (MB API, single 1 req/s limiter, typed), `mb-ingest.ts` (MBID resolver + type/script mapping), `seed-artists.ts` (region-tagged seed, shared), `mb-coverage-gate.ts` (read-only §12.3 gate, `npm run mb:gate`).
- **§12.3 GATE PASSED — MB-primary validated.** First KR run (122 artists): 84% matched but that was a *resolver* artifact, not MB coverage. Two fixes: (1) **search NAME+ALIAS fields** (Korean artists' MB primary name is Hangul, romanized is an alias → name-only search missed the entire legacy tail) — recovered ~19 (조용필 25 RG, 박효신 30, 선우정아 39, 혁오 12, (G)I-DLE 44, BEAST 37, …); (2) **region/null-country enforcement** → false-merges (`Dean`→Dean Martin, `GRAY`→Slovenian, `WayV`) now correctly `needs_review`, **zero confirmed false-merges**. Net: ~90%+ auto-resolve correctly; residual ~6–10 generic single-word stage names (TXT, Kai, A Pink, Loco, Woo, MISO) need a small **manual MBID override map** (predicted by the LLM review). ISRC/cover density high for modern K-pop, thinner for legacy (fine — unification keys on mb_recording_id). **Decision: proceed to the full MB DB-writing ingest.**

**2026-06-26 (cont.) — MB ingest writer + orchestrator spine built & validated:**

- **Full MB DB-writing ingest** (`mb-ingest.ts`): find-or-create artist (by MBID; artist row created before claiming external_id — FK ordering bug fixed), aliases, release_groups (by `mb_release_group_id`), representative edition (Official→earliest→KR>JP>US→completeness), recordings (by `mb_recording_id`; ISRC = non-unique signal), release_tracks. Race-safe via MBID UNIQUE + upsert-onConflict-ignore-then-select; all upserts now error-checked.
- **`mb-overrides.ts`** — manual MBID map (empty; for the ~6–10 generic stage names) checked first by the resolver.
- **`pipeline.ts` (`npm run pipeline`)** — single orchestrator: DISCOVER (seed queue, deduped) + INGEST (single worker: claim pending → MB resolve → ingest → mark done; MB is 1 req/s so 1 worker is optimal) + heartbeat (`pipeline_lanes`) + startup stale-reset; flags `--once` / `--limit=N` / `--discover-only`. **`pipeline-status.ts` (`npm run pipeline:status`)** dashboard.
- **Validated against prod:** Se So Neon 14 groups / 38 recordings (graph verified: 14=14 distinct MBIDs, 14 canonical, 38 release_tracks, idempotent across 2 runs); aespa 61 groups / 166 recordings (multi-type). DISCOVER seeded 275-artist queue.
- **Two prod-only schema items found + fixed via SQL editor:** missing `mb_release_group_id`/`mb_release_id` columns added; stale pre-renovation `releases_release_type_check` dropped (release_type is now a legacy display col; authority is `release_groups.release_group_type`).
- **~60% of the data-collection pipeline.** Remaining: enrichment lanes (EMBEDDINGS→release_groups via Jina, COVERS via CAA, QC), iTunes GAPFILL by completeness, Wikipedia/ListenBrainz discovery — all run concurrently, addable while the spine collects.

**2026-06-25 — Plan finalized (MB-primary) + 3-LLM adversarial review + hardening:**

- **Backbone decided = MusicBrainz-primary** (resolve by MBID + ISRC, CC0/clean-IP), **curation/artist-driven** breadth (Wikipedia/ListenBrainz discovery → only persist selected artists; MB used as a queried databank, not bulk-copied), **iTunes = append-only gap-fill**, **Cover Art Archive** covers (hotlink, never cache). Deezer rejected earlier (non-commercial). Verified MB coverage via API spot-check (majors strong; Korean indie long-tail thin; ISRC density excellent).
- **Last.fm REMOVED (verified non-commercial API → material breach for commercial use)** — same class as Deezer. Replaced: genres→MB, similar-artist discovery→**ListenBrainz** (CC0), covers→CAA, prestige→**deferred** to native ratings. This also flags the old catalog's Last.fm-derived data as a diligence item.
- **3-LLM adversarial review** run on the plan; triaged as decider. **Accepted** (real flaws): completeness-based gap-fill (MB-has-artist-but-incomplete was silently underfilling Korean indie — the #1 fix); recording identity = `mb_recording_id` not ISRC-UNIQUE; per-artist **ingest state machine** + leasing/retry (crash-safety; downstream lanes gate on state); provenance (`source`/`source_status`) + gap-fill→MB reconciliation; rating re-link elevated to a defined ~100% stage; single shared 1/s MB limiter; genre normalization + richer alias model; expanded QC + indexes; edition precedence tree; CAA backoff; MB redirect handling. **Rejected** (context they lacked): "representative edition → ratings vanish" (ratings key on `release_group_id`, not edition); "exclude non-MB artists" (contradicts product); "atomic massive sync" (impractical on Supabase); heavy job-framework (state-machine+leasing suffices).
- **[RENOVATION_PLAN.md](RENOVATION_PLAN.md) rewritten** as the hardened master plan (§14 logs accepted/rejected). Data-pipeline plan complete; build gated on §6 migration → §12.3 coverage gate.
- **[APP_REWRITE_PLAN.md](APP_REWRITE_PLAN.md) written** — the downstream consumer-side track (the real launch-blocker), inventoried from a grep of current code: web ≈30 app files + iOS 9 Swift files + ~6 dropped SQL objects to rebuild. Grouped (catalog reads / rating / collections / rankings / misc), with an old→new mapping cheat-sheet, sequencing (rebuild SQL objects first, then web ∥ iOS, then re-link, then atomic cutover), and device split (Windows = SQL+web+re-link; Mac = iOS). Live app is currently broken against prod (acceptable pre-launch). Both renovation tracks now planned.

**2026-06-25 — Pre-flight strategic review + RENOVATION_PLAN.md:**

- Broad pre-execution review (data→app usage, UX, sustainable new-release collection, scale, industry comparison, stack constraints). Captured in new **[RENOVATION_PLAN.md](RENOVATION_PLAN.md)**.
- **Key findings:** (1) the schema is the industry-standard MusicBrainz model — sound; (2) the *app data-layer rewrite is the long pole* (~149 refs across 29 web files + all iOS Swift still query the old shape → prod dark until rewritten); (3) iTunes is weak for identity+sustainability (no ISRC, 200-album cap, ~20–300/min rate limit + IP 403s, no new-release feed) though great for Korean coverage + covers.
- **Decisions locked:** re-ingest runs in parallel with app rewrite (app = critical path); iTunes for bulk + ISRC enrichment for *rated* recordings only (MusicBrainz/Spotify); external cron scheduler (not Supabase Edge Fn); curate to ~170–260k recommendable (don't chase "all releases"); per-release recordings v1; edition-suffix-stripped groups.
- **Verified:** rating backups are JSON with embedded `_release.title/artist` → re-link viable (97 album + 20 track ratings).
- **Revised step order:** small seed ingest → rebuild dropped RPCs/views early (so the app rewrite has a target) → app rewrite ∥ bulk ingest → re-import ratings → scheduler.
- **Open item flagged:** seed must run `--with-tracks` (or a recordings backfill is needed) — the old `backfill:tracks` wrote the deprecated `tracks` table, not `recordings`/`release_tracks`.

**2026-06-25 — Ingestion speedup (lazy tracks + concurrency):**

- **New `scripts/itunes-fetch.ts`:** global min-interval rate limiter (default 220/min, `--rate`) + bounded worker `pool` (default 8, `--concurrency`) + shared 429/403 backoff (one throttle pauses all workers). Separates rate-cap from concurrency so we actually hit the iTunes ceiling instead of being latency-bound.
- **Core concurrency safety:** added `KeyedMutex` (per-artist `a:<id>` and per-group `g:<key>`/`g:<id>` locks) so parallel workers can't double-create artists/groups or race the canonical read-modify-write. Release insert is now duplicate-tolerant via `UNIQUE(itunes_id)` (23505 → skip; removed the pre-SELECT round-trip).
- **`ingest-itunes-queue.ts` rewritten to a worker pool**; **tracks lazy by default** in the bulk drain (writes artists/groups/releases only). `package.json`: `queue:ingest:albums` drops `--with-tracks`; added `queue:ingest:albums:tracks` for eager. Seed (`ingest-itunes.ts`) stays sequential + eager (small curated core).
- **Expected ≈5–6× faster bulk** on one machine (lazy halves calls; pool+limiter overlaps latency up to ~220/min). Multi-IP sharding + MusicBrainz remain as further levers (RENOVATION_PLAN §6, decisions A2/B/C).
- **New owed task:** app-side lazy-track hydration hook (on first view of a release with no `release_tracks`, fetch + populate) — replaces the deprecated `backfill:tracks`. tsc clean.

**2026-06-25 — Pipeline finalized: iTunes-eager + multi-IP; full redo inventory:**

- **Decision (expert review):** backbone = **iTunes-primary, eager tracks, concurrency + multi-IP** for launch; MusicBrainz adopted post-launch (ISRC unification + long tail, same tables, additive). Honest assessment: iTunes is weak as a *bulk* backbone (rate limits, no ISRC) but best for Korean coverage + covers; MB is the "correct" identity/song backbone but Korean-weak — hence hybrid, MB as fast-follow.
- **Reverted lazy→eager:** bulk drain now fills the song DB at ingest (song search/leaderboards need it at launch). `queue:ingest:albums` = eager (`--skip-singles`); `:fast` = `--no-tracks`.
- **Multi-IP sharding:** `--shard=i/N` (keyset pagination by `id` + hash-slice) → Windows `--shard=0/2`, Mac `--shard=1/2`, each own per-IP rate budget; ~linear scaling (~1 day single-IP → ~hours sharded).
- **User's pipeline model validated:** expansion = *new artists only* (dedup discovery); freshness = re-poll *known* artists (`next_check_at`); enrichment parallel — corrected that only **non-iTunes** enrichment truly parallelizes (covers/tracks share the iTunes budget).
- **RENOVATION_PLAN.md** expanded: §8b (eager+multi-IP impl), §9 (integrated 2-engine + derived + sustainability pipeline), §10 (redo inventory — genres, **embeddings move to `release_groups`** + HNSW, native names + **add native title col to `release_groups`**, covers, prestige, ratings_count, RPCs/views). tsc clean.
- **Verified correct against migration history:** §2 `artists.id`→uuid (no inbound FK anywhere; `releases.artist_id` is plain text); §9/§10/§11 dropped column names; §12 constraint/PK names; §8 trigger insert vs `rating_history` columns; `pg_trgm` present for the GIN indexes.
- **Non-blocking notes (deferred):** §0 drops wrong song-RPC names (`get_charts_top_songs`/`get_charts_trending_songs` vs real `get_charts_*_songs`) — harmless no-op, stale fns linger until RPC rewrite (step 5); §8/§10/§12 comments inaccurately say "text, no FK"; `reviews` loses its `UNIQUE(user_id, release_id)` with no `release_group_id` replacement (re-add if one-review-per-group is still wanted).

---

**2026-06-24 — iOS session 14: Rating modal polish, artist page fix, dedup script fix, macOS update:**

- **Charts RPCs confirmed applied:** `20260620000002_charts_rpcs.sql` + `20260620000003_charts_song_rpcs.sql` both applied 2026-06-24 (SQL editor). README updated.

- **Artist page query fixed (`SearchView.swift`):** `.ilike("artist", value: "%\(escaped)%")` (substring match) → `.ilike("artist", value: escaped)` (exact case-insensitive match). Was causing artist pages to show releases from artists whose name merely *contained* the search term (e.g. "Dress" page showed Eyedress, Dresscodes, etc.).

- **Instinct rating modal — three changes:**
  - **Bucket view (phase 1):** Replaced centered cover+title stack with compact side-by-side row (cover left, title/artist right). Replaced emoji tiles (😞/😐/🙂) with SF Symbol icons (`hand.thumbsdown` / `minus.circle` / `hand.thumbsup`). Removed trailing `Spacer()` — sheet now fits content tightly.
  - **Compare view (phase 2):** Full rewrite to I2 layout — "Which do you prefer?" header, two equal-width side-by-side cards. New album card: blue border + `sjBlue.opacity(0.06)` bg + "NEW" badge + blue Select button. Opponent card: gray border + `sjSurface` bg + ink Select button. `Color.clear.frame(height:17)` aligns the Select buttons across both cards. Removed the old full-bleed cover banner + Better/Worse approach.
  - **Done button dismiss fixed:** `@Environment(\.dismiss)` is unreliable when InstinctRatingView is nested inside a sheet that itself is inside a NavigationStack (the AlbumDetailView path). Added `onDone: (() -> Void)? = nil` parameter + `close()` helper that calls `onDone?()` then `dismiss()`. Callers updated: `AlbumDetailView` passes `onDone: { showInstinctSheet = false }`, `SearchView` passes `onDone: { instinctSheetRelease = nil }`. Belt-and-suspenders: explicit parent binding clear + environment dismiss.

- **`dedup:releases` script fixed (`find-duplicate-releases.ts`):** Bulk load was hitting a Supabase statement timeout because it selected `tracklist` (large JSONB) for all ~418k releases. Fix: removed `tracklist` from the select entirely; `metadataScore` now uses `total_tracks != null` as a proxy; `mergeAndDelete` fetches tracklist in a targeted single-row query only when keeper has no tracks. Script is ready to run — do it after macOS update.

- **macOS update pending:** Mac is on 26.2, iPhone is on iOS 26.5 — Xcode lacks iOS 26.5 device support files, which is why iPhone didn't appear as a build destination. Update via System Settings → General → Software Update. After restart see the START HERE note.

---

**2026-06-23 — iOS session 13: Rating modal redesign, explore ranking, Add tab overhaul, artist page, image perf:**

- **Rating modal redesign (M4 / I2 / I3):**
  - `ManualRatingSheet` rewritten: removed `NavigationStack`, added drag handle + ✕ close button, replaced `StarRatingView` with `Slider(value:in:step:)` at 0.5 increments, large score label ("3.5 / 5"), `sensoryFeedback(.selection)` haptic on slider change. `.presentationDetents([.medium])`.
  - `InstinctRatingView` redesigned: removed `NavigationStack`, added `.presentationDetents([.medium])`. Bucket view (I2): compact 56×56 cover, divider, "HOW WAS IT?", 3 emoji tiles in HStack (😞 BAD / 😐 MEH / 🙂 GOOD). Compare view (I3): full-width cover with `LinearGradient` overlay + album info, progress dots, "Is X better or worse?" question, Better/Worse buttons. Done view: cover with ✓ checkmark badge + score badge.
  - Added `emoji` property to `InstinctBucket` enum.

- **Instinct score never written to DB (bug fix):** `finalize()` was only setting `finalScore` locally — `score` column in `ratings` was never persisted, so home feed always showed the lock icon. Added `writeScore(userId:releaseId:score:)` helper. `finalize()` now calls it after computing `Elo.toScore(newElo)`. `vote()` also writes opponent scores when the user has ≥ 5 albums rated.

- **Spotify reconnect (bug fix):** Banner didn't disappear after OAuth because `linkIdentity` was the wrong API — it calls `/user/identities/authorize` which returns an error when Spotify is already the primary provider, and `try?` swallowed it silently. Switched to `signInWithOAuth(provider:redirectTo:scopes:)`. Added `NotificationCenter` notification (`sjSpotifyTokenRefreshed`) posted from `observeAuth()` when `providerToken` arrives; `SearchView.onReceive` triggers `refreshSpotifyIfNeeded()`.

- **Explore feed wipe on pull-to-refresh (bug fix):** `(try? ...) ?? []` couldn't distinguish a network failure from a legitimately empty feed. On any fetch error, `exploreItems` was cleared to `[]`. Rewrote `refreshExplore()` with a `guard let` pattern — only replaces content when the query succeeds.

- **Home > Explore ranking algorithm:** Client-side re-ranking of a 150-post pool (up from 60). `loadPersonalization()` runs before explore loads — fetches `followingIds: Set<UUID>` and `likedArtists: Set<String>` (artists user rated ≥ 4.0) in parallel. `ranked(_ items:)` scores each post: following boost (+8), artist taste match (+5), log-scaled likes (×5) and comments (×3), prestige ÷ 2000, recency bonus (+3/+1.5/+0.5 for <12h/<3d/<2wk). Top 60 surfaced. `prestige` added to `FeedRelease` struct and `feedSelect`.

- **Add tab — session checkmarks:** `sessionRatedIds: Set<UUID>` tracks releases tapped in the current session. `ratedReleaseIds` (DB-loaded at launch) hides pre-rated items. Session-rated items stay visible with a ✓ badge. No periodic refresh — app launch is the reset point.

- **Add tab — song list truncation:** Discovery song sections (For You, Popular) now show 5 rows max. "See all N songs" button in amber expands inline. Each section has its own expansion state.

- **Add tab — suggestion algorithm improvements:**
  - New **"From Your Taste"** section (above "For You"): albums by artists the user has rated ≥ 4.0 stars, sorted by prestige. Loaded in parallel with other discovery sections. Hidden if user has no 4+ ratings.
  - New **"Trending"** section (after "Popular"): top albums by rating count in the last 30 days. Fetches last 500 ratings, counts by release, surfaces most-rated albums/EPs (singles excluded). Top 25 shown.
  - `loadTasteAlbums()` and `loadTrending()` added to `DiscoveryViewModel`. All four loaders now run in `withTaskGroup`.
  - Album fetches in `SearchViewModel.search()` parallelised with `async let`.

- **Artist search results:** When searching, a new "Artists" section appears at the top of results (before Albums). Derived from album results client-side — zero extra DB query. Relevance: artist name contains the query = high priority; appears 3+ times = secondary threshold. Up to 4 artists shown as rows (initial-letter circle, name, release count, chevron) navigating to the A2 artist page.

- **Artist page redesign (A2 — Editorial List):** Complete rewrite. No hero image. Large typographic name ("28pt heavy"). Stats row: community avg / total ratings / release count. Amber "You" chip showing count + your avg (only appears when you've rated something). Tab row: Albums · Community · Fans (Community/Fans stubbed). Album rows: 44×44 cover, title, type + year, community score dot (amber) or + ring (unrated). `ArtistReleaseRow` accepts `communityScore` and `userScore`. `ArtistDestination.imageUrl` removed. `load()` fetches all ratings for the artist's releases in one `IN` query, computes community avgs and user's own scores client-side simultaneously.

- **Image loading performance:**
  - Root cause: all `cover_url` values are iTunes 600×600px images (or Spotify 640×640px), displayed at ≤128pt. `AsyncImage` uses `URLSession.shared` with a 4MB memory / 20MB disk default cache — enough for ~8 full-size images before eviction.
  - `URLCache.shared` set to 50MB memory + 300MB disk in `AppDelegate.application(_:didFinishLaunchingWithOptions:)`.
  - `String.thumbnailUrl` computed property (in `Theme.swift`) replaces `600x600bb` → `300x300bb` in iTunes URLs — ~4× smaller download, still sharp at 128pt @3x. Spotify CDN doesn't support URL resizing so those remain as-is.
  - Applied `.thumbnailUrl` to every thumbnail-size `AsyncImage` in `SearchView` (discovery cards, song rows, Spotify artist/album scrolls, artist page rows) and `HomeView` feed thumbnails.

- **Build:** `** BUILD SUCCEEDED **` — clean compile.

---

**2026-06-22 — iOS session 12: Profile swipe fix, Add tab checkmarks, suggestions fix, Spotify permanence:**

- **Profile subtab swipe fixed properly:** Moved the entire header (`customNavBar`, `headerRow`, `nameRow`, `actionButtons`, `tabBar`) outside `TabView` into a fixed `VStack`. Each of the three subtabs (Rated, Lists, Stats) now has its own `ScrollView` inside the `TabView(.page)`. Only content swipes — the header stays fixed. Prior implementation had header inside tab pages causing the whole screen to slide.
- **Add tab — rated items show checkmark instead of hiding:** Added `isRated: Bool = false` parameter to `AlbumCard`, `DiscoveryAlbumCard`, and `SongRow`. When `isRated = true`, a blue filled checkmark circle overlays the cover art. `.allowsHitTesting(false)` on the checkmark lets taps fall through to the underlying `NavigationLink` (navigates to album detail). All `.filter { !ratedReleaseIds.contains(...) }` calls removed — rated items stay visible in discovery and search results.
- **Add tab suggestions fix:** `loadPersonalized()` rewrote from fragile OR filter (`artist.ilike.ARTIST1,artist.ilike.ARTIST2,...`) to `.in("artist", values: seeds)` SDK-native call. The OR filter was silently broken — `%` wildcards in `.ilike` got URL-encoded to `%25` by the Supabase Swift SDK, matching nothing. `.in()` uses exact match and handles encoding correctly. Limits bumped: 200 rated releases seed, 50 max seeds, 60 albums, 40 songs.
- **"See all" rollback:** Removed 4-item cap on songs in discovery sections. `DiscoverySongList` struct, `DiscoverySongListView`, and related `navigationDestination` removed. Songs show all items inline.
- **Spotify permanence — root cause and fix:**
  - **Root cause confirmed:** `supabase.auth.refreshSession()` NEVER returns `providerToken`. Proven by reading `AuthClient.swift:876` — `providerToken` is only set in the OAuth callback URL parser (`params["provider_token"]`). The `validToken()` slow path that called `refreshSession()` always returned `nil` and was silently broken.
  - **`validToken()` simplified** to a fast path only: check UserDefaults cache, validate liveness with a `/me` ping, return `nil` if unavailable. No `refreshSession()` fallback.
  - **3-layer `loadSpotify()`:** Layer 1 — UserDefaults (instant, device-local); Layer 2 — Supabase `profiles` DB (persistent, survives reinstalls and device switches); Layer 3 — live Spotify API (when token valid, writes back to both Layer 1 and Layer 2). After one successful fetch, data is permanent in the DB regardless of token expiry.
  - **New `SpotifyService` methods:** `saveArtistsToDB`, `saveRecentlyPlayedToDB`, `loadArtistsFromDB`, `loadRecentlyPlayedFromDB` — each uses `Encodable` structs for type-safe Supabase updates and `Decodable` row structs for reads.
  - **Migration `20260622000001_spotify_data_cache.sql`:** Adds `spotify_artists jsonb`, `spotify_recently_played jsonb`, `spotify_data_updated_at timestamptz` to `profiles` table. ⏳ Apply via SQL editor before testing.
  - **Stale reference fix:** `filteredSongs.last?.id` → `searchVM.songResults.last?.id` after removing the rated-filter variable.
- **Build:** `** BUILD SUCCEEDED **` — clean compile.

---

**2026-06-21 — iOS session 11: Profile swipe, Add tab For You fix, album page posts + mixes:**

- **Profile subtabs — native swipe (Charts-style):** Replaced `DragGesture` hack with `TabView(selection: $activeTab).tabViewStyle(.page(indexDisplayMode: .never))` — same pattern as Charts Albums/Songs. Header (avatar, stats, action buttons, tab bar) is now a fixed `VStack` above the TabView; each tab (Rated, Lists, Stats) has its own `ScrollView`. `MixLibraryView` (Lists tab) also wrapped in `ScrollView` since it used the outer scroll. Native iOS momentum, rubber-banding, and swipe-settle animation are included automatically.
- **Add tab "For You" section was always empty** (root cause found): `loadPersonalized()` used `ilike.%ARTIST%` in a PostgREST `.or()` filter — the `%` characters were URL-encoded by the SDK to `%25`, so no albums matched. Rewrote to a two-step query: (1) fetch `release_id`s from `ratings` (no join, no decode failures); (2) fetch `artist` from `releases` for those IDs; (3) lookup albums with `.in("artist", values: topArtists)` (exact match, no wildcards). Also fixed `ArtistRef` struct (non-optional fields caused silent full-array decode failure on any NULL artist). Bumped all limits: popular 20→50, personalized 20→50, top artists 5→8.
- **Add tab: `withTaskGroup` parallelism removed from DiscoveryViewModel.load()** — child tasks in a task group run off the main actor; `@Observable` mutations from those contexts may not trigger SwiftUI view refreshes. Reverted to sequential `await` calls (same as before session 8 change).
- **Album/song page — Ratings & Reviews:** New section below tracklist shows all ratings on that release from all users. Each row: avatar initial circle, username handle, relative date ("2h ago"), and a score badge (star badge for manual, arrow badge for Elo). Loads `ratings` joined to `profiles`, ordered by `created_at` DESC, limit 20.
- **Album/song page — In Public Mixes:** New section shows public mixes that include this release. Two-step query: `mix_items` for `release_id` → `mixes` filtered by `is_public = true` joined to `profiles` for author handle. Displayed as a list row (music.note.list icon, mix name, author handle, chevron), limit 10.

---

**2026-06-21 — Web (Windows): i18n review prep, Vercel CPU fix, tracklist-gap 403 saga:**

- **Vercel free-tier "Fluid Active CPU" hit 75%** pre-launch (auto-pause at 100%). Investigated: the heavy public pages server-render on every request (`/album/[mbid]` ~418k, `/song/[trackId]` ~1.9M new this week, plus `force-dynamic` home/genre/rankings), with **no robots.txt** → an open crawl of ~2.3M uncached dynamic URLs was burning CPU for no users. ISR rejected (pages are dynamic via the `getServerT()` cookie/accept-language read, AND ISR can't help a one-time unique-URL crawl). Fix: added `apps/web/app/robots.ts` → `Disallow: /` (commit `7b0bd93`). RELAX AT LAUNCH. Don't upgrade to Pro unless the dashboard shows real user traffic.
- **Korean i18n review (NOT yet applied):** built `apps/web/i18n-review.html` — a standalone, editable dashboard of every hardcoded English string in `AddModal` / `StarRatingWidget` / song page with proposed Korean, so the user can review before wiring in. Decisions made: gut-check buckets → single-line **별로 / 보통 / 좋아요** (drop the "Not for me / It was fine / Loved it" hint line — that's also a small `AddModal` code change); import-modal copy softened ("Bring your ratings with you?…", mentions albums + songs) — **already applied** to en/ko. Remaining strings still owed (apply from the reviewed dashboard).
- **Tracklist-gap saga (still open — biggest item):** the "no tracks" gap was re-diagnosed (probes, not guesses): it is **iTunes region-mismatch**, NOT throttling — 30,745/31,016 null-tracklist releases have a valid `itunes_id` but it only resolves in a non-US store (Teixeirinha US:0 / GB,DE,BR:12; Yui Horie only JP; Heino only MX; Dalida dead everywhere). The old fallback tried US + Asian-only (gated on CJK `native_language`), so all Latin-script regional content missed.
  - First fix attempt: **broad ~44-store sweep** (commit `9cd0357`) — **FAILED at scale**: multiplied request volume per miss, tripped iTunes' **IP-level 403 block**, collapsed yield, and the 5×-retry backoff ground for minutes per release.
  - Final fix (commit `19c452d`): **lean fallback** `['GB','JP','KR','DE','BR']` (GB is a near-universal non-US fallback) + a **consecutive-403 circuit breaker** that aborts the run after 15 straight blocks (progress saved per release; resume after cooldown). Retries 5→4, wait cap 120s→60s.
  - **Action for next session:** wait ~1–2h for the iTunes IP block to clear, then `npm run backfill:tracklists` (lean), check the gap count, repeat across sessions; then `backfill:tracks --reset`; then `queue:ingest:albums` + HNSW rebuild. Note `backfill:tracks --reset` already ran this session (161,747 releases → ~1.95M track rows).
- Also this session (earlier, already shipped): Manual→Instinct import extended to songs; profile shows Instinct ratings via effective `score ?? eloToScore`; tracklist Save = bookmark icon, rating Add = rightmost.

---

**2026-06-21 — iOS session 10: Add-tab filtering, mode-aware album page, manual rating sheet:**

- **Add tab hides rated content:** `SearchView` loads `ratedReleaseIds: Set<UUID>` from `ratings` on appear. `addRelease()` inserts to the set immediately so the item vanishes on tap. All discovery sections (For You albums/songs, Popular albums/songs) and search result albums/songs are filtered through this set before rendering.
- **AlbumDetailView — mode-aware rating section:** Removed interactive stars + misleading hint from the main page. The rating section now reads `ratingMode` from the user's profile (loaded in parallel with other data). Manual mode, unrated: "Rate this Album" button → `ManualRatingSheet`. Manual mode, rated: read-only star display + score badge + "Edit" button → reopens sheet. Instinct mode, unrated: "Add to Rankings" button → `InstinctRatingView` sheet. Instinct mode, rated: Elo-derived score badge + "Re-rank" button.
- **ManualRatingSheet:** New half-screen sheet with compact album header, interactive star picker, live score display (e.g. "3.5 / 5"), "Save Rating" button, and "Remove Rating" option when editing. Stars are only interactive inside this sheet, not on the main page.
- **`onRated` callbacks:** Both `InstinctRatingView` and `AlbumDetailView` accept `onRated: ((UUID) -> Void)?` that propagates back to `SearchView` to keep `ratedReleaseIds` consistent.
- **`AlbumDetailViewModel` parallelised:** `loadTracklist`, `loadRatings`, and `loadRatingMode` now run concurrently via `async let`.

---

**2026-06-21 — iOS session 9: Instinct rating pipeline + song navigation:**

- **Instinct rating flow implemented** (`InstinctRatingView.swift`): Full pairwise comparison pipeline matching the web app. Phase 1 (bucket) → Phase 2 (comparisons) → Phase 3 (done). Binary search on Elo-ranked opponents (ceil(log2(n+1)) rounds, capped at 3). Elo math mirrors `lib/elo.ts` exactly: `expectedScore`, `kFactor` (40/24/16 schedule), `update`, `eloToScore` (logistic S-curve centred at 1500). DB: upserts `ratings.elo_score`/`elo_games`, inserts to `pairwise_comparisons`. Score only revealed after ≥ 5 albums rated. Album art loads async; cancel button always visible.
- **Instinct routing in Add tab:** `SearchView` loads `userRatingMode` from `profiles.rating_mode` on first appear. `addRelease()` helper routes to `InstinctRatingView` sheet (instinct) or `AlbumDetailView` sheet (manual). All `+` buttons (search grid, discovery scroll, discovery song list) use this helper.
- **Song rows now navigable:** All `SongRow` instances in search results, discovery song lists, and `DiscoverySongListView` are wrapped in `NavigationLink(value: parentRelease)` → pushes `AlbumDetailView`. The `+` button inside the row still works independently for quick-rate.
- **`songParentRelease(_:)` helper** extracted to avoid constructing Release inline in multiple ForEach bodies.

---

**2026-06-21 — iOS session 8: Swipe fix, design revamp, Add + button, Spotify token, genre pills:**

- **Profile subtab swipe fixed:** Moved `DragGesture` from the content `Group` inside the `ScrollView` to the outer `ScrollView` itself using `.simultaneousGesture` — the ScrollView's own gesture was swallowing the horizontal drag before. `minimumDistance` 40→20, directional guard `abs(width) > abs(height) * 1.5`.
- **Album/song page — Option C (Compact Header):** `AlbumDetailView` fully redesigned. Full-width square cover replaced with an 88×88pt rounded cover left-aligned in a side-by-side header; title/artist/type+year tags on the right. Rating section: uppercase "Your Rating" label, interactive stars, hint text, then community stat boxes (avg with flower icon + count). Tracklist: uppercase section label, `Divider` at `.leading: 56` to align with track titles, `TrackRow` padding moved inside the row. `StarRatingView` got a `starSize` default parameter for future flexibility.
- **Add + button on albums/songs:** `AlbumCard` now accepts `onAdd: (() -> Void)? = nil` and shows a white-circle plus button overlaid at bottom-right of the cover when non-nil. `SongRow` got the same `onAdd` parameter with a blue-tinted circle button at the trailing edge. `SearchView` exposes `@State var ratingSheetRelease: Release?` and passes `onAdd` closures throughout search results, discovery albumScroll, and discovery songList — tapping opens a `.sheet` with `AlbumDetailView`.
- **Spotify token persistence:** `SpotifyService.providerToken()` now saves the token to `UserDefaults("sj_spotify_provider_token")` when a live token is available, and falls back to the cached value after a Supabase session refresh clears the provider token. `DiscoveryViewModel.load()` also retries the Spotify load on subsequent calls if `hasSpotifyData` is still false.
- **Genre pills enlarged:** Icon 16→22pt, text 11→13pt, padding 14/12→18/16, minWidth 72→96px, corner radius 12→14.

---

**2026-06-21 — iOS session 7: Polish pass, blue theme, artist page, Find People:**

- **Bell button fixed:** `floatingHeader` switched from ZStack sibling to `.overlay()` on `feedContent`; inner ZStack gained `.frame(maxWidth: .infinity)` + `.contentShape(Rectangle())` — the page-style TabView was swallowing the tap before.
- **iOS push notifications:** `UNUserNotificationCenter.requestAuthorization` fires once at login (`sillajukuApp.swift`); `AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken` saves APNs token to `profiles.push_token` via `PushTokenService`. Migration `20260621000002_push_token.sql` adds the column. Delivery still requires a paid Apple Developer account + APNs key (in progress).
- **Theme color — amber → blue:** Added `sjBlue = #2979B7` (derived from logo-flower halftone dominant hue); `sjAmber` aliased to `sjBlue` in `Theme.swift` so all 62 usages (tint, badges, tab underline, loading dots, score badges) flip in one change.
- **Profile tab overhaul:**
  - Username centered (ZStack overlay pattern instead of HStack).
  - Tab bar no longer sticky — scrolls with page (removed `pinnedViews: [.sectionHeaders]` + `Section`).
  - Rating score display changed from "number / max" to flower-icon badge (same design as home feed `scoreView`).
  - Sort/filter button on Rated list: `RatingSortOrder` enum (Recent / Top Rated / Bottom Rated / A–Z) + `Menu` in header row.
  - Rating scale: reads `manual_rating_step` from DB — `0.5` → "/ 5", `0.1` → "/ 10" (was checking wrong field `ratingMode`). `Profile` model now includes `ratingStep: Double?`.
  - Swipeable subtabs: `DragGesture` on the content area cycles tabs on horizontal swipe (replaced broken `TabView(.page)` which collapsed to zero height inside `ScrollView`).
  - Following / Followers: merged into one `FollowListModal` sheet with tab underline switcher + horizontal swipe (page `TabView`); both lists load in parallel at open; single `showFollowModal` boolean with `followModalInitTab` initial selection.
  - Mix subtab empty state: top-aligned with `padding(.top, 24)` (was vertically centred with `Spacer`).
- **Charts tab:** Removed Top Rated section from Albums tab (belongs in Profile > Stats). Trending row thumbnails enlarged 38→52px, fonts bumped to match.
- **Artist page:** Tapping any Spotify artist circle in Add tab pushes `ArtistPageView` — hero image header, then scrollable list of their releases from the `releases` table (queried by `artist ILIKE`). `ArtistDestination: Hashable` registered as navigationDestination in `SearchView`. `ArtistReleaseRow` component (cover 52×52, title, type label, chevron, taps to `AlbumDetailView`).
- **Add tab keyboard:** Tapping empty space outside the search field dismisses the keyboard (`UIResponder.resignFirstResponder` via `.onTapGesture` on the VStack background).
- **Home > Following footer:** After the last feed card, a divider + "Follow more people to keep your feed fresh." nudge + "Find people to follow" `NavigationLink`. Footer only appears in Following tab, not Explore.
- **Find People page:** `FindPeopleView` — active users sorted by rating count, excluding already-followed users and self. Follow/unfollow inline (optimistic UI, writes to `follows` table). Backed by `get_suggested_users(p_user_id uuid)` RPC + migration `20260621000003_suggested_users.sql`. Applied via Supabase SQL editor.
- **Migrations applied this session:** `20260621000002_push_token.sql` ✅, `20260621000003_suggested_users.sql` ✅ (both run via SQL editor).

---

**2026-06-20 — iOS session 6: Charts tab (data insight hub):**

- **Tab renamed:** "Rankings" → **"Charts"** (trophy icon kept). `MainTabView.swift`: `rankingsVM` → `chartsVM`, `RankingsViewModel` → `ChartsViewModel`, `RankingsView` → `ChartsView`.
- **`RankingsView.swift` fully rewritten** — all types, ViewModels, and sub-views live in this one file to avoid touching the `.xcodeproj`. Key types:
  - `ChartsPulse`, `ChartEntry`, `ChartGenre` (6 static genres with SF Symbol names), `TrendingMode`, `ChartDetailType`
  - `ChartsViewModel` — `@Observable`, loads 5 data feeds in parallel via `withTaskGroup`, `hasLoaded` guard prevents re-fetch on tab switch
- **Hub view (`ChartsView`):**
  - `PulseCard` — dark card with 3 amber stats: total ratings, community avg, today count
  - `TrendingCard` — Global / For You inline toggle; "For You" fetches user's top 3 genres via `get_user_top_genres` RPC then calls `get_charts_trending_for_genres`; falls back to global if no rating history or RPC unavailable
  - `ChartHorizSection` — horizontal scroll row with album cards (rank badge + score badge) for Top Rated and Most Rated; tapping "See all" → `ChartDetailView`
  - `GenreScrollSection` — 6 genre pills with SF Symbol icons; tapping → `GenreDetailView`
  - `InsightCardRow` — Hidden Gems (diamond.fill) + Controversial (bolt.fill) side-by-side cards → `ChartDetailView`
  - `YearScrollSection` — decade cards (2025, 2024, 2010s, 2000s, 1990s) → `ChartDetailView(.bestOfYear(...))`
- **`ChartDetailView`** — drill-down list for any `ChartDetailType`; top 3 entries rendered in `PodiumRow` (#1 center/tallest, #2 left, #3 right); remaining entries in `RankedListRow` (rank number, cover, title/artist, score/count/week-count depending on type)
- **`GenreDetailView`** — genre-scoped ranked list with 4 sort chips: Top Rated / Most Rated / Trending / Gems; sort change re-fetches from appropriate RPC; `PodiumRow` suppressed for Trending mode
- **Migration `20260620000002_charts_rpcs.sql`** (⏳ apply in SQL editor): 8 SECURITY DEFINER SQL functions — `get_charts_pulse`, `get_charts_top_rated` (optional `p_genre`/`p_year_start`/`p_year_end` filters), `get_charts_most_rated` (same filters), `get_charts_trending`, `get_charts_trending_for_genres(p_genres text[])`, `get_user_top_genres(p_user_id uuid)`, `get_charts_hidden_gems` (avg ≥ 4.0, 3–9 ratings), `get_charts_controversial` (STDDEV DESC, min 5 ratings)
- **No emojis anywhere** — all genre icons are SF Symbols (`music.note.list`, `mic.fill`, `guitars.fill`, `waveform`, `leaf.fill`, `heart.fill`)
- **Graceful degradation** — every `rpc()` call uses `try?`; the Charts hub shows empty sections rather than crashing if the migration hasn't been applied yet

---

**2026-06-20 — iOS session 5: Notifications, Mixes, PTR, logo, critical feed bug fix:**

- **Notification bell** (`HomeView.swift`): amber bell icon in the floating header's trailing slot; red dot overlay when `viewModel.hasUnreadNotifications = true`. Tapping pushes `NotificationsView` via `NavigationStack` (right-to-left slide) — NOT a sheet. `HomeViewModel.refreshNotificationBadge()` queries unread count on load + PTR. `markAllRead()` writes `profiles.notifications_last_seen_at`.
- **NotificationsView inner NavigationStack removed**: changing from sheet to push nav caused a double navigation bar. Fixed by making the view a plain `Group` with `.navigationTitle` / `.navigationBarTitleDisplayMode` applied directly, relying on the parent's `NavigationStack`.
- **Comment system fixed** (`CommentSheetView.swift`): `sendComment()` had a silent `guard let userId = currentUserId else { return }` — no user feedback on failure. Added `errorMessage: String?` state + red error banner displayed above the input bar. `catch { errorMessage = error.localizedDescription }` now surfaces Supabase errors.
- **Pull-to-refresh positioning**: PTR native spinner now appears beneath the "Explore / Following" tabs, not above them. Fix: `.contentMargins(.top, 90, for: .scrollContent)` on the `ScrollView`; spacer inside `feedList` reduced from 54→0 pt. `refreshExplore()` rewritten to be silent — no clearing of items or loading state, so existing cards stay visible while the spinner turns.
- **App icon**: 1024×1024 light `AppIcon.png` (white `#FFFFFF` bg, amber `#E8A020` flower) and dark `AppIcon-dark.png` (ink `#1A1A1A` bg, cream `#F5F0E8` flower) generated with ImageMagick. `AppIcon.appiconset/Contents.json` updated to reference both (universal light, dark luminosity appearance, tinted appearance).
- **Feed card share → URL**: changed `ShareLink(item: String)` to `ShareLink(item: URL(string: "https://sillajuku.com/r/\(item.id)")!)` — URL type unlocks more share-sheet targets. Instagram still cannot appear (its extension only handles photos/videos, never URLs).
- **Save button rename**: feed card context menu entry "Save to library" → "Save".
- **Mixes feature** (`MixLibraryView.swift`, new file):
  - Models: `Mix: Codable, Identifiable, Hashable` (id, userId, name, isPublic, isDefault, createdAt); `MixItem`; `MixRelease` (with `asRelease` computed property).
  - `MixLibraryView`: loads user's mixes + per-mix item counts; "Listen Later" first (clock icon), custom mixes below (music.note.list icon); public badge; "+ Create a Mix" button.
  - `MixDetailView`: list of mix items, swipe-to-delete via `onDelete`, Edit button for name.
  - `CreateMixView`: Form with `TextField` (name) + `Toggle` (isPublic); POSTs to `mixes` table.
  - `MixPickerView`: half-sheet multi-select; pre-selects mixes already containing the release; saves/removes on confirm.
  - `FeedCard` changes: `@State private var userMixCount: Int?` loaded via `.task`; Save button: immediate save if only Listen Later, shows `MixPickerView` if custom mixes exist; `CardSheet` enum gained `.mixPicker` case.
  - `ProfileView.listsPlaceholder`: replaced "Lists coming soon" with `MixLibraryView(userId: profile.id)`; added `navigationDestination(for: Mix.self) { MixDetailView(mix: $0) }`.
  - Migration `20260620000001_mixes.sql`: `mixes` + `mix_items` tables, RLS (owner can manage; public mixes readable by all), `CREATE UNIQUE INDEX WHERE is_default = true` (one default per user), `_create_default_mix()` SECURITY DEFINER trigger on profiles INSERT, backfill INSERT for existing users.
- **Critical bug: feed showing "No ratings yet" after Mixes migration** — all 90 ratings were still in the DB (confirmed via REST API). Root cause: migration `000005_fix_social_fks` retargeted `rating_likes.user_id → profiles(id)`, creating a second indirect path from `ratings → profiles` (direct via `ratings.user_id`, and through `rating_likes`). PostgREST returned `PGRST201: ambiguous relationship`; Swift `try?` swallowed it → `nil → []` → empty feed. Fix: explicit FK hints on all three affected queries:
  - `HomeView.feedSelect`: `profiles!ratings_user_id_fkey(username, display_name)`
  - `HomeView` likers query: `profiles!rating_likes_user_id_fkey(username, display_name)`
  - `CommentSheetView`: `profiles!rating_comments_user_id_fkey(username, display_name)`
  - FK hint only guides PostgREST routing — JSON response key stays `profiles`, no Swift `CodingKeys` changes needed.
- **Migrations applied this session**: `20260619000005_fix_social_fks.sql` ✅, `20260619000003_saved_releases.sql` ✅, `20260620000001_mixes.sql` ✅.
- **All migrations applied**: `20260619000001_profiles_avatar.sql` ✅, `20260619000004_notifications.sql` ✅ (applied 2026-06-20). No pending migrations.

---

**2026-06-19 — iOS session 4: Home feed + Add discovery:**

- **Home tab → social feed** (`HomeView.swift` full rewrite):
  - `FeedTab` enum: `.explore` / `.following`; swipeable via `TabView(.page)`
  - Explore: all recent album ratings globally, newest first (limit 60)
  - Following: two-step query — get `following_id`s from `follows` table, then filter ratings by those user IDs
  - `FeedCard`: compact row — album art 58×58, title/artist, avatar initial, username, relative time, amber score badge
  - Logo in navigation bar principal position (adaptive dark mode); no genre sections
  - `HomeViewModel` still exposes `isLoading` so `MainTabView`'s splash screen continues to work

- **Add tab → discovery + dual-section search** (`SearchView.swift` full rewrite):
  - Empty query: shows "For You" (personalized) and "Popular" sections, each divided into **Albums** (horizontal scroll) and **Songs** (vertical list) subsections
  - "For You" personalization: pulls user's top-rated artists from `ratings`, finds matching releases in `recommendable_releases`, then loads tracks from those albums
  - "Popular": top `recommendable_releases` by prestige; tracks from the top 5 albums
  - Active search: **Albums** (3-col grid from `recommendable_releases`) + **Songs** (list from `tracks` join `releases` via `ilike`)
  - `SongRow`: cover art 44×44, track title, album · artist
  - `DiscoveryAlbumCard`: 128×128 card for horizontal scroll

**2026-06-19 — DB migrations applied:**

All 3 pending migrations applied to prod via SQL editor: `20260615000000_add_apple_music_platform.sql`, `20260618000001_ratings_status_default.sql`, `20260618000002_song_ratings.sql`. PostgREST schema cache reloaded (`notify pgrst, 'reload schema'`) — unblocks song Instinct comparisons (`track_pairwise_comparisons`). All migrations are now ✅.

---

**2026-06-19 — Instinct/songs QA feedback round:**

From a live prod smoke test:
- **Profile rated grid showed no label for Instinct ratings** (it rendered off `ratings.score`, null for Instinct). Fixed in `ProfilePanel`: query now selects `elo_score`, and ratings are mapped to an effective `score = score ?? eloToScore(elo_score)` (eloToScore is absolute, no ranking needed) — so the grid label, average, distribution, and capsule all work for Instinct. Leaderboard Silla scoring still Manual-only (separate, owed).
- **Tracklist had two "+" buttons** (rate + save, both plus icons). `QuickAddButton` gained a `saveIcon` prop (bookmark instead of plus); album tracklist reordered so Save (bookmark) precedes the rating **+** which is now rightmost; song-page Save also uses the bookmark.
- **Import modal copy** softened (was too technical): "Bring your ratings with you? … we'll use them as your starting point … fine-tune to match your taste." Now mentions albums **and** songs (import covers both). en + ko.
- **Known/not-code:** the `track_pairwise_comparisons` "not found in schema cache" error during song comparisons is a Supabase **PostgREST schema-cache** staleness after creating the table via SQL editor — fix with `notify pgrst, 'reload schema';` (or Dashboard → Settings → API → reload). Song Instinct drift is blocked until that's reloaded.

**2026-06-18 — Song ratings: Add = rate, full Manual + Instinct parity (SONGS_PLAN step 4):**

Corrected my earlier read: per the Add/Save pivot, **Add = rate**, and `QuickAddButton` (collections) = **Save**. So song rating got the full album-parity flow.
- **Migration `20260618000002_song_ratings.sql`** (⏳ apply via SQL editor): `track_ratings.elo_score`/`elo_games` (mirrors `ratings`) + new `track_pairwise_comparisons` table + RLS. Per-type Instinct — songs compare only with songs. (`track_ratings.score` was already nullable; the table has no `status` column, so song upserts don't set one.)
- **`/api/rate/compare-song`** — mirror of `/api/rate/compare` but track-keyed (`{winner,loser}` = `{releaseId, position, title}`); passes `track_title` on the upsert (NOT NULL, checked pre-ON-CONFLICT).
- **`AddModal` + `StarRatingWidget` generalized** to a `RateTarget` discriminated union (`album` | `song`). They branch storage (`ratings`/`pairwise_comparisons` vs `track_ratings`/`track_pairwise_comparisons`), opponent pool, compare endpoint, and final-score derivation by kind. Same Manual + Instinct flow, same `eloToScore`/`starToElo` math. Album reveal (lists+comment) is album-only; songs skip it (song comments not built).
- **Song page** now uses `StarRatingWidget` (song mode) — Add/Re-rank/Delete + score, replacing the interim `TrackStarRating`. **Album tracklist rows** use a new **compact** `StarRatingWidget` variant (Add/Re-rank + tiny score, no delete — delete lives on the song page) next to Save (`QuickAddButton`).
- ⚠️ **Gap flagged:** `/api/rate/seed-from-manual` (Manual→Instinct import) only seeds albums (`ratings`), not songs (`track_ratings`) — extend it as a follow-up. `TrackStarRating.tsx` is now unused (left in place).
- tsc + next build clean (`/song/[trackId]`, `/api/rate/compare-song` generate). ⏳ Not yet smoke-tested live.

**2026-06-18 — Album page polish + song pages v1 (SONGS_PLAN steps 2–3):**

- **Dark-mode fix:** the comments **Post** button (`ReviewsSection`) used `bg-ink text-white` with no dark override → light-on-white in dark mode. Added the standard `dark:bg-[#F0F0EE] dark:text-[#111111]`.
- **Tracklist cleanup** (`album/[mbid]/page.tsx`), per user: removed the track **duration**, the inline **5-star** widget (`TrackStarRating`), and the mid-row **featuring-artist** label. Kept per-track streaming + the collection add (`QuickAddButton`). Removed now-unused `formatDuration` + `TrackStarRating` import.
- **Tracklist titles are now clickable → `/song/[trackId]`.** The album page fetches a position→track-UUID map from the `tracks` table (folded into the existing parallel stats query, UUID-guarded) and links each title when a song row exists.
- **New song page** `app/(main)/song/[trackId]/page.tsx` (route `ƒ /song/[trackId]`): cover (parent release), title, artist(s), duration, streaming (`TrackStreamingButtons`), community stats, and "appears on" → album. **Rating is interim Manual `TrackStarRating`** (existing `track_ratings`) — the Add-modal + Instinct-for-songs parity is SONGS_PLAN **step 4** (needs song rating columns + a song comparisons discriminator) and will replace it.
- **Heads-up surfaced to user:** the per-track "add" button adds to a **collection**, it does *not* rate — so the user's "add now means rate the song" premise doesn't hold yet; song rating lives on the song page until step 4. tsc + next build clean (`/song/[trackId]` generates).

**2026-06-18 — Catalog jobs progress:** `backfill:embeddings` re-run finished (69,795 embedded, 0 failed) and `backfill:tracklists` is done; `backfill:tracks` is re-running now to repopulate the tracks table with the newly-filled tracklists. After it finishes: `queue:ingest:albums` (21,254 artists pending), then **rebuild the HNSW index** — the 69,795 new vectors are inserted but not yet indexed, so hybrid search won't surface them until the rebuild.

**2026-06-18 — Instinct: rated-album actions (Re-rank / Delete):**

Decided to keep it to two actions, not Podiums' three — in our Elo model "edit the bucket (nudge)" and "re-rank (compare)" both just move the same number, so a separate Edit is redundant and was the source of the "what's the difference?" confusion. So: **Re-rank** + **Delete** on a rated album, **Add** when unrated; "Edit" reserved for editing comments (separate concern). `AddModal` gained a `mode: 'add' | 'rerank'` prop — in `rerank` + Instinct it skips the gut bucket entirely (no reseed) and jumps straight into comparisons against the existing ranked list, so the album's current Elo + `elo_games` are preserved. **This fixes the prior bug** where the lone "Edit" button re-seeded Elo with `elo_games = 0` and silently wiped comparison history. Manual `rerank` just reopens the star input. Delete (`StarRatingWidget`, client/RLS) removes the `ratings` row + this album's `pairwise_comparisons` rows; other albums keep the Elo already earned (not recomputed). Labels hardcoded English (these widgets aren't i18n'd yet). tsc + next build clean.

**2026-06-18 — Instinct: absolute (sentiment-anchored) scores + Manual→Instinct import:**

Two coordinated changes to Instinct mode, decided with the user.

*1. Display scoring changed from relative rank to absolute Elo curve (supersedes the 2026-06-17 "score = rank interpolation" decision).* The old `scoreFromRank`/`deriveInstinctScores` spread albums evenly 5.0→0.0 by rank, which ignored sentiment (a library of only-loved albums still had its lowest forced to 0.0) and washed out the bad/neutral/good answer. Replaced with `eloToScore(elo)` in [lib/elo.ts](apps/web/lib/elo.ts): a logistic S-curve centered on `DEFAULT_ELO` (`SCORE_SPREAD = 250`) so the seeds anchor at fixed display points (bad 1400→~1.4, neutral 1500→2.5, good 1600→~3.6) and comparisons move scores continuously. Extremes compress, so 0.0/5.0 must be earned, not seeded. Still one global Elo list (soft seeds, items cross freely — that principle survives). `deriveInstinctScores` reimplemented as per-album `eloToScore` (no longer rank-based). Read paths updated: [StarRatingWidget](apps/web/components/StarRatingWidget.tsx) (rank kept only for the "#X of N" label), [AddModal](apps/web/components/AddModal.tsx) done screen.

*2. Manual→Instinct import.* Switching modes used to leave old star ratings unused by Instinct, so a switcher hit an empty opponent pool + the 5-album reveal wall despite years of ratings. Now: switching Manual→Instinct in Settings opens `InstinctImportModal` (only if there are importable rows — star score, no Elo). **"Use my ratings"** → `POST /api/rate/seed-from-manual` seeds `elo_score = starToElo(score)` for every star-rated album. `starToElo` (linear, 2.5★=1500, 80 Elo/star) is faithful on day one (5★→~1700→display ~4.3, 3★→2.5) but compressed so extremes are still earned. Imported rows get `elo_games = IMPORT_GAMES` (= `ESTABLISHED_GAMES` = 30) so they immediately use the slow stable K-factor (16) and drift *gradually* — ~1 point over ~15–20 lost comparisons — instead of lurching. Brand-new Instinct ratings keep `elo_games = 0` (fast K=40). **"Start fresh"** flips mode without seeding (normal cold start). Seed endpoint is idempotent (`elo_score IS NULL` guard) so comparison-earned Elo survives repeated mode switches. New i18n (`settings.preferences.import*`, en+ko); Instinct mode note updated to "carry over and gradually adjust." No DB migration needed (`elo_score`/`elo_games` already exist). `npx tsc` + `next build` clean.

**2026-06-18 — Vercel build fix (deleted one-off script):**

The deployment for commit `e0d04e0` failed at `next build` (Vercel log truncated after `npm install`; reproduced locally). Root cause: `apps/web/scripts/reset-processing.ts` — the one-off utility from the 2026-06-20 entry that reset 2 stuck `processing` queue artists — was committed to the repo and contained an invalid Supabase call: `.update({ status: 'pending' }).eq('status', 'processing').select('*', { count: 'exact', head: true })`. That `.select(columns, options)` overload isn't valid after an update builder, so Next.js type-checking (which covers all `.ts` files, scripts included) failed the build. The script had already served its purpose, so deleted it (SESSIONS noted it was "safe to delete after use"). Clean `next build` now passes. Committed as `66f0480` (not yet pushed).

**2026-06-20 — Tracklist gap diagnosis + backfill-tracklists improvement:**

`backfill:tracks` finished overnight: 126,634 releases → 1,546,647 rows in `tracks` table.

Investigated why many album pages still had no tracklist. Ran a DB diagnostic — actual numbers:
- 188,351 total non-singles (was 115,604 when backfill:tracklists ran — 73k new releases added by global expansion)
- 56,976 (30.2%) had null tracklist
- 56,450 of those (99.1%) **already had `itunes_id`** — IDs were good, lookups failed

Root causes:
1. **iTunes throttling during ingest**: 56k × extra `fetchTracks` call during the 2-day ingest run → 429/timeout → `null` → tracklist stored as null. These all have itunes_id and will succeed on a calm standalone re-run.
2. **Regional store mismatch**: zh (378), ja (549), ko (73) albums region-locked to non-US iTunes stores. US-only lookup returns 0 songs silently.
3. **State file permanently blocked retries**: the old script added any "no tracks" ID to the state file. IDs enriched with `itunes_id` after the original run were still skipped on re-runs.

**`backfill-tracklists.ts` improved:**
- Regional store fallback: after US iTunes returns 0 songs, tries KR/JP/TW/CN/HK/IN/ID/TH/VN stores based on `native_language`.
- Always retries releases that have `itunes_id` regardless of state file — previously-failed id-based lookups now re-run every time.
- State file only records no-`itunes_id` search attempts (to avoid redundant re-searching).

**Action taken:** killed `queue:ingest:albums` (21,254 artists still pending; 2 stuck-as-processing artists reset to pending via `scripts/reset-processing.ts`). Running `backfill:tracklists` + `backfill:embeddings` in parallel (~10–12h + ~8h). After both finish: `npm run backfill:tracks` (re-populate tracks table), then `npm run queue:ingest:albums` to resume. Note: `scripts/reset-processing.ts` is a one-off utility — safe to delete after use.

**2026-06-17 (session 3) — Web parity: Instinct mode backend + essentials removal (Windows track):**

Built all 5 Windows web-prep tasks from `WEB_PARITY.md` (the iOS app is being built in parallel on Mac — `apps/ios/` untouched):

1. **DB migration** — `apps/web/supabase/migrations/20260617000000_instinct_rating_mode.sql`: `rating_mode text DEFAULT 'manual'` (CHECK manual/instinct) on `profiles`; `elo_score numeric` + `elo_games int DEFAULT 0` on `ratings`; `pairwise_comparisons` table (user_id→profiles, winner/loser→releases, RLS "Users manage own comparisons") + two indexes. Written idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS). FK types verified against the post-`20260527000001` schema (releases.id + ratings.release_id are `uuid`). **✅ Applied to prod 2026-06-17** by pasting into the Supabase SQL editor ("Success. No rows returned").
2. **Elo algorithm** — `apps/web/lib/elo.ts`: pure, dependency-free shared math. `DEFAULT_ELO=1500`, provisional→established→stable `kFactor` schedule (40/24/16), `expectedScore`, `updateElo(winner, loser)` (rounds, increments games), `eloToStars` (maps Elo → 0.5–5.0 so Instinct scores are comparable to Manual stars). Mirror this exactly in Swift.
3. **`/api/rate/compare`** — `apps/web/app/api/rate/compare/route.ts`: POST `{ winnerId, loserId }`; user taken from Bearer token (never body); rate-limited 120/60s; rejects self-compare and non-Instinct users; reads current Elo for both releases (defaults if no row), computes `updateElo`, upserts both `ratings` rows (omits `score` so existing stars are preserved), inserts `pairwise_comparisons`. Returns new scores/games.
4. **Essentials removed** — `ProfilePanel.tsx` (strip + import), `AlbumActions.tsx` (dropdown entry + pin state/functions + swap & confirm modals + `pinned_albums` reads/writes + `Pin` icon), onboarding `StepAlbums` (now a 3-step flow: identity → genres → streaming; Streaming is the final step and triggers `handleFinish`, which no longer writes `releases`/`pinned_albums`). Deleted orphaned `components/Essentials.tsx` + `components/Pick5Modal.tsx`. `pinned_albums` table intentionally left in place (unused). No profile **server**-component queried `pinned_albums` (only the client `Essentials` component did), so nothing else to strip.
5. **Spotify OAuth scopes** — `AuthForm.tsx` Spotify sign-in now passes `scopes: 'user-read-email user-top-read user-read-recently-played'` (kept `user-read-email` so Supabase can still read the account email). ⏳ Also confirm/add these scopes in the Supabase dashboard → Auth → Spotify provider.

`npx tsc --noEmit` clean on all touched files. **Process note:** two `Write` calls used relative paths while the shell cwd had moved to `apps/web`; the migration landed correctly but `elo.ts` was created at `apps/web/apps/web/lib/elo.ts` and had to be moved (stray nested dir removed). Did not interfere with the `queue:ingest:albums` catalog run.

**2026-06-17 (session 3, cont.) — Instinct algorithm design locked (Beli/Podiums research):**

Researched how Beli/Podiums turn pairwise comparisons into a score (avoided guessing a formula). Findings + decisions:
- **Buckets are soft seeds, not hard bands.** Beli's 3 buckets just start comparisons in the right region; the final score comes from one global ranked list (linear interpolation over rank). This dissolves the "bad album beats a neutral album" contradiction — there are no sealed tiers, so the comparison result is the source of truth and items cross freely.
- **Three buckets: bad / neutral / good** (not 5 — suits a 5-point scale). Seed Elo 1400 / 1500 / 1600.
- **Displayed score = rank position interpolated to 0.0–5.0, 0.1 steps.** Fully relative (top ≈ 5.0, bottom ≈ 0.0).
- **Comparison flow:** one album = the one being rated, the other = a previously-rated album; #questions scales with ratings count, capped at 3; scores hidden until the user has rated ≥ X albums (X TBD).
- **Mode switch keeps scores** (corrected — earlier spec wrongly said reset). Manual `score` and Instinct `elo_score`/`elo_games` stored independently.
- **Manual 0.1 precision** (decided): optional Settings toggle switches Manual from half-star widget → slider (0.0–5.0, 0.1). Half-star stays default. `ratings.score` is already `numeric(3,1)`; only the user's chosen granularity needs storing.
- **`lib/elo.ts` rewritten** accordingly: removed the guessed `eloToStars`; added `Sentiment`/`seedElo`, `scoreFromRank`, `deriveInstinctScores` (rank→0.0–5.0). `updateElo`/`expectedScore`/`kFactor` unchanged. `WEB_PARITY.md` §4 + §7 updated.
- **X (hide-until threshold) = 5** (`INSTINCT_REVEAL_THRESHOLD` in `lib/elo.ts`).
- **Manual 0.1 precision — BUILT.** Migration `20260617000001_manual_rating_step.sql` (`profiles.manual_rating_step` numeric, 0.5 default / 0.1; ⏳ apply via SQL editor). `StarRatingWidget.tsx` renders a 0.1 slider (0.5–5.0, with a Clear button) when the pref is 0.1, else the half-star widget; refactored its save path into `persistScore`/`clearScore`. Settings → Preferences has a "Manual rating precision" toggle (half-star ↔ 0.1 slider) that writes the column live. The 0.1 slider only replaces the album-page hero widget; inline/card/track quick-rate widgets stay half-star. (`RatingForm.tsx` is unused legacy — untouched.)
- **Settings → single scrollable page.** Converted the 5 tabs from swap-on-click to one stacked page (each section wrapped in `<section id="section-*" className="scroll-mt-24">`). Left nav is now `md:sticky`; clicking a button `scrollToSection()` smooth-scrolls to that section; an `IntersectionObserver` keeps the active highlight in sync with scroll; `?tab=` still deep-links (scroll-on-mount).
- **Delete account — BUILT (hard delete).** New `app/api/account/delete/route.ts` (POST, rate-limited, Bearer-auth, service-role `auth.admin.deleteUser` → cascades through profiles → all dependent tables). Settings: removed the **Deactivate** feature entirely and the "Danger Zone" heading; the former danger section is now an unnamed card with **Log out** + **Delete account** (red). Delete opens a confirm modal that requires typing your username, then signs out and redirects to `/`. Removed the duplicate Log out button from the Account section; dropped the `danger` nav tab + `settings.danger` deactivate/title/subtitle i18n keys (added `deleteConfirm`/`deleteConfirmBtn`/`deleting`). The 'danger' section no longer has a left-nav button.
- **Instinct web UI — BUILT (while Mac builds iOS).**
  - **Pair-selection decided:** binary-search insertion (information-optimal opponent = middle of the ranked list, ~log2(N) comparisons capped at 3) for *opponent choice*; Elo still does the *scoring* (robust to inconsistent picks). Opponent selection runs client-side over a session-start snapshot.
  - **Settings:** Manual/Instinct selector (`profiles.rating_mode`); the Manual 0.1-precision toggle now hides itself in Instinct mode; full i18n (`settings.preferences.ratingMode*` / `ratingPrecision*`, en+ko).
  - **`/rate` page** (`app/(main)/rate/page.tsx`): gut-check bucket (bad/neutral/good → `seedElo`, direct RLS-protected upsert) → binary-search comparison loop (each pick POSTs `/api/rate/compare`) → done screen with derived score (or "rate N more" if < 5). Reached via `/rate?album=<id>`; guards for not-instinct / no-album. **English-only copy for now (i18n pass pending — flow still settling).**
  - **Album page** (`StarRatingWidget`): in Instinct mode hides the star/slider input and shows derived score + "#rank of total" (when ≥5 rated) or a "Rate in a session" button → `/rate?album=<id>`.
- **Add/Save redesign (rating → "Add" popup).** Per user: renamed the rating action to **Add**, moved it from the `/rate` page into a **modal**, and split saving into a separate **Save** button.
  - **Bug fix:** `ratings.score` was NOT NULL in prod → bucket seeding failed. Migration `20260617000002_ratings_score_nullable.sql` (⏳ apply via SQL editor) drops the NOT NULL. (Instinct rows have `elo_score`, no star `score`.)
  - **`AddModal.tsx`** (new): popup, unified for both modes. Manual = star/slider input; Instinct = Bad/Neutral/Good bucket (`seedElo`). After rating, a hidden section reveals **Add to a list** (Listen Later + collections via `usePlaylist`) + **Leave a comment** (`reviews` insert). Instinct then continues to binary-search comparisons (`/api/rate/compare`) → done screen with derived score.
  - **`StarRatingWidget.tsx`** rewritten: no longer an inline input — now shows the current score (read-only stars / instinct score+rank) + an **Add**/**Edit** button that opens `AddModal`.
  - **`AlbumActions.tsx`** rewritten: was the old "Add" dropdown → now the standalone **Save** button (Listen Later + collections only; ranking removed). Album page renders both with unchanged props (no page edit needed).
  - **Leaderboard button removed** from album page (user plans score-driven leaderboards, so nothing to manually "add to").
  - `app/(main)/rate/page.tsx` **deleted** (modal replaced it).
  - **English-only copy in the Add modal — Korean i18n still owed** (user: do it once the feature is built).
- **Next major pivot (NOT started) — songs as first-class.** Individual song pages + song ratings (Manual + Instinct) + home/feed/search song sections. Full design + open decisions captured in **[SONGS_PLAN.md](SONGS_PLAN.md)**. Key context: songs have no identity yet (tracklist is JSONB), but `track_ratings` already rates by (release_id, position). Foundational open decision: create a `tracks` table vs keep (release_id+position).
- **Still not built:** Spotify taste-sync (§6), onboarding rating-mode/notifications steps, login redesign (§1/§5), email-password removal, Instinct scores feeding profile/Silla stats.

**Out of scope (still pending web parity):** full onboarding rewrite (StepRatingMode, StepNotifications, Google-only genre step, remove country/streaming), album-page Instinct UI (hide StarRating, show derived score), `/rate` comparison session page, Settings rating-mode toggle + reset-warning modal, login redesign (§5), email/password removal + Apple button (§1), Spotify/Apple taste sync in onboarding finish (§6), and new i18n strings (§7).

---

**2026-06-18 (iOS session 3) — UI polish, onboarding redesign, dark mode:**

*Auth screen (`AuthView.swift`):*
- Added two oversized decorative background flowers via `GeometryReader` + `.ignoresSafeArea()` — top-right (140% of screen width, positioned down/right so it's cut at physical edges) and bottom-left (100% of screen width), both at `opacity(0.09)`. Used `.ignoresSafeArea()` on the `GeometryReader` rather than `.clipped()` so flowers extend to the physical screen edges rather than the safe area boundary.
- Legal text ("By continuing…") moved into a separate `ZStack` layer (`VStack { Spacer(); Text(legalText) }`) so it's always pinned to bottom, independent of the main content VStack.
- Slogan changed to `Color.sjInk.opacity(0.6)` (strong adaptive gray).
- Main layout: three-Spacer system (top `Spacer()` · middle `Spacer().frame(maxHeight: 40)` · bottom `Spacer()`) keeps logo and slogan positioned independently of dropdown expansion.
- Added `#Preview("Light")` and `#Preview("Dark")` macros.

*Onboarding (4 redesigned screens):*
- **`OnboardingView.swift`**: `enum Step { case name, username, ratingMode, notifications }` (genre step removed); `loadProviderName()` reads `full_name`/`name` from `supabase.auth.currentUser?.userMetadata` and writes directly to `data.displayName` on appear.
- **`StepName` (`StepProfile.swift`)**: single `TextField` with `@FocusState`, `.onAppear { isFocused = true }`, `.submitLabel(.next)`. Name field pre-filled with OAuth provider name. Background `Color.sjSurface`, text `Color.sjInk`.
- **`StepUsername` (`StepGenre.swift`)**: single username `TextField` with `@FocusState`, auto-focus on appear, username availability check. Background `Color.sjSurface`, text `Color.sjInk`.
- **`StepRatingMode.swift`**: title "Select a rating style." / subtitle "You can change this later." / "Normal" mode (was "Manual"). Card backgrounds `Color.sjSurface` when unselected.
- **`StepNotifications.swift`**: title "Turn on notifications." left-aligned, no bell icon, matches other step style.

*Tab bar restructure (`MainTabView.swift`):*
- All 5 ViewModels hoisted to `MainTabView` as `@State` — prevents views from recreating their ViewModel on every tab switch.
- `hasLoaded: Bool` guard added to each ViewModel's `load()` — first call fetches, subsequent calls skip.
- Tab order: Home · Rankings · Add (was Search) · Feed (was Activity) · Profile.
- `AppLoadingView` shown while `homeVM.isLoading` — flower (64pt) + wordmark (22pt) + `ProgressView` tinted `Color.sjMuted`. Replaces previous in-`HomeView` spinner.
- Removed `.navigationTitle("sillajuku")` from `HomeView`.
- `ActivityView` navigation title → "Feed"; tab labeled "Add" (was "Search").

*Dark mode:*
- 5 adaptive color assets added to `Assets.xcassets`: `sjCream` (light `#F8F8F6` / dark `#111110`), `sjInk` (light `#1A1A18` / dark `#F0F0EE`), `sjMuted` (light `#8C8C8A` / dark `#999997`), `sjBorder` (light `#E8E8E6` / dark `#2C2C2A`), `sjSurface` (light `#FFFFFF` / dark `#1E1E1D`).
- `Theme.swift` simplified: removed adaptive color declarations — Xcode 15+ auto-generates `Color.sjCream` etc. from `.colorset` assets (manual declarations caused "Invalid redeclaration" build errors). Only `sjAmber` and `sjSpotifyGreen` remain explicit.
- `sillajukuApp.swift`: `@AppStorage("appearanceMode")` + `private var colorScheme: ColorScheme?` + `.preferredColorScheme(colorScheme)` on `WindowGroup` root.
- `ProfileView.swift`: Appearance submenu in `···` menu — System / Light / Dark options with checkmarks.
- All `Color.white` → `Color.sjSurface` across all views.

*Build fixes:*
- `OnboardingView.finish()` — removed stale `providerName` reference ("Cannot find 'providerName' in scope").
- "Invalid redeclaration" of `sjCream`/`sjInk`/`sjMuted`/`sjBorder`/`sjSurface` — fixed by removing duplicate declarations from `Theme.swift`.

*Known issues / pending:*
- DB migrations for `rating_mode`, `elo_score`/`elo_games`, `pairwise_comparisons` still pending (Windows).
- `checkOnboarded` returns false for existing Spotify users → routes to onboarding on relaunch. Root cause: missing profile row or null `username` in `profiles` table. Needs investigation (profiles table RLS policies).
- Pull-to-refresh not yet wired — `hasLoaded` guard blocks re-fetch; needs a `reset()` + pull gesture.

**2026-06-17 (session 3) — iOS app scaffolded (auth + onboarding + tabs):**

*What was built:*
- **Xcode project** at `apps/ios/` — bundle ID `com.sillajuku.app`, Supabase Swift SDK 2.48.0 added via SPM, URL scheme `sillajuku://` registered in Info.plist.
- **14 Swift source files** across `Auth/`, `Onboarding/`, `Main/`, `Models/`, plus `Config.swift`, `SupabaseClient.swift`, `Theme.swift`, `AppState.swift`, `sillajukuApp.swift`.
- **Auth flow** — `AuthView` + `AuthViewModel`: Spotify (recommended badge), Apple (disabled/coming soon), Google; all call `supabase.auth.signInWithOAuth`. `RootView` observes `supabase.auth.authStateChanges` and routes to auth / onboarding / main.
- **Onboarding** — `OnboardingView` with animated capsule progress: `StepProfile` (display name + username with debounced availability check), `StepGenre` (Google-only — flow layout pills, fetches from `/api/genres/top`), `StepRatingMode` (Manual vs Instinct cards), `StepNotifications` (UNUserNotificationCenter).
- **Main tabs** — 5-tab scaffold with placeholder views.
- **`@Observable` macro** throughout; `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` set project-wide.

*Build status:*
- **BUILD SUCCEEDED** — Cmd+B passes clean in Xcode GUI. App runs in iPhone 17 simulator (iOS 26.5).
- Three import fixes needed after first build: `import Observation` added to `AppState.swift` and `AuthViewModel.swift` (`@Observable` macro is not re-exported by `Supabase` or `Foundation`); `import Supabase` added to `StepProfile.swift`.
- `xcodebuild` CLI still fails with an Xcode 26 SPM dependency-ordering bug (`swift-clocks` scheduled before its deps). Build from Xcode GUI only.
- Debug code signing disabled in pbxproj (`CODE_SIGNING_REQUIRED = NO`, `CODE_SIGNING_ALLOWED = NO`) — not needed for simulator builds.

*Setup notes (non-obvious):*
- Xcode 26 auto-syncs files from disk via `PBXFileSystemSynchronizedRootGroup` — no pbxproj edits needed for new `.swift` files.
- iOS 26.5 simulator runtime (8.49 GB) required downloading — freed ~10 GB first by deleting `~/Library/Caches/com.google.SoftwareUpdate` (5.5 GB), `~/Library/Caches/Google` (2.9 GB), `~/Library/Caches/com.microsoft.VSCode.ShipIt` (1.1 GB), and Xcode DerivedData (1.0 GB). All are safe auto-regenerated caches.
- 8 GB RAM is tight for Xcode + iOS 26.5 simulator + VSCode simultaneously. Stop the simulator (Cmd+.) when not actively testing.

**2026-06-17 (session 2) — iOS pivot + feature design:**

*Architecture decision:*
- **React Native retired** — `apps/mobile/` deleted. Decision driven by: MusicKit requires dev builds in RN anyway (losing Expo Go benefit), app is iPhone-first, SwiftUI + native MusicKit is the correct long-term foundation for a premium music app.
- **Swift/SwiftUI chosen** for the iOS app (`apps/ios/`). Development on Mac. Xcode Previews replace Expo Go for live UI iteration.

*Feature decisions made:*
- **OAuth-only login** — email/password removed. Three providers: Spotify (recommended — gives `user-top-read` taste data), Apple (gives MusicKit heavy rotation + library), Google (no music data). KakaoTalk remains "coming soon".
- **Simplified onboarding** — name + username only (no bio, country, streaming platform, genre pills by default). Google login adds a genre preferences step since Google provides no music data to infer taste from. All providers get: rating mode step + notifications step.
- **Essentials removed from entire app** — onboarding step gone, profile page strip gone, album page "Add to Essentials" gone. `pinned_albums` table stays but is no longer read/written.
- **Instinct rating mode** (new) — pairwise comparison / Elo system. User picks Manual (star ratings, unchanged) or Instinct (comparative judgement — "which do you prefer?") during onboarding. Instinct replaces star input on album pages with derived Elo score. Dedicated comparison session UI. Switching modes resets scores (warning dialog). DB: `rating_mode` on profiles, `elo_score`/`elo_games` on ratings, `pairwise_comparisons` table.
- **Music data sync** — Spotify login: pull `user-top-artists` (medium + long term) after OAuth to seed taste profile. Apple login: pull heavy rotation + library via MusicKit. Both are ongoing (re-sync on app open), not one-time.

*Artifacts created:*
- `WEB_PARITY.md` — full spec of all changes to mirror on web in a follow-up session (auth, onboarding, essentials removal, Instinct mode, login redesign, data sync, i18n strings).

*Parallel work plan:*
- **Mac:** build Swift iOS app from scratch (`apps/ios/`).
- **Windows (no clash):** DB migrations, Elo algorithm (`apps/web/lib/elo.ts`), `/api/rate/compare` API endpoint, remove essentials from web, update Spotify OAuth scopes.

**2026-06-17 — queue:ingest pagination fix:**

- **`ingest-itunes-queue.ts` pagination** — script was silently capped at 1000 artists per run due to Supabase PostgREST's default max-rows limit. Added a `while` loop that re-fetches the next 1000 `pending` rows after each page is processed (safe because processed rows are immediately marked `done`/`skipped`/`failed`, so re-querying always returns fresh work). A single `npm run queue:ingest:albums` now drains the entire queue. `--limit=N` still works as a total cap across all pages.

**2026-06-16 — Mobile app: Expo bring-up on Windows + i18n + design-pass start:**

*Expo Go bring-up (Windows):*
- **Dependency skew fixed** — `apps/mobile/package.json` had `expo-font`, `expo-linking`, `expo-secure-store` pinned to **SDK 56** versions (`^56.x`) inside an **SDK 54** project (someone ran `npm install <pkg>@latest` instead of `expo install`). Corrected to SDK-54 versions (`expo-font@~14.0.12`, `expo-linking@~8.0.12`, `expo-secure-store@~15.0.8`); pinned `react-native@0.81.4` (was `^0.81.5`, floated to 0.81.6 which demands `react@^19.1.4`). `expo` bumped `~54.0.35`. Installs now resolve; the missing `expo-font` plugin that blocked `expo start` is fixed.
- **Connectivity** — iPhone↔PC timeout was the **Wi-Fi network profile set to Public** (Windows blocks inbound to Node on Public); switching to Private + existing Node firewall rules fixed LAN. Also: the "unverified app" Expo-account prompt blocks the dev server until answered (choose *Proceed anonymously*). Note `EXPO_PUBLIC_API_URL` unset in `apps/mobile/.env` → Spotify-powered mobile search disabled until set.
- **Monorepo install caveat** — `npx expo install --fix` fails on an unrelated `@radix-ui` peer conflict bleeding in from `apps/web`; install expo packages directly with `--legacy-peer-deps` and the SDK-54 version. (`apps/mobile` is standalone — not in the root `workspaces` array.)

*Design pass — 4 changes (user-requested):*
- **i18n / device language** (new `apps/mobile/lib/i18n/`) — `en.ts`/`ko.ts` dicts + `LanguageProvider` using `expo-localization` `getLocales()` to follow the **phone's language** (Korean device → Korean UI; manual override persisted to AsyncStorage for a future settings toggle). Wired into root `_layout`, the tab bar, login, and all 5 tab screens. `expo-localization@17.0.9` installed + added to `app.json` plugins. **Partial by design** — only UI chrome is translated; deeper strings (home genre-category names, relative timestamps) still English, to be done in the per-page pass.
- **Login** ([(auth)/login.tsx](apps/mobile/app/(auth)/login.tsx)) — now **non-scrollable** (centered flex, keyboard still shifts), swapped wordmark → **flower mark** (`logo.png`), all strings localized.
- **Home** ([(tabs)/index.tsx](apps/mobile/app/(tabs)/index.tsx)) — top navbar (logo + search icon) **removed entirely**.
- **Unified headers** (new [components/ScreenHeader.tsx](apps/mobile/components/ScreenHeader.tsx)) — one title style (26px / 800 / -0.6) now used by Activity, Rankings, Search, Profile (were 24/800, 28/700, 20/700). `borderless` variant for Search.

*Design tooling explored:*
- Built `apps/mobile/design-board.html` (all screens as phone frames on one canvas) to get a Figma-style glance view. **Verdict: an HTML recreation can't match native iOS** (frame size, SF vs Segoe font, spacing) — looked "off" vs real app. **Decision: use a board made of real screenshots** instead (pixel-accurate) for the page-by-page design pass. Board file is a throwaway/scratch artifact (left untracked).

*Known issues opened this session:*
- **Login logo still shows a white box** — `logo.png` has a solid white background (not transparent), visible against the cream `#F8F8F6`. Needs a transparent/background-knocked-out version. (The "background-removed logo" request is not fully satisfied yet.)
- **Theme colors are hardcoded inline** across all 17 mobile screens (no theme module; `constants/Colors.ts` is only the Expo light/dark stub). Core palette: `#F8F8F6` cream bg · `#1A1A18` ink · `#8C8C8A` muted · `#E8E8E6` border · `#FFFFFF` surface · `#D97706` amber accent (+ `#FEF3DC`/`#FDE8B0` tints). Extraction into design tokens proposed, not yet done.

*Catalog (continuation):*
- `backfill:tracklists` **✅ full run complete** — 115,604 rows → 107,778 filled (106,652 via `itunes_id`, 1,126 via search), 7,826 no-match (**93% coverage**). README table + Step 6 updated.

**2026-06-14 (session 3) — Tracklist backfill + storage analysis + catalog expansion plan:**

*Tracklist backfill (album pages missing tracklists):*
- **Root cause** — the album page hides its tracklist section when `tracklist` is empty ([album/[mbid]/page.tsx:346](apps/web/app/(main)/album/[mbid]/page.tsx#L346)). The `tracklist` column is only ever written by `cacheAlbum()` (full Spotify album detail). The catalog is overwhelmingly iTunes-sourced, and `ingest-itunes-queue.ts` wrote only `total_tracks` (count), never the track list — so ~115.6k non-single rows had `tracklist = null` and rendered without tracks. The DB-first album page (2026-05-28) also stopped calling Spotify when any DB row exists, so visits no longer backfilled them.
- **`scripts/backfill-tracklists.ts`** (new) — fills `tracklist` from iTunes (`lookup?entity=song` by stored `itunes_id`; search fallback resolves + persists `itunes_id`). Maps to the page's render shape, handles multi-disc albums, sets `total_tracks` when null. Resumable, `--dry-run`/`--limit`/`--include-singles`/`--skip-search`. Singles skipped by default. iTunes-only. npm: `backfill:tracklists[:dry]`.
- **`ingest-itunes-queue.ts`** — added `--with-tracks` (off by default) to populate tracklists inline on future ingests.
- **Verified** — dry + real `--limit=3` runs succeeded (31/10/52 tracks via `itunes_id`). Fixed a state-file bug (dry runs were persisting processed IDs); cleared the polluted state file.

*Storage analysis (Supabase Pro, 8 GB disk):*
- Disk breakdown 2026-06-14: **database 0.90 GB · WAL 0.56 GB · system 0.16 GB · available 6.21 GB** (used ~1.62 GB of 8). `measure-storage.ts` (new, read-only) estimates: 118,672 embeddings ≈ 486 MB + HNSW; tracklists after full backfill ≈ +0.3 GB.
- **Decision: stay on Pro.** Downgrading to Free is impossible — DB (1.62 GB) is 3.2× the Free 500 MB cap → project would go read-only; also Free auto-pauses after 7 days and lacks the IO budget for the trigram/HNSW indexes.

*Coverage analysis + catalog expansion plan:*
- **`scripts/analyze-coverage.ts`** (new, read-only) — genre-token / native-language / decade / culture-probe breakdown. `--albums-only` restricts to the recommendable set.
- **Key finding:** catalog is NOT Korean-dominated — Last.fm "similar" snowball drifted to Western electronic/hip-hop. In the recommendable set (110,728 albums+EPs): electronic 15.4%, hip-hop 12.3%, **k-pop only 5.9% (Korea ~8–11% overall)**. Asian-neighbour gaps are severe: **SE Asia 4 albums, China 393, India 63, Japan ~2,823**. Genre mix is otherwise healthy; pre-2000 depth ~19% is fine.
- **[CATALOG_EXPANSION_PLAN.md](CATALOG_EXPANSION_PLAN.md)** (new) — target composition (region + genre) for the recommendable set, storage projection vs 8 GB (lands ~2.4–4 GB, comfortable), and ordered run commands. Do NOT re-run the blanket `queue:discover` (re-inflates electronic/hip-hop).
- **Positioning clarified by user:** the platform's end goal is a **global** community, so Korean dominance is NOT required. Korea at ~8–11% is fine; target held at ~12%. A Korean depth pass is **optional**, not a blocker. Plan + README updated to reflect this (earlier draft had flagged Korea as a required fix).
- **`scripts/build-global-queue.ts`** (new) — region-grouped Wikipedia seed (Japan / Greater China / SE Asia / South Asia / Western canon / Africa / Europe-world), source-tagged `wikipedia_<region>`, native-name detection extended to ko/ja/zh/th/hi/ar. Japan dry-run confirmed working (idol groups 312, etc.).
- **`scripts/discover-global.ts`** (new) — Last.fm discovery **scoped to global-seed artists only** (MAX_SIMILAR=10), so growth stays inside each culture instead of drifting Western.
- **`ingest-itunes-queue.ts`** — added `--skip-singles` (composition lever). npm: `queue:ingest:albums` = `--skip-singles --with-tracks`.
- **`scripts/catalog-status.ts`** (new) — live dashboard (`npm run catalog:status`): queue by status + per-region (source) with releases-added, artists in catalog, releases by type, and releases by native_language / region / genre family. Count-only queries so it's fast at ~350k rows. Use it to watch the expansion and verify region targets.
- New npm scripts: `catalog:status`, `analyze:coverage[:albums]`, `queue:build:global[:dry]`, `queue:discover:global[:dry]`, `queue:ingest:albums`.
- **Concurrency rule:** iTunes jobs (`backfill:tracklists`, `queue:ingest:albums`) must not run simultaneously; `queue:build:global` (Wikipedia) and `queue:discover:global` (Last.fm) are safe alongside either.

*Execution progress (ran 2026-06-14→15):*
- `queue:build:global` — first run yielded only 1,106 (Wikipedia throttled categories mid-run); **re-run recovered 5,898 seed artists** across all regions (japan 2,048, western_canon 1,702, europe_world 611, south_asia 596, greater_china 392, sea 300, africa 249). The persistent `0 pages` categories are non-existent Wikipedia category names, not throttling.
- `queue:discover:global` — scoped fan-out from the 5,898 seeds: queued ~39k similar (attempted), queue peaked ~30,751 pending. **One controlled pass only** — blanket discover deliberately not used.
- `queue:ingest:albums` — draining the queue in batches. So far ~14,400 new albums/EPs inserted (8,512 + 5,927). **Diminishing returns observed** — skip ratio rose from ~1.5:1 to ~4:1 (22,435 skipped vs 5,927 inserted last batch) as the queue saturates. Stop discovery; finish draining then move to enrichment.
- `backfill:tracklists` — **✅ full run complete 2026-06-16:** 115,604 non-single rows processed → 107,778 filled (106,652 via `itunes_id`, 1,126 via search), 7,826 no tracks found (**93% coverage**). Remaining misses are releases with no resolvable iTunes match (long-tail / non-iTunes catalog).
- **Positioning clarified by user (see below):** global, not Korea-dominant.
- **Next:** finish the in-flight `queue:ingest:albums`; then enrichment backfills (genres → native → covers → embeddings, then rebuild HNSW index); then `analyze:coverage:albums` + `catalog:status` to diff against the plan's §5c region/genre targets.

---

**2026-06-14 (session 2) — Logo, language detection, onboarding improvements:**

- **Logo swap** — replaced `public/logo-flower.svg`, `public/logo.svg`, and `apps/mobile/assets/images/logo-flower.png` with Asset 21 (transparent background). Dark mode white-box issue resolved.
- **Browser language detection** — two-layer fix: `lib/i18n/server.ts` reads `Accept-Language` header for SSR (zero flash for Korean users); `lib/i18n/index.tsx` reads `navigator.language` on mount for client. Auto-detected language is NOT written to `localStorage` so future browser-language changes are respected; only explicit Settings picks persist.
- **Onboarding: sidebar/footer/listen-later hidden** — `MainLayout.tsx` uses `usePathname()` to detect `/onboarding` and hides `<Sidebar>`, `<PlaylistPanel>`, `<Footer>`. `SiteHeader.tsx` gains `isOnboarding` prop: logo rendered as `<span>` (non-clickable), hamburger hidden. Users cannot navigate away mid-flow.
- **Onboarding: genre pills from DB** — new `GET /api/genres/top` route counts how many releases match each genre label via `GENRE_KEYWORD_MAP` and returns them sorted most→least frequent. `StepGenres` fetches on mount, falls back to hardcoded list on error.
- **Onboarding: Apple Music added** (step 3) — new streaming platform option across: `StreamingPlatformContext.tsx` (type + VALID), `YouTubeMusicButton.tsx` (icon + visibility + search URL `music.apple.com/search?term=`), `settings/page.tsx`, `onboarding/page.tsx`. **Requires DB migration `20260615000000_add_apple_music_platform.sql`** — drops + recreates the CHECK constraint on `profiles.preferred_streaming_platform` to include `apple_music`. Apply via Supabase SQL editor before deploying.
- **Onboarding: Essentials step Albums > EPs > Singles** — `StepAlbums.loadDefaults` now fetches 4× the grid size and sorts by release_type (album=0, ep=1, single=2) before slicing. Canon suggestions already excluded singles; this applies to the fallback pool.
- **i18n**: Updated `streamingNoneDesc` in en.ts ("Show all three buttons" → "Show all buttons") and ko.ts ("세 가지 버튼 모두 표시" → "모든 버튼 표시").

**Pushed:** All commits pushed to `main` at end of session — Vercel auto-deploy triggered. **Pending:** Apply migration `20260615000000_add_apple_music_platform.sql` via Supabase SQL editor before testing Apple Music preference in prod.

---

**2026-06-14 — QA pass #1 (test account junn223+qa@gmail.com, local dev port 3001):**

Found and fixed 2 bugs during end-to-end QA (plus 2 from previous session carried forward):

- **ISSUE-002** (prior session) — `archive.org` added to CSP `img-src` and Next.js `remotePatterns` so Last.fm cover art loads without CSP violations.
- **ISSUE-003** (prior session) — `/settings` now redirects unauthenticated users to `/login` via middleware (`apps/web/middleware.ts`).
- **ISSUE-005** — `ensureRelease` in `AlbumActions.tsx` and `PlaylistContext.tsx` missing `release_type: 'Album'` in upsert payload. Production `releases.release_type` is `NOT NULL` without a default; PostgreSQL evaluates NOT NULL before conflict resolution so even `ON CONFLICT DO NOTHING` returned error 23502. Fix: supply `release_type: 'Album'` in both UUID and Spotify-ID branches of both files.
- **ISSUE-006** — `toggleFollow` in `friends/page.tsx` called `/api/follow` without `Authorization: Bearer` header; every follow/unfollow returned 403 Forbidden. Fix: fetch `session.access_token` before the request and include it in headers. Also: state update now only fires on 2xx response; `loadFriends(myId)` re-runs after success to refresh tab counts and list immediately.

QA results — all flows verified on local dev (same prod Supabase DB):
- ✅ Signup → email confirmation → onboarding (display name, username, genres, Essentials)
- ✅ Profile page — avg 4.0, 1 rating, Essentials from onboarding, LILAC in rated grid, Monthly Capsule June 2026
- ✅ Add album to custom collection (LILAC → "My K-Pop Picks") — persists after page reload (ISSUE-005 fix)
- ✅ Collections sidebar — switches between Listen Later and custom collections correctly
- ✅ Follow user (junnwest) — "Following 1" tab updates immediately, user card appears (ISSUE-006 fix)
- ✅ Activity feed (`/activity`) — junnwest's ratings appear after follow
- ✅ Notifications — 15 unread from junnwest's ratings; "Mark all read" clears badge and shows "All caught up"
- ✅ Settings → Account: display name save (button shows "Saved"), email visible
- ✅ Settings → Preferences: streaming platform toggle (Spotify → YouTube Music), Discovery/Adventurousness slider moves to 75
- ✅ Log out → `/settings` redirects to `/login` → log back in with username `junn223qa` (not email)

Local commits to push (5 total):
- `ae6f228` fix(qa): ISSUE-002 — add archive.org to CSP img-src and remotePatterns
- `233375a` fix(qa): ISSUE-003 — redirect unauthenticated users from /settings to /login
- `c6fc6fb` fix(listen-later): scope localStorage keys per user ID
- `b95dab9` fix(qa): ISSUE-005 — supply release_type in ensureRelease upsert
- next commit: fix(qa): ISSUE-006 — send Authorization header in toggleFollow

**Next action:** `git push origin main` → Vercel auto-deploys → verify follow flow on sillajuku.com.

---

**2026-06-13 — DB-FTS-first search + pre-launch audit:**

- **Pre-launch audit** — cross-checked task list against README. Confirmed done: rate limiting (all mutation routes + `/api/search`), Upstash Redis caching (leaderboard scores, album stats, ranking badges, search suggest), all seeds, all migrations. `JINA_API_KEY` confirmed in Vercel env — hybrid semantic search is active in prod.
- **DB-FTS-first search** (`apps/web/app/api/search/route.ts`) — two fixes: (1) artist search now tries `searchArtistsInDb` first; only calls Spotify when DB returns < 5 results (was always Spotify-first on cache miss); (2) removed background Spotify refresh that fired on every successful DB hit for releases — with 347k releases and a stable catalog this was burning quota for no benefit. Spotify for releases is now only called when DB returns < 5 results.
- **Pre-launch status: one task remaining** — QA end-to-end on production (create test account, walk the full signup → onboarding → rate → rank → follow → feed → notifications flow).

**QA checklist for next session** (run on sillajuku.com in incognito):
- [ ] Signup → email confirmation (check noreply@sillajuku.com arrives, sender name = "sillajuku")
- [ ] Onboarding — display name, username, country, genres, streaming platform, Essentials
- [ ] Homepage — genre rows load, search dropdown works, daily question appears
- [ ] Album page — rate, comment, streaming buttons, "In Rankings" chips
- [ ] Search — Korean artist by English name, by Korean name (e.g. IU / 아이유), album search
- [ ] Leaderboard — categories load, open one, build a tierlist, save it, verify vote reflected
- [ ] Add to Ranking from album page — checkmark appears on selected category
- [ ] Collections panel — create collection, add album, confirm it appears
- [ ] Profile page — stats, Essentials strip, rated grid, Taste DNA badges
- [ ] Follow another user → check feed shows their activity → check notification appears + clears
- [ ] Settings — edit display name, change streaming platform, move Adventurousness slider
- [ ] Log out → try accessing /settings → confirm redirect → log back in with username

---

**2026-06-12 — Pre-launch checklist pass:**

- **All commits already deployed** — confirmed no unpushed commits; Vercel is live and up to date with main.
- **Spotify playlist export configured** — added `https://sillajuku.com/api/spotify/callback` to Spotify developer dashboard redirect URIs; added `SPOTIFY_REDIRECT_URI` to Vercel env vars; added `http://localhost:3000/api/spotify/callback` to `.env.local`. Note: playlist export uses user-authenticated OAuth (Authorization Code flow), not client credentials — it does not share quota with the circuit-breaker-protected Spotify calls and cannot cause app-wide rate limiting.
- **Country collection** — already fully implemented (was done in a prior session); `COUNTRIES` array, dropdown in Step 1 of onboarding, and `country` upsert in `handleFinish` all in place. `20260521000000_profiles_country.sql` migration applied. Nothing to do.
- **Supabase email confirmations** — verified SMTP configured via Resend (`noreply@sillajuku.com`, sender name "sillajuku", host `smtp.resend.com`). Confirm sign-up toggle enabled.
- **Post-deploy seeds**: Ranking categories seeded (`POST /api/admin/seed-rankings` → `{"ok":true,"seeded":6}`). Homepage genre rows seed skipped — `curated_releases` is only a fallback; with 347k releases, `RecommendationGrid` always uses the primary DB path. Seed-votes skipped — leaderboards already have baseline data via `ranking_seed_entries` (RS500, K-Pop, Hip-Hop, Korean, K-Hip-Hop, Best 2025).

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
- [x] Preferred streaming platform — `preferred_streaming_platform` column on profiles (migration `20260531000000`); set in onboarding step 3 (4-step flow) and Settings → Preferences; album + track buttons filter to the single preferred platform when set, fall back to all three otherwise
- [x] Custom playlists + right panel — persistent right-side playlist panel (desktop 260px, mobile overlay); uses existing `lists`/`list_items` tables; CRUD (create, rename, delete); "Add to [active list]" in AlbumActions dropdown + `QuickAddButton` on every track row; Spotify OAuth connect + playlist export; YouTube Music limitation surfaced in UI; Copy tracklist; migrations `20260601000000` (position + UPDATE policy) and `20260601000001` (spotify_connections)
- [x] Collections (2026-06-08) — playlists renamed to "Collections" (user-facing); route `/collection/[id]`; right panel foldable on all breakpoints (fold button + floating reopen); per-add destination picker (`CollectionPickerPopover`) confirms "Added to {collection}" and offers "Change to →" to re-route an item to any other collection
- [x] Silla Score recomputed — Bayesian-damped calibrated star ratings (55%) + normalized tierlist-position score (45%); Postgres function `get_calibrated_bayesian_scores`; migrations `20260601000002` + `20260601000003`
- [x] Discovery/Adventurousness slider — Settings → Preferences slider (0–100, default 50); `recommendation_adventurousness` column on profiles; shifts For You mix between in-taste / adjacent / discovery buckets
- [x] Track star ratings — inline 14px star widget per track; writes to `track_ratings` table (migration in `supabase/migrations/20260526000000_track_ratings.sql` — apply manually)
- [x] Inline star ratings — compact widget on Explore cards, rankings leaderboard ("Your Rating" column), ranking builder suggestions
- [x] My Rankings (`/my-rankings`) — dashboard with ranking cards (All, Albums, EPs, Songs, per-genre) + "Recommended for You"; detail pages at `/my-rankings/[slug]`
- [x] Daily Question — one question per day surfaced at the top of the homepage; user picks an album from the catalog to answer; answer saved to `daily_answers` table; exports a 1080×1920 (story) or 1080×1080 (square) PNG card via `GET /api/daily-question/card` (Next.js edge ImageResponse, no extra packages); migration `20260531000001_daily_questions.sql` seeds 30 questions through 2026-06-29

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

**2026-06-11 — Performance overhaul + live search dropdown:**

- **Homepage blank-screen fix** — added `<Suspense fallback={null}>` around `<RecommendationGrid />` in `app/(main)/page.tsx`. Without it, Next.js blocked the full page response on slow DB queries, leaving users staring at a blank page for minutes as the database grew to ~347k rows.
- **GIN trigram index on `releases.genres`** — migration `20260611000000_genres_trgm_index.sql`, applied via Supabase SQL Editor with `SET maintenance_work_mem = '64MB'`. `RecommendationGrid` uses `ILIKE '%genre%'` (substring match) which requires a trigram index. Without it, every category row was firing a full sequential scan, exhausting Supabase's Disk IO Budget and throttling disk to 5 MB/s. Required upgrading to **Supabase Pro** — the free tier's IO budget was too depleted to build the index (connection timeout every attempt). Once Pro was active, the index built successfully.
- **`get_user_id_by_email_prefix` SQL function** — migration `20260611000001_user_id_by_email_prefix_fn.sql`, applied via Supabase SQL Editor. Profile page (`app/(main)/profile/[username]/page.tsx`) was calling `auth.admin.listUsers({ perPage: 1000 })` to find one user by their email prefix — fetching up to 1,000 rows to match one. Replaced with a targeted `SECURITY DEFINER` function querying `auth.users` directly.
- **Album page ranking badge Redis cache** — `album/[mbid]/page.tsx` now caches the "In Rankings" computation under `sj:album-rankings:{id}` with a 5-minute TTL. Pre-cache: 10–15 queries per page load. Post-cache: single ~30ms Redis ping on hit.
- **`category-resolver.ts` query cap** — added `.limit(500)` to the ratings query (was unbounded — on a large dataset this could pull tens of thousands of rows per homepage load).
- **`canon-suggestions.ts` over-fetch reduction** — reduced both fetch multipliers from 4×/3× to 2×.
- **`SearchBar` component** (`apps/web/components/SearchBar.tsx`) — new standalone search bar component replacing the inline desktop `<form>` in `SiteHeader.tsx`. Features: 300ms debounce, 2-character minimum before firing, live dropdown with Artists section (circular avatar) + Albums section (square cover art) + "See all results" link, keyboard navigation (↑/↓/Enter/Escape), click-outside close, loading spinner while fetching.
- **`/api/search/suggest` endpoint** (`apps/web/app/api/search/suggest/route.ts`) — dedicated lightweight suggest endpoint. No Jina embedding, no Spotify/iTunes fallback. Prefix match (`q%`) instead of substring (`%q%`) — hits B-tree indexes rather than requiring a trigram scan. Both artist and release queries share a single DB connection. Orders releases by `prestige` (has partial index) instead of `ratings_count` (no index). 10-minute Redis cache under `sj:suggest:{query}`. Server-side 2-character minimum. Dropdown response is now near-instant after the first query (cached).
- **Root cause of initial ~10s dropdown latency**: `searchReleasesInDb` was calling `searchReleases` → `embedQuery` → external Jina API call on every cache miss. Fixed by bypassing the full search pipeline entirely.
- **Root cause of subsequent ~2s dropdown latency**: (1) `searchArtistsInDb` used `%q%` leading wildcard (no index on short queries), (2) two separate `createServerClient()` calls, (3) `ratings_count` column has no index so ORDER BY was expensive. Fixed by prefix match, shared connection, and `prestige` ordering.

---

**2026-06-09/10 — `backfill:embeddings` complete + HNSW index rebuilt:**

- **Found backfill incomplete** — overnight run was interrupted by computer shutdown. Dry-run confirmed 93,090 releases still needed embeddings at session start.
- **First resume run** — 2,048 rows embedded before hitting a Supabase statement timeout (`canceling statement due to statement timeout`). Script is resumable; re-ran immediately.
- **Second resume run** — 92,151 embedded, 66 failed. One Jina API batch failed early (page counter incremented to 2, skipping those rows + 2 DB update errors = 66 total).
- **Final cleanup run** — 64 rows embedded, 0 failed. All releases now have Jina v3 embeddings. Catalog pipeline fully complete.
- **HNSW index rebuilt** — `CREATE INDEX idx_releases_embedding_hnsw ... USING hnsw (vector_cosine_ops)` + `DROP INDEX idx_releases_embeddable` applied in Supabase SQL editor.
- **Catalog pipeline status: 100% done.** Deploy to Vercel to activate hybrid semantic search in production.

---

**2026-06-08 — Playlists → Collections rename, foldable panel, per-add destination picker:**

- **Playlists → Collections**: renamed the custom-playlist feature to "Collections" across user-facing labels. Updated `PlaylistPanel.tsx` ("New collection", "Collection name…", "Open full collection", "Collection options", "Delete this collection?"), `AlbumActions.tsx` ("Add to collection" menu item + modal title + empty state), the per-list page default title/empty state. Route moved `/playlist/[id]` → `/collection/[id]` (only linker was the panel's external-link button). Internal component/type names (`PlaylistContext`, `PlaylistPanel`, `usePlaylist`, `PlaylistItem`) kept as-is to limit churn — purely user-facing rename.
- **Foldable Collections panel**: the right-side panel can now be collapsed on every breakpoint (was mobile-only). Header gets a `PanelRightClose` fold button; when collapsed a floating round button (bottom-right, all breakpoints) reopens it. On desktop, collapsing frees the 260px column so content reflows wider.
- **Per-add destination picker**: new `CollectionPickerPopover.tsx` (portaled to `document.body`, fixed-positioned so it escapes card `overflow-hidden`). After tapping "+" on any album/track, items still go to the **open** collection by default, then a popover confirms "Added to {collection}" and offers "Change to →" to re-route the item to any other collection (move = remove from previous dest + add to target). Wired into `QuickAddButton` (inline + overlay), `ScrollRow`'s `QuickAdd`, and `PersonalizedFeed`'s `QuickAddOverlay`.
- **PlaylistContext** refactor: existing `addToActive` / `removeFromActive` / `removeTrackFromActive` now delegate to generic `addItemTo(listId, …)` / `removeItemFrom(listId, releaseId, trackPosition?)` (null listId = Listen Later). Active membership sets (`activeReleaseIds` / `activeTrackKeys`) + panel refresh only update when the affected collection is the open one. Added `nameForList(listId)` helper. No schema changes.

---

**2026-05-31 — Leaderboard rename, Tierlist builder, Social tab, Comment sort/filter, Accomplishment badges:**

- **Rankings → Leaderboard**: renamed the community ranking feature to "Leaderboard" across all user-facing labels, routes, and components. New routes: `/leaderboard`, `/leaderboard/[slug]`, `/leaderboard/[slug]/rank`, `/leaderboard/build`. Old `/rankings/*` routes redirect 301 → `/leaderboard/*` via `next.config.mjs`. Updated: `Sidebar.tsx`, `BottomNav.tsx`, `FilterBuilder.tsx`, `TopRankingsMenu.tsx`, `RankingsGrid.tsx`, `AlbumActions.tsx`, `album/[mbid]/page.tsx`, i18n `en.ts` + `ko.ts`.
- **Tierlist builder**: personal ranking builder ("Make Your Own Ranking") renamed to "Tierlist". `RankBuilder.tsx` updated: back link → "Leaderboard", save button → "Save Tierlist", toasts + modal copy updated. Numbered ordering UI (1, 2, 3…) and tie support unchanged. Route `/leaderboard/[slug]/rank`.
- **My Tierlists**: `/my-rankings` page title + back button updated to "My Tierlists". Sidebar label updated from "My List" → "My Tierlists". Route kept as `/my-rankings`.
- **Friends → top-level nav**: Friends link moved from `SiteHeader` profile dropdown to `Sidebar` as a dedicated tab (Users icon). Sidebar now has 5 nav items: Leaderboard, My Tierlists, Feed, Friends, Explore. Friends removed from dropdown to avoid duplication.
- **Comment sort/filter**: `ReviewsSection.tsx` gains sort controls (Newest / Oldest / Most liked) and filter controls (All / Public / Friends-only) shown when there's >1 comment. Sort/filter are purely client-side — no new fetch calls.
- **Accomplishment badges**: migration `20260601000010_accomplishments.sql` adds `accomplishment_definitions` + `user_accomplishments` tables with RLS. Seeded 5 badge definitions: First 10 (10 ratings), Fifty Deep (50), Century Club (100), Audiophile (500), Full Sweep (rated every album in a leaderboard). `lib/accomplishments.ts` — `checkAndAwardRatingMilestones()` + `checkLeaderboardCompletion()`. `GET /api/accomplishments` — public fetch for a user's badges. `POST /api/accomplishments` — awards milestones after rating. Notifications page updated to handle `badge` type with Trophy icon. ProfilePanel fetches + renders a Badges card in the left sidebar (emoji + label, tooltip on hover). **Migration must be applied**: `supabase db push` or paste into SQL editor.

---



**2026-06-01 — Silla Score recompute + Discovery slider + recommendation buckets:**

- **Silla Score recomputed**: formula now combines calibrated Bayesian star ratings (55%) + normalized tierlist-position score (45%). Per-user calibration: z-score against each user's mean and volatility (std dev), clamped to ±2.5σ, mapped back to [0.5, 5]. Bayesian damping: `(v/(v+10))*R_calibrated + (10/(v+10))*C_global` pulls low-rating-count albums toward the global mean. Rankings + album-page rank display both use the new formula. `rankings/[slug]/page.tsx` cache key bumped to `v2` to force recomputation.
- **Postgres function** `get_calibrated_bayesian_scores(release_ids uuid[])` (migration `20260601000003`) — efficient SQL computation, called server-side via `supabase.rpc()`.
- **`recommendation_adventurousness` column** on `profiles` (migration `20260601000002`) — smallint 0–100, default 50.
- **Discovery slider** in Settings → Preferences: "Conservative ↔ Adventurous" range input, auto-saves on release, labelled with three thresholds (Conservative / Balanced / Adventurous). Reads/writes `recommendation_adventurousness`.
- **Three-bucket recommendations** in `/api/recommendations`: proportions interpolated from adventurousness — Conservative (0): 90/8/2%, Default (50): 70/20/10%, Adventurous (100): 45/30/25%. In-taste = artist-matching, Adjacent = genre-matching (not artist-matching), Discovery = community-loved (ratings_count DESC) preferring outside-taste artists. Albums from artists the user rated ≤2★ are excluded from in-taste + adjacent buckets.
- **ExplorePage** now fetches genres from liked (≥3★) rated albums, `recommendation_adventurousness` from profile, and user ID — all passed to the recommendations API.

---



**2026-06-01 — Silla Score fix (ratings now actually move the leaderboard):**

Diagnosed why ratings had no visible effect on rankings and fixed it end-to-end. Root causes:
- **Bayesian damping far too strong** for the early-stage dataset. `m=10` pseudo-votes pulled nearly every album to the global mean, so `ratingScore` ≈ 0.5 for *everything* and the 55% rating half carried no ordering signal. → Reduced to `m=3`.
- **Seed votes drowned out real tier-lists.** Seeds (large vote counts) were summed into the same raw pool as user tier-list contributions (≤1.0 each), then normalized by the max — so genuine tier-lists became a rounding error. → Tier-lists and seeds are now each normalized to [0,1] *separately*, then blended `0.7·tierlist + 0.3·seed` within the 45% rank half, so real tier-lists outweigh pre-launch seed priors.
- **Rated-but-not-tier-listed albums could never appear.** Candidate set was tier-list ∪ seed only. → New RPC `get_silla_rating_scores(release_ids, p_genre, p_year)` also pulls in any rated release matching the category's genre/year, so a highly-rated album can climb a leaderboard on its own.
- **Conflicting duplicate migration removed**: deleted misplaced `supabase/migrations/20260601000001_silla_score_fn.sql` (2-col return) that conflicted with the deployed 3-col `apps/web/.../20260601000003`.
- **Cache lag**: score recompute TTL cut from 5 min → 60 s so rating changes surface quickly.

Implementation: extracted shared math to `apps/web/lib/sillaScore.ts` (`computeTierlistScores`, `combineSillaScores`) — kills the triplicated `computeSillaScores` that had drifted between `leaderboard/[slug]`, `rankings/[slug]`, and `album/[mbid]`. All three now use the identical blend, so an album's "#N in category" on its page matches the leaderboard exactly. Cache key bumped `v2`→`v3`. Migration `20260601000011_silla_score_tuning.sql` re-tunes `get_calibrated_bayesian_scores` to m=3 + adds `get_silla_rating_scores`.

---



**2026-06-01 — Prod migration apply + Streaming Platform rebuild:**

- **Applied to prod** (via Supabase Management API, `.env.local` + management token restored on this device): `20260531000003_profiles_streaming_platform.sql` (the missing `preferred_streaming_platform` column — root cause of the save bug) and `20260601000011_silla_score_tuning.sql`. The latter needed a `DROP FUNCTION` first: prod actually shipped the **2-col** `get_calibrated_bayesian_scores(release_id, bayesian_score numeric)` from the root-dir `0001` file (committed in `4ff39a3`), never the 3-col `apps/web/.../0003`. Verified post-apply: both functions present with 3-col `(release_id, bayesian_score float8, rating_count bigint)` signatures; spot-checked scores now spread 3.40–4.03 across 2–3-rating albums (m=10 had pinned them all near the mean). **Silla Score fix is now live in prod.**
- **Then applied the remaining 3** at the user's request: `20260601000000_list_panel_updates` (`list_items.position` + `lists` UPDATE policy), `20260601000001_spotify_connections`, `20260601000002_adventurousness`. Prod is now fully in sync with the migration history — all verified present.

**Preferred Streaming Platform — near-complete rebuild.** The feature didn't save (column missing in prod → every UPDATE errored, preference stayed null → "all 3 icons shown for every choice"). Beyond applying the column:
- **Root cause of the design smell**: `usePreferredPlatform` ran a Supabase query on *every* `StreamingButtons`/`TrackStreamingButtons` mount (N+1 — an album page with 15 tracks fired 15+ identical queries) and ignored the server hint; the album page's server-side fetch was dead code (`getUser()` on the service-role client has no session → always null).
- **New `components/StreamingPlatformContext.tsx`** — fetches the preference **once** per session, re-loads on `onAuthStateChange`, and exposes `savePreferred()` with optimistic update + rollback-on-error. Mounted in `MainLayout` above `PlaylistProvider`.
- `YouTubeMusicButton.tsx` — both button components now read `useStreamingPlatform()` (zero per-button queries) via a shared `visibility()` helper. `preferred` props removed.
- `album/[mbid]/page.tsx` — deleted the dead server-side `preferredPlatform` fetch + props.
- `settings/page.tsx` — platform selector now drives the context (`savePreferred`), so a change reflects on album/track pages instantly without reload; added a save-error message, a buttons-disabled-while-saving state, and a helper line ("All services shown" / "Only your chosen service shown").

---

**2026-06-01 — Custom playlists + right panel + Spotify export:**

- **`PlaylistContext`** — React context (`PlaylistProvider`) wrapping the full layout; exposes `activeListId`, `activeListName`, `playlists`, `addToActive`, `panelOpen/setPanelOpen`. Provides global "add to current list" without prop drilling.
- **`PlaylistPanel`** — persistent right-side `<aside>` (260px, sticky on XL+, overlay on mobile). List selector dropdown (Listen Later + custom playlists); create/rename/delete for custom playlists; per-album remove button; Export modal.
- **Export modal** — three options: Copy tracklist (clipboard), Export to Spotify (OAuth flow + API), YouTube Music (explicit "no write API" notice + copy fallback).
- **Spotify OAuth** — `POST /api/spotify/auth` returns authorize URL with `playlist-modify-public/private` scope; `GET /api/spotify/callback` exchanges code + stores tokens in new `spotify_connections` table; `POST /api/spotify/export` searches Spotify for each album's tracks, creates playlist, adds up to 30 tracks (3 per album, 10 albums).
- **Quick-add** — `AlbumActions` dropdown gains "Add to [active list]" item (shows checkmark for 1.5s); `QuickAddButton` client component on every track row (shows `+`/`✓`).
- **Migrations** — `20260601000000` (position column on list_items + UPDATE RLS policy for lists rename); `20260601000001` (spotify_connections table with RLS).
- **`SPOTIFY_REDIRECT_URI`** added to `.env.example`. Add to `.env.local` on both devices and to Vercel env vars. Must also be registered in Spotify Dashboard → Redirect URIs.

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
- **`backfill:genres`** — still running as of session end.

### Pending pipeline (run in order after `backfill:genres` finishes):
1. `npm run backfill:native:releases`
2. `npm run check:completeness`
3. `npm run queue:ingest` (overnight — 8,968 artists)
4. `npm run queue:discover` → `npm run queue:ingest` (repeat until stable)
5. `npm run backfill:embeddings` (once ingest loop is stable)

---

**2026-05-31 — UI polish + artist page redesign + fixes:**

- **Explore filters** — genre/type/decade filter bar added to Explore page. Filters are passed to `/api/recommendations` as `filterGenre`, `filterType`, `filterDecade` and applied to all three recommendation buckets + the prestige fallback. Ships: Release Type chips (All/Albums/EPs), Decade dropdown (2020s–1970s), Genre dropdown (14 broad genres). Country + language skipped (no reliable DB backing).
- **Bookmark overlay on Explore cards** — bookmark icon moved from below-card row to a circular amber/glass overlay pinned to top-right corner of album cover. Overlays on hover, fills amber when saved.
- **Bookmark + Quick-Add on home page cards** — `ScrollRow.tsx` updated: bookmark and add-to-playlist ("+") circular overlays appear on card hover, both pinned to top-right of cover image. Same change applied to PersonalizedFeed recently-rated cards.
- **Notification bell in nav** — dedicated `<Bell>` icon button added to the top-right of `SiteHeader`; shows red dot badge when there are unread notifications. Old dot-on-avatar removed.
- **View Artist Page button on search** — restyled from plain `text-mint-dark` text to a solid amber `#E8A020` pill button inside the artist match card.
- **Artist page redesign** — full visual overhaul: blurred-cover hero (like album page), circular artist avatar, native name below main name (when different), genre pills, stats row (followers / avg rating / total community ratings / release count breakdown). "Top Rated" section (≥2 ratings, rank badge + score badge overlay). Discography section uses upgraded `DiscographyGrid` that shows avg ★ score overlay on each card when rating data is available.
- **DiscographyGrid ratings** — accepts optional `stats: Record<string, ReleaseStats>` prop (avgScore + count per releaseId); shows amber `★ X.X` overlay on card thumbnails and ratings count below year.
- **Preferred streaming platform fix** — root cause: `createServerClient` uses the service-role key (no cookies), so `getUser()` always returned null on the album page and `preferredPlatform` was never set. Fix: `YouTubeMusicButton.tsx` now has `'use client'` and reads the preference from `supabaseClient` in a `useEffect`, overriding whatever the server passed. Both `StreamingButtons` and `TrackStreamingButtons` now always show the correct platform for the logged-in user.
- **Playlist panel instant refresh** — `PlaylistContext` now exposes `panelRefreshKey` (increments on every successful `addToActive`). `PlaylistPanel` watches this key and reloads its album list immediately when an item is added, without clearing existing content (skeleton only shown on initial/list-switch load).
- **Settings in Sidebar** — `Settings` icon link pinned to bottom of the sidebar column (below main nav items).

---

**2026-05-31 — Preferred streaming platform:**

- **Migration** `20260531000000_profiles_streaming_platform.sql` — adds `preferred_streaming_platform text CHECK IN ('spotify','youtube_music','tidal')` to `profiles` (nullable). Run `supabase db push`.
- **Onboarding** — expanded from 3-step to 4-step flow; new step 3 ("Where do you listen?") lets users pick Spotify, YouTube Music, Tidal, or None. `StepDots` total updated to 4. Platform saved in the final profiles upsert.
- **Settings → Preferences** — "Preferred streaming platform" control; auto-saves on click (optimistic update, no separate save button).
- **Album page** — server component now reads `preferred_streaming_platform` from `profiles` for the authenticated user and passes it as `preferred` prop to `StreamingButtons` (album hero) and `TrackStreamingButtons` (per-track row). When set, only that platform's button renders.

---

**2026-05-28 (later) — Streaming buttons, inline ratings, My Rankings, song ratings:**

### What was built

- **Streaming buttons (web)** — `YouTubeMusicButton.tsx` expanded to export `StreamingButtons` (album hero: Spotify / YouTube Music / Tidal icon row) and `TrackStreamingButtons` (per-track compact icons). Spotify uses the stored `spotifyUrl` when available; YouTube Music and Tidal always use search URLs.
- **Track star ratings** — new `TrackStarRating.tsx` component (14px stars, half-star, save/clear). Writes to `track_ratings` table. Added inline to each tracklist row on the album page. New migration `supabase/migrations/20260526000000_track_ratings.sql` — **apply manually via Supabase SQL editor** (table not yet created in prod).
- **Inline star rating** — new `InlineStarRating.tsx` component. Used in: Explore page (below each card, replacing "Rate →" overlay), Rankings leaderboard (new "Your Rating" column, hidden on mobile), Ranking builder (below each search-result suggestion card). Stops click propagation so it doesn't interfere with parent links.
- **My Rankings dashboard** (`/my-rankings`) — auto-generates ranking cards from user's ratings: All Rated, Albums, EPs, Songs (from `track_ratings`), plus per-genre sections (genres with ≥3 rated items). Each card shows top-5 preview + total count, clickable to full detail page. "Recommended for You" section at bottom: unrated albums in user's top-rated genres (score ≥ 3.5).
- **My Rankings detail page** (`/my-rankings/[slug]`) — full-page sorted list for each slug (`all`, `albums`, `eps`, `songs`, genre slugs). Back button to dashboard.
- **Sidebar** — added "My List" nav item with `ListOrdered` icon linking to `/my-rankings`.

### Pending
- `track_ratings` table must be created in prod. SQL is in `supabase/migrations/20260526000000_track_ratings.sql`. Paste into Supabase dashboard → SQL Editor → Run. Until then, song ratings save silently fail.

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
