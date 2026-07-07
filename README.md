# sillajuku

Every record you've loved — rated, cataloged, and remembered. A music platform for listeners with taste.

**Stack:** Next.js 14 (App Router) · Swift/SwiftUI (iOS) · Supabase (auth + database) · Spotify API · Tailwind CSS

**Monorepo:** `apps/web` (Next.js) · `apps/ios` (Swift — in progress) · `packages/shared` (TypeScript types)

---

## ⚠️ Current state (2026-07-06)

Features shipped as of 2026-06-08: Daily Question, preferred streaming platform, **Collections** (custom playlists, renamed) with foldable panel and per-add destination picker, Bayesian Silla Score, Discovery/Adventurousness slider. See SESSIONS.md for details. **2026-06-10:** `backfill:embeddings` ✅ complete — all ~347k non-single releases have Jina v3 embeddings. HNSW index ✅ rebuilt (2026-06-09). Hybrid semantic search ready — deploy to Vercel to activate. **2026-06-11:** Performance overhaul — homepage blank-screen fix (Suspense streaming), GIN trigram index on `releases.genres` (eliminates IO-exhausting full-table scans; required **Supabase Pro** upgrade to build — free tier Disk IO Budget was exhausted), Redis caching on album page ranking badges (5-min TTL, 10–15 queries → 1 cache hit), profile page `auth.admin.listUsers(1000)` → targeted SQL function, query limits on category-resolver and canon-suggestions. New live search dropdown: `SearchBar` component + `/api/search/suggest` endpoint (prefix match, no Jina, 10-min Redis cache) — near-instant after first query. **2026-06-14:** Local QA pass complete — 4 bugs found and fixed (ISSUE-002–006). Logo updated to transparent background. Browser language detection added (Accept-Language header + navigator.language). Onboarding improved: sidebar/footer/listen-later hidden, logo non-clickable, genre pills sorted by DB frequency, Apple Music added as streaming option (requires migration `20260615000000`), essentials prioritize Albums > EPs > Singles. **2026-06-16 (mobile):** Expo app brought up on Windows/Expo Go (fixed an SDK-56-vs-54 dependency skew in `apps/mobile/package.json`). Mobile design pass started — device-language i18n (`apps/mobile/lib/i18n/`, follows the phone's language, en/ko), login redesign (non-scroll + flower-mark logo), home navbar removed, unified `ScreenHeader` across the four tab screens. `backfill:tracklists` ✅ complete (107,778 / 115,604 = 93%). See SESSIONS.md (2026-06-16) for details + known issues. **2026-06-17 (architecture pivot):** React Native (`apps/mobile`) retired and deleted. iOS app rebuilding from scratch in Swift/SwiftUI (`apps/ios/` — Mac session). New feature decisions: OAuth-only login (Spotify recommended, Apple, Google — no email/password), simplified onboarding (name + username + rating mode + notifications; Google adds genre step), Essentials feature removed from entire app, Instinct rating mode added (pairwise comparison / Elo). See `WEB_PARITY.md` for full spec of changes to mirror on web. Two parallel tracks: Mac builds iOS app; Windows builds Elo system, DB migrations, `/api/rate/compare` endpoint, removes essentials from web, updates Spotify OAuth scopes. **2026-06-17 (session 3, Windows):** all 5 web-prep tasks built — Instinct migration (`20260617000000`, ⏳ apply via SQL editor), `lib/elo.ts`, `/api/rate/compare`, essentials removed (ProfilePanel + AlbumActions + onboarding `StepAlbums`; `Essentials.tsx`/`Pick5Modal.tsx` deleted; `pinned_albums` left unused), Spotify login scopes (`user-top-read` + `user-read-recently-played`). Typecheck clean. Remaining web parity (onboarding rewrite, Instinct album-page UI, `/rate` session, settings toggle, i18n) still open — see START HERE. **2026-06-18 (iOS tab screens):** All 5 tab screens built — `HomeView` (parallel genre carousels from `recommendable_releases`, `withTaskGroup`), `SearchView` (debounced search with 3-column grid), `RankingsView` (ranking categories list), `ActivityView` (global ratings feed with cover + score + timestamp), `ProfileView` (stats, rating mode badge, 3-column grid with score overlay, sign out). Shared: `AlbumCard` component, `Release` + `RankingCategory` models, `Date.relativeTimeString` helper. Simulator still blocked on 8GB RAM — use Xcode Previews (`#Preview` on each screen) to test without the full simulator. **2026-06-18 (session 2 — album detail + physical device):** `AlbumDetailView` built — full-width cover hero, title/artist/release type chip/year, community stats (avg ★ + count), half-star rating widget (tap to rate, tap same to clear, writes to `ratings` via upsert), tracklist section (from `tracklist` JSONB column — fetched separately on detail load, MM:SS duration). `TrackItem` model + `StarRatingView` component added. `Release` extended with `Hashable`, `tracklist`, `totalTracks`. `NavigationLink(value:)` wired into every tappable card: `HomeView` carousels, `SearchView` grid, `ProfileView` ratings grid, `ActivityView` list rows. Debug build config updated to `CODE_SIGN_STYLE = Automatic`, team `GGJ5HX3A4M` — app can now be deployed to a physical iPhone via Xcode. **2026-06-18 (iOS session 3 — UI polish + dark mode):** Auth screen polished — two oversized decorative flowers (top-right 140% screen width / bottom-left 100%, opacity 0.09, cut at physical screen edges via `ignoresSafeArea`), legal text pinned to bottom in a separate ZStack layer, slogan rendered as `Color.sjInk.opacity(0.6)`. Onboarding redesigned: 4 single-question screens (What's your name? / Create a username. / Select a rating style. / Turn on notifications.), auto-keyboard via `@FocusState` + `.onAppear`, OAuth provider name pre-filled in name field (reads `full_name` / `name` from Supabase `userMetadata`). Tab bar restructured: Search tab renamed to **Add**, Activity tab renamed to **Feed**, order changed to Home · Rankings · Add · Feed · Profile, all ViewModels hoisted to `MainTabView` as `@State` to prevent tab-switch reloads, `hasLoaded` guard in each ViewModel's `load()`. Full-screen `AppLoadingView` (flower + wordmark + `ProgressView`) replaces in-Home spinner. Dark mode: 5 adaptive color assets (`sjCream/sjInk/sjMuted/sjBorder/sjSurface` — light + dark variants in `Assets.xcassets`), `@AppStorage("appearanceMode")` + `.preferredColorScheme()` at app root, Appearance submenu in Profile `···` menu (System / Light / Dark + checkmarks). All `Color.white` → `Color.sjSurface`. Build errors fixed: removed duplicate adaptive color declarations from `Theme.swift` (Xcode 15+ auto-generates them from `.colorset` assets); fixed `providerName` reference removed from `OnboardingView.finish()`.

### ► START HERE — next session checklist

> **⚑ DATA-FIX TRACK (started 2026-06-30):** A data review found 6 catalog/UX gaps → 5 work items.
> Windows code is **all built + typecheck-clean** (committed); iOS hand-off in [`DATA_FIXES_IOS.md`](DATA_FIXES_IOS.md).
> Items: **A** artist identity via new `release_group_artists` join table (collab albums under both artists +
> Kanye/Ye split), **B** search normalization ("new jeans"/"sikk"/"Sik-K"), **C** cover backfill (was 29.5% null),
> **D** queue missing artists by MBID, **E** artist avatars (was 0/2641).
>
> **▶ TO ACTIVATE (do in this order):**
> 1. **Apply 2 migrations** in Supabase SQL editor: `20260630000000_search_normalize.sql` (B), then
>    `20260630000001_release_group_artists.sql` (A).
> 2. **Deploy web** — only AFTER step 1's search migration (the repointed `lib/dbCache` calls the new RPCs;
>    before the migration it degrades to empty results).
> 3. **Restart the pipeline** (`npm run pipeline`) to load the `mbid` ingest source (D) + the credit write-path (A).
> 4. **After the restart:** `npm run seed:missing` (D — queues ZICO/Paloalto/Don Toliver/ksmartboi/OKASHII/JMIN/
>    BewhY/YANGHONGWON by MBID, ingested next). `lov3rboi` isn't in MB → Deezer fallback later.
> 5. **During a pipeline pause** (MB-contending, ~2h): `npm run backfill:rg-credits` (A — backfills collab credits
>    for existing groups; single-artist groups need none).
> 6. **Already run this session (background):** `npm run covers:caa` (C — CAA release-group covers, ~50% of the
>    5,600 album/EP gaps filled incl. NewJeans *Get Up*) and `npm run backfill:avatars` (E — Deezer avatars, ~88% match).
>    Re-runnable/resumable; `npm run covers:caa -- --all` extends C to the ~16k single gaps.
>
> **iOS (Mac):** build per [`DATA_FIXES_IOS.md`](DATA_FIXES_IOS.md) — RPC contracts `search_release_groups` /
> `search_artists` / `get_artist_release_groups` / `get_release_group_credits` go live once step 1 is applied.
>
> **⚑ WEB RECONSTRUCTION SHIPPED (2026-07-06, Windows):** `apps/web` was rebuilt from scratch around the
> current schema (`release_groups`/`recordings`) and the current iOS product — new IA (Home feed · Charts ·
> Search/Add · Taste · Profile), OAuth-only login, iOS-style onboarding, Manual + Instinct rating for albums
> AND songs, mixes, charts w/ unlock gates + Silla ranking, Taste reel, blue `#2979B7` theme + near-black dark
> mode, full en/ko. Old leaderboard/tierlist/essentials-era pages and components deleted; all API routes kept.
> Build/lint/tests clean. **⏳ Not yet deployed to Vercel** — deploy when ready (the old blocker was the
> `20260630000000` search migration; it should already be applied — verify). Follow-ups in SESSIONS.md
> (2026-07-06 web entry): `supabase gen types` replacement for `lib/db/types.ts`, SSR/SEO pass, avatar upload,
> Spotify discovery rows on web, delete stale `packages/shared`. **Merge note:** this landed in parallel with
> the Mac's session-4 push (quests/referrals, Connected Accounts, mix social, username hardening, visibility
> overhaul) — web parity for those new iOS features (quest checklist, referral UI beyond `/i/[code]`, mix
> social posts, visibility RPC enforcement) is now the top open web item; username format IS already unified
> (web onboarding uses the shared `lib/username.ts`).
>
> **⚑ NEXT SESSION — PICK UP HERE (session left off 2026-07-06, Mac, session 4):**
>
> **Mix social features shipped (iOS only, web deferred by design — user explicitly scoped this out since web has zero Mixes UI today).** Mixes are now likeable, shareable as feed posts (caption + stacked-cover art), and `MixDetailView` has a real hero (bio/description, like, share, owner-only edit). Migration `20260706000015_mix_social.sql` — **applied**: adds `mixes.description`, `mix_likes`, `mix_shares`, `mix_share_likes`, `mix_share_comments`, 3 new notification types + triggers, `get_mix_covers` RPC, rebuilds `get_profile_mixes`. Mix-share posts merge into the Home feed alongside rating posts via a new `FeedPost` enum (Explore: ranked together with the existing algorithm; Following: recency-sorted). New files: `EditMixView.swift`, `MixShareComposerView.swift`, `MixShareCard.swift` (+ its own likers/comment sheets), `Components/StackedCoversView.swift`. **Report/abuse flow deliberately deferred** for mix-share posts (only Block offered in v1, not Report — `ReportSheet` is `private` to `HomeView.swift` and hardcodes `ratingId`; widening it + a `reports.mix_share_id` column is a small fast-follow, not done).
> - ⚠️ **Found + fixed mid-session: a 133GB Xcode RAM blowup.** Root cause: a `switch` with two multi-argument view initializers written *inline* inside a `ForEach`/`LazyVStack`/`ScrollView` closure (`HomeView.swift`'s `feedList`) — a known Swift type-checker explosion trigger (runaway memory instead of a fast error). Fixed by extracting into named `postCard`/`ratingCard`/`mixShareCard` functions — named function bodies type-check independently instead of blowing up as one giant nested expression. **Worth remembering if this happens again**: kill `swift-frontend` in Activity Monitor (not the whole Mac), then look for this exact shape (heterogeneous switch/if-else branches with many-arg initializers inline in a ViewBuilder closure) in whatever was just edited.
> - ✅ Username format also tightened this session (`20260706000014_username_format_constraint.sql`) — 3–20 chars, `[a-z0-9_]` only, now consistent across web onboarding/settings/`check-username` API and iOS onboarding/edit-profile (previously only one of six entry points validated this at all — web settings and both iOS paths had zero validation). Truncation/`lineLimit` guards added to ~9 UI spots (web + iOS) that could overflow on a long/legacy username, plus an OG-image truncation fallback. **✅ Migration applied** (confirmed, along with `20260706000015`).
> - ✅ Two small bug fixes, both live-tested: the public-mix link on the album page now opens the mix itself (was linking to the mix creator's profile instead); Profile feed's like-count number now opens the likers modal (was dead — only Home's feed card had this wired), fixed once for both your own Profile and other users' profiles since they share `ProfilePostCard`.
>
> **Not yet live-tested, still open (this session):**
> 1. Rebuild in Xcode and re-verify the full share flow end-to-end: compose (covers should now populate, modal should be a snug `.medium` sheet not full-screen) → post (should succeed now the migration is applied) → appears in Home feed mixed with rating posts → like/comment on the mix-share post → notification fires for the mix owner.
> 2. Re-verify mix-like (heart on the hero) actually persists — it was reverting instantly before the migration was applied; root cause presumed fixed but not re-confirmed live since.
> 3. Confirm the Edit button (now text "Edit"/편집, was an unlabeled ellipsis icon) opens `EditMixView` and rename/description/public-toggle/delete all work.
> 4. Confirm the "Shared by" row appears under a mix's hero once it's been shared at least once.
>
> **Also still open from session 3:**
> 1. Rebuild in Xcode — confirm the profile-visibility compiler-crash fix actually resolved it (never re-confirmed after session 3 ended).
> 2. Click through: general Public/Private toggle, an Advanced override, viewing another account as a non-follower then after following (each subtab should lock/unlock correctly), someone else's public Mix (openable, not editable).
>
> **Also still open from session 2:**
> 1. Click through the **Settings → Connected Accounts** screen (link a second provider, disconnect one, disconnect/reconnect phone).
> 2. Universal Links tap-through on a device that already has the app installed (tap a real `sillajuku.com/i/<code>` link).
> 3. Clipboard handoff on a genuinely fresh install (needs a device/simulator without the app, or reset `UserDefaults`'s `hasCheckedReferralClipboard` key).
> 4. 5-verified-invite custom app icon unlock — needs real invite volume to actually reach.
>
> **What was built 2026-07-06 (Mac, session 1 — score badge polish, Instagram share feature, Rankings/Charts collective unlock gate):**
> - ✅ **Instagram Story share feature shipped, minus one external dependency.** `ScoreBadge` (Liquid Glass circle + score-adaptive spectrum ring, `Components/ScoreBadge.swift`) is live in `HomeView`'s `FeedCard` and `ProfileView`'s `ProfilePostCard`. Share flow (`ShareCardView`, `InstagramShare`, `SharePreviewSheet`) opens a real preview sheet — cover + Save to Photos + More Options all verified working on-device. **"Share to Instagram Story" is correctly greyed out** — Instagram hard-requires a registered Facebook App ID (`source_application`) to accept a Stories share at all, confirmed by the actual rejection error on-device, not guessed. User hit a signup blocker creating the Facebook Developer account — **deferred, not abandoned**. To resume: create a free app at developers.facebook.com (My Apps → Create App, no Business verification needed), add iOS platform with bundle ID `com.sillajuku.app`, drop the App ID into `Config.instagramFacebookAppID` (currently `nil`) — that one line is the entire remaining step.
> - ✅ **Rankings/Charts collective unlock gate built and live.** Charts stays locked (new `RankingsLockedView`, per-mode — Albums/Songs unlock independently) behind a single visible gauge (`X / target ratings`) per content type. Real thresholds, not guessed: **albums unlock at 10,000 total rating events AND 350 prestige-pool albums with ≥3 ratings** (currently 8,057 / 213 — genuine progress left, not already crossed); **songs at 2,500 events, no coverage condition yet** (only 5 rows in `track_ratings` — deliberately deferred pending real seeding data, same as the album number needed real data to get right). The coverage condition is enforced server-side only (`get_rankings_unlock_status` RPC, migration `20260706000000_rankings_unlock_gate.sql`, **already applied**) and never surfaces in the UI — user explicitly asked for a single simple number, not two. Full Korean localization added.
> - ✅ **DONE (Windows 2026-07-06):** the coverage-first seeding fix — `scripts/topup-prestige-coverage.ts` seeded low-coverage prestige albums first, +2,195 ratings → **`album_unlocked: true`** (events 10,252 / coverage 747). See the Windows 07-06 entry below.
> - ✅ **RESOLVED (Windows 2026-07-06):** the Rihanna mis-tag was already fixed on the live DB — `native_language=null`, "리아나" correctly in `name_phonetic_ko` (not `name_native`). Broader check: **0** ko/ja-tagged artists now have a contradicting country (Taylor-Swift-class bug fully cleared); the null-country cohort all have legit Hangul native names.
> - ✅ Several smaller live-tested fixes this session: Following/Followers count bug (iOS `ProfileViewModel` race), `ProfilePostCard` brought to full visual + functional parity with `FeedCard` (sizes, fonts, corner radius, working heart/comment, icon weight/color), Profile → Songs not appearing (missing `elo_score` fallback + wrong instinct-count source), Charts pulse card + Add-tab icon both fixed for dark mode (were using hardcoded literal colors / a static non-adaptive image).
> - **Build note:** one real compile error hit and fixed this session — `UIImage(dynamicProvider:)` doesn't exist (that's `UIColor`-only); replaced with two static images picked via `@Environment(\.colorScheme)`. Everything above has now been through a real Xcode build + on-device click-through, not just written — first time this whole thread's work has been verified rather than just shipped on faith.
>
> **What was built 2026-07-06 (Windows — merged Mac push + unlocked the Albums chart gate):**
> - ✅ Merged the Mac's unlock-gate push (`672eae4`: score badge, Instagram share, Rankings gate) into the local bot commits (only conflict was SESSIONS ordering; migration `20260706000000` was already applied Mac-side).
> - ✅ **Executed the Mac's flagged coverage action item.** Gate (`get_rankings_unlock_status`) needs 10,000 album events **AND** 350 prestige albums with ≥3 ratings; was **8,057 / 213 → locked**. New **`scripts/topup-prestige-coverage.ts`** walks the prestige pool coverage-first (0-rated first), tops each to 3–6 ratings from origin-matched bots (quality-anchored, language-matched reviews), idempotent/dry-runnable. **+2,195 ratings → events 10,252, coverage 747 → `album_unlocked: true`** (verified live). Songs stay locked (5/2,500 — Mac's deliberate deferral).
> - ✅ Resolved the Rihanna native_language flag (already correct on live DB) + confirmed the ko/ja mis-tag class is fully cleared.
>
> **What was built 2026-07-05 (Windows — bot community-density pass):**
> - ✅ **Made the app read as an active community, not just high-volume.** A data review found the pilot looked busy in the feed but every *album page* was empty (2,106 ratings but 1,110 albums rated exactly once, max 7; **1 review** app-wide; 18 real-human ratings). Fixed by **concentrating** bot ratings onto a **shared critic-canon** (`get_critics_picks`: ko=86 / ja=14 / western≤280) via a new canon-core-plus-discovery-tail sampler, and adding **`scripts/data/bot-reviews.ts`** — persona-voiced, **language-matched** reviews (Korean bots→Korean, JP→Japanese, western→English). Scaled roster **26→150**, deleted old spread ratings, regenerated.
> - **Result:** album ratings **8,057**; reviews **1,425**; albums with ≥5 ratings **457** / ≥10 **254** / ≥20 **50**; **Korean canon 84/86 rated, avg ~18.8 each**. `get_charts_top_rated` (Bayesian min-3) full.
> - ✅ **Bot SOCIAL pass done** — `scripts/generate-bot-social.ts` (**bot-on-bot only**, taste-biased): **842 follows / 850 likes / 55 language-matched comments**. Feed engagement no longer 0/0 (774 posts have ≥1 like; every bot has a follower). Every insert fires a notification→pg_net→APNs push webhook, so kept strictly bot-on-bot; leak-checked **0** real-user targets (the 17 real users got no fake notifications). Committed.
>
> **What was built 2026-07-05 (Windows — data health, native_language mis-tag fix, bot population):**
> - ✅ **native_language mis-tag fix (261)** — the old Wikipedia-langlink native-name backfill had written the Korean/Japanese *phonetic* rendering of non-native artists into `name_native` + set `native_language='ko'/'ja'` (Taylor Swift was "Korean"). `scripts/fix-native-language-mistags.ts` corrected 261 via the `country` signal; ko ones' phonetic moved to `name_phonetic_ko`. Improves native-name display + search app-wide.
> - ✅ **Critic-signal infrastructure (honest, day-one-populated).** `external_scores` cleanly splits **critical** (serious-listener taste, incl. respected K-pop like f(x) *4 Walls*) from **commercial** (idol/sales); `prestige_score` blends both. New: `scripts/data/external-score-sources.ts` (classification), `20260705000006_critic_affiliation.sql` (**Artist Halo** view — 4.3× Korean pool 87→371; direct=1146, halo=12,319), `20260705000007_critics_picks.sql` (`get_critics_picks` RPC → "Critics' Picks" / "Korean Critics' Canon", shown *as* critic signal), `scripts/backfill-external-score-links.ts` (recovered unlinked critic entries; critical links now **1,459**). ⏳ UI not wired (RPC ready).
> - ✅ **Data health / cleanup:** deleted 894 orphan `tracks_done` artists; confirmed the "77k multi-canonical" QC warning is a paging-race false positive; documented that Micro's Disk-IO burst budget only refills on the **daily reset** (draining the queue doesn't). `20260705000005` also makes `get_charts_top_rated` **Bayesian (min-3)** so 1–2 ratings can't top a chart.
>
> **What was built 2026-07-03 (Mac — new dev machine setup + operational readiness audit + "Start Here" fixes):**
> - ✅ **New Mac onboarding** — `apps/web/.env.local` created, `npm install` run, Xcode CLI tools pointed at `Xcode.app` (was defaulting to Command Line Tools), Apple ID signed in for team `GGJ5HX3A4M` provisioning, iOS 26.5 simulator runtime installed (first attempt via `xcodebuild -downloadPlatform iOS -exportPath` only exported a disk image without registering it — reinstalled without `-exportPath`, verified by actually booting a device).
> - ✅ **Terms of Service link in Settings** — new "Legal" section in `SettingsView.swift`, links to the existing web `/terms` page via `Config.webBaseURL` (the canonical `www` domain, avoiding the redirect header-stripping issue fixed 2026-07-01). No legal text duplicated in Swift — web page is the source of truth.
> - ✅ **Full operational-readiness audit** — read across `apps/web`, `apps/ios`, `supabase/migrations`, `scripts/`, and root docs; 23 findings ranked by severity (2 critical, 7 high, 8 medium, 6 low) plus a "what's already solid" list. Top 5 ("Start Here") picked for immediate fix — all 5 built this session:
>   1. ✅ **Help page contact form now actually sends somewhere** — was only flipping a local React state flag. New `contact_submissions` table (migration `20260703000000`) + `/api/help` route (rate-limited) + wired `help/page.tsx`. DB-only for now (no email service); review via `/admin/reports`.
>   2. ✅ **Terms of Service fixed** — §5 "Music Data" no longer says "sourced from Spotify" (stale — Spotify was retired from data collection months ago); now correctly names MusicBrainz/CAA/iTunes/Deezer/Last.fm with non-affiliation disclaimers. New §8 **Copyright / DMCA takedown process** added (notice requirements + repeat-infringer policy), Contact renumbered to §9.
>   3. ✅ **Sentry wired on web** — `sentry.{client,server,edge}.config.ts`, `next.config.mjs` wrapped with `withSentryConfig`, CSP allowlists Sentry's ingest hosts. Fully inert (no-op) until `NEXT_PUBLIC_SENTRY_DSN` is set in `.env.local`/Vercel — **⏳ needs a Sentry account + DSN to actually activate**. iOS Sentry **not yet done** — needs `sentry-cocoa` added via Xcode's Add Package Dependencies (can't safely hand-edit `project.pbxproj` for SPM refs) before the init code can be wired.
>   4. ✅ **Report/Block shipped on web** — new `ReportBlockMenu.tsx` component (mirrors the reason categories already used in iOS's `ReportSheet`: Spam/Inappropriate Content/Harassment/Other), wired into the Activity feed (per-post kebab menu) and `ProfilePanel` (next to Follow). Blocking filters that user out of the feed client-side, same pattern as iOS. `/api/activity` now selects rating/review `id` so reports can reference the specific post.
>   5. ✅ **Admin moderation queue** — `/admin/reports` (not linked from any nav — bookmark the URL), password-gated by the existing `SEED_SECRET` (same convention as the `admin/seed-*` routes). Lists open/reviewed/actioned/dismissed reports and Help-page submissions side by side, with one-click status changes. Migration `20260703000001` adds the `status` column `reports` was missing.
>   6. ✅ **Push notification delivery pipeline built** — the DB already created `notifications` rows and iOS already registered `push_token`, but nothing ever called Apple's push service. Migration `20260703000002` (+ `20260703000003` fix, see below) adds a `pg_net`-based trigger on `notifications` INSERT → `/api/push/send-webhook` → `lib/apns.ts` (`apn` package) → APNs.
> - **Also fixed in passing:** `SEED_SECRET` was used by 3 existing routes but missing from `.env.example` — added, along with all new vars (Sentry, push/APNs) — see `.env.example` for the full current list.
> - ✅ **Push notifications fully activated** — all 4 migrations applied (the 4th, `20260703000003_push_webhook_config_table.sql`, fixes a `permission denied` on `ALTER DATABASE` — hosted Supabase doesn't allow that, replaced with a plain `_app_config` table). Real APNs key sourced (Key ID `48KQZ5RRNK`, already existed from 2026-06-30) and verified working via a constructed `apn.Provider`.
> - ✅ **Sentry fully activated on both platforms** — web + iOS accounts created, both DSNs wired, both verified live (a real test event on each landed in the Sentry dashboard, iOS's even caught a genuine pre-existing bug — see below).
> - ⚠️ **Found via Sentry (not yet investigated):** `get_charts_most_rated` RPC returns HTTP 500 intermittently — caught by Sentry's automatic HTTP instrumentation on a normal iOS app launch. Flagged, not fixed — out of scope for the Sentry-setup work itself.
> - ⏳ **Still open:** add the Sentry/push env vars to Vercel for production (`.env.local` only covers local dev — the full var list is in `.env.example`).
>
> **What was built 2026-07-03 (Mac — iOS localization, en/ko, all 24 files):**
> - ✅ **Full iOS en/ko localization** — web has had this for a while; iOS had zero (everything hardcoded English), a real gap for a Korea-first product. `Localizable.xcstrings` String Catalog + Korean added as a project language. 305 catalog keys, reusing web's `ko.ts` glossary wherever terms overlap for cross-platform consistency.
> - Went well past copy-pasting translations — most of the actual work was finding and fixing Swift patterns that don't auto-localize even with a String Catalog present: reusable-view `String` params that needed retyping to `LocalizedStringKey` (6+ helper functions across files), enum `rawValue`s displayed directly (fixed via runtime `LocalizedStringKey`/`String.LocalizationValue` lookups), and 7 separate copies of a `?? "someone"` username-fallback pattern spread across the codebase. `Release.typeLabel` (one shared computed property returning "Album"/"EP"/"Single") was a single high-leverage fix that cascaded correctly to nearly every screen already using it.
> - **Deliberately left in English:** `RankingsView`'s genre/country filter chip labels — those values double as the actual backend filter parameter, so translating the display would've meant restructuring the filter logic too; a scoped trade-off, not an oversight.
> - Xcode's own build-time string extraction caught things the manual pass missed (a stray raw interpolation in `RankingsView.swift`, a few literal misses) — reconciled via a Python script operating on the `.xcstrings` JSON directly, since Xcode's own rebuild had reformatted the file. Two full-app builds succeeded. **Not yet visually verified with the simulator actually set to Korean — do that first next session** before considering this fully done.
>
> **What was built 2026-07-03 (Windows — Korean phonetic search + native-title source research):**
> - ✅ **Korean phonetic search (`드레이크`→Drake) — infra built.** New `artists.name_phonetic_ko` column (a *separate* column, deliberately not overloading `name_native`, per the handoff — `name_native` = an artist's actual native identity, `name_phonetic_ko` = the searchable Korean spelling of a non-Korean artist). Migration `20260703000006_artist_phonetic_ko.sql` adds the column + trigram index and rebuilds `search_artists` to match/rank it (RETURN signature unchanged → no iOS/web client changes). Backfill `scripts/backfill-phonetic-ko.ts` (`npm run backfill:phonetic-ko`) sources the rendering from Korean Wikipedia interlanguage links — public API, no scraping. **✅ Complete** — migration applied, backfill run: **3,566 artists** populated. Verified live via the `search_artists` RPC: 드레이크→Drake (outranks Drake Bell via exact-vs-prefix scoring), 라디오헤드→Radiohead, 위켄드→The Weeknd, 켄드릭 라마→Kendrick Lamar, 빌리 아일리시→Billie Eilish, 아리아나 그란데→Ariana Grande. Conservative (returns no-match rather than a wrong guess on ambiguous pages like Nirvana/YOASOBI). ~16% of non-Korean artists filled — the famous ones Koreans actually search; the obscure long tail has no Korean Wikipedia article. **One-shot** — artists ingested *after* this run won't auto-get a phonetic (future: populate `name_phonetic_ko` in `mb-ingest`). Also fixed a nested-paren `stripDisambig` bug that wrote one dirty value before being caught + reverted.
> - ✅ **Korean native album titles — precision backfill from Wikipedia (Deezer built but held).** The Korean streaming platforms (Melon/Bugs/Genie/Vibe) *all* `Disallow: /` for general crawlers in robots.txt — so no scraping. Instead: `scripts/backfill-native-titles-wiki.ts` (`npm run backfill:native-titles`) sources Korean album titles from EN Wikipedia `ko` langlinks with **three stacked guards** (exact title match, artist-category match, Hangul-only) so a wrong title can never be written ("A Flower Bookmark"→꽃갈피; "Palette"/"Love poem" correctly skipped as genuinely-Latin). A Deezer tier (`backfill-native-titles-deezer.ts`) was built with sound artist-scoped guards but **held un-run** — a dry-run showed ~0.2% yield and dirty title strings (e.g. "쏘리 쏘리 SORRY, SORRY - The 3rd Album"), failing the no-erroneous-data bar. **Key finding:** the raw "6,464 / 7,425 (87%) missing `native_title`" *overstates* the gap — most of those nulls are albums with legitimately **Latin** official titles (IU's Palette/LILAC/Love poem) that should stay Latin; the genuinely-Korean-titled ones were largely already captured at ingest (꽃갈피 stored in Korean). Wikipedia fills only the true residual, all verified.
>
> **What was built 2026-07-03 (Mac — Korean-quality pass + native-name root-cause fix):**
> - ✅ **Live Korean-simulator testing** surfaced 5 issues: awkward phrasings + missing translations (fixed, catalog 305→331 keys), the Taste page reading as machine-translated (rewritten), Korean search not matching international artists (confirmed a **data gap**, not a code bug — no Korean phonetic data stored for non-Korean artists, e.g. no "드레이크"→Drake — not yet backfilled), and release titles not in Korean at all (**data gap**, no source found yet for K-pop Korean titles specifically — iTunes/MusicBrainz don't have them).
> - ✅ **Native-name data wired into iOS display** (previously every screen passed `nil` regardless of DB content) — `Release.swift` gained `isPredominantlyHangul` (>50% Hangul-range Unicode scalars) so `displayTitle`/`displayArtist` only show the native value when it's actually native script. `HomeView`/`ProfileView` queries extended to fetch `native_title` + joined `artists.name_native`. **Not yet wired:** `SearchView`, `RankingsView`/charts, `MixLibraryView`, `TasteView`, `ActivityView`, `NotificationsView` — all read from RPCs that don't select the native-name join at all; a separate backend task.
> - ✅ **Root-cause + data-correction: wrong Korean artist names** (user caught E SENS showing his birth name "강민호" instead of no native name). Bug was in `scripts/mb-ingest.ts`'s `pickNative()` — grabbed *any* CJK alias when none was flagged primary, including unrelated birth/legal names. Fixed going forward (only trust a flagged-primary alias, else null). Correcting existing bad rows took 3 rounds of heuristic hardening in new `scripts/fix-bad-native-names.ts` (each round caught by spot-checking specific artists — see SESSIONS.md for the full trace: ENHYPEN, Lily Chou‐Chou, Korean-idol Hangul mononyms like 가은/윤상/지민, aiko). **Applied for real:** 626 corrections across 19,461 artists with alias data, spot-verified in production. **One known residual case** (`郭靜`→`郭伯瑜`) is an upstream MusicBrainz curation error (real name flagged `primary_for_locale: true` in their own data), not fixable by this script without cross-referencing an external source.
>
> **What was built 2026-07-03 (Mac — native-name display extended to the rest of iOS):**
> - ✅ **All remaining screens wired**: `SearchView` (artist rows + album results via `search_release_groups`), `RankingsView`/Charts (8 chart RPCs + `get_silla_leaderboard`, ~13 Text call sites across 7 bespoke decode structs), `MixLibraryView`, `TasteView`, `NotificationsView`, plus a bonus fix in `ProfileView`'s song-ratings tab. New migration `20260703000004_native_names_charts_taste_activity.sql` adds `native_title`/joined `artists.name_native` to every RPC that returns title/artist, following the same `HomeView`/`ProfileView` pattern established earlier this session.
> - ✅ **Rebuilt `get_user_genre_standings`** — TasteView's "Genre DNA" card RPC was dropped during the schema renovation (`20260624000001`) and never recreated; the card has been silently absent for every user since. Rebuilt on the current schema (`ratings.release_group_id`, `release_groups.genres text[]`) in the same migration.
> - ✅ **Fixed `ActivityView`'s query**, which was querying a stale `releases(...)` embed off a FK the renovation removed (confirmed broken via a live query, not just suspected) — also found and fixed a second latent bug in the same query (`profiles` embed ambiguous between two FK paths, needed an explicit `!ratings_user_id_fkey` hint). **Update:** confirmed `ActivityView` was never wired into any tab (`MainTabView` only has Home/Charts/Add/Taste/Profile) and is functionally redundant with `HomeView`'s Explore tab (same `ratings` feed query, same shape) — it was leftover from before the tab bar consolidated Activity/Feed into Home. **Deleted** rather than left dormant; its one genuinely shared piece, `Date.relativeTimeString`, was moved to a new `Models/DateFormatting.swift` (5 other files depended on it).
> - ✅ **Found the real root cause of the intermittent `get_charts_most_rated` 500** (flagged by Sentry a while back): not a bug in that RPC specifically — the schema renovation dropped `ratings.release_id`/`track_ratings.release_id` (and their indexes) in favor of `release_group_id`/`recording_id`, but never created replacement indexes. Every chart/leaderboard RPC joins on these columns with no supporting index; the only indexes present are on `(user_id, release_group_id)`/`(user_id, recording_id)`, useless for a query that doesn't also filter by `user_id`. New migration `20260703000007_ratings_release_group_index.sql` adds both — should reduce timeout risk across every chart RPC, not just the one that got flagged.
> - ✅ **Found and fixed a second, unrelated bug while verifying**: `get_charts_top_rated_songs`/`get_charts_most_rated_songs` timed out under the `anon` role (not a permissions issue — a pre-existing `DISTINCT ON` subquery in the song-chart RPCs sorts the *entire* `release_tracks`⋈`releases` join because its sort key spans both tables, so no index on either table alone can help). New migration `20260703000005_song_charts_lateral_fix.sql` rewrites the lookup as a `LATERAL` join scoped to only the (small) set of already-rated recordings, cutting it from an O(catalog size) sort to O(rated recordings) indexed lookups.
> - ✅ **Verified live in the Korean-locale simulator** (not just build success) — artist search rows, album search results, and the Charts trending/most-rated sections all correctly show native names (에스파, 에이티즈, 마마무, 엔시티 127) while non-Korean-native artists (E SENS, Drake, NewJeans) correctly stay Latin. Taste/Notifications/Mix Library couldn't be visually exercised (no test data on the logged-in account) but are code+RPC verified.
> - ✅ Both migrations applied and reverified live: `20260703000005` (song-chart timeout fix, confirmed <500ms under anon) and `20260703000007` (chart-RPC index fix — renumbered from a same-day `000006` collision with Windows's own phonetic-search migration).
>
> **What was built 2026-07-04 (Mac — working the operational-readiness audit's remaining 16 findings):**
> - ✅ **Terms of Service**: added a Governing Law clause (Republic of Korea) — the deployment checklist had this checked off as done for months without the actual clause existing.
> - ✅ **Privacy Policy**: added GDPR (lawful bases, EU user rights, supervisory-authority complaint right) and CCPA (right to know/delete, no-sale confirmation) sections; also fixed the same stale "Spotify" data-source reference the Terms page already had fixed, missed here at the time. Cookie section now states explicitly that only strictly-necessary functional cookies are used, which is why no consent banner is shown (not a gap — that class of cookie doesn't require one under GDPR/ePrivacy).
> - ✅ **`SECURITY.md`** added — responsible-disclosure contact and process, none existed before.
> - ✅ **README's migration-workflow claim corrected** — it said "Supabase CLI migrations, no manual SQL editor needed," which hasn't reflected actual practice for a long time (this Mac environment isn't even `supabase link`ed). Rewritten to say what's actually true.
> - ✅ **Basic CI added** (`.github/workflows/ci.yml`) — web job (lint, typecheck, build on Ubuntu) + iOS job (`xcodebuild` build-only on macOS). Getting `next lint` to actually pass required first adding a missing `.eslintrc.json` (the dependency was already installed, just never configured — this is why `next lint` "couldn't run non-interactively" in earlier session notes) and fixing 6 real `react/no-unescaped-entities` errors it then surfaced across 3 files. Not yet validated by an actual CI run — commands are verified locally, but a fresh runner could still surface something local caching hid.
> - ✅ **DB backup script** (`scripts/backup-db.ts`, `npm run backup:db`) — dumps the user-generated tables (ratings, reviews, follows, lists, mixes, etc.) to a timestamped JSON file under `backups/` (gitignored). Deliberately excludes the music catalog (re-derivable from the pipeline, would be hundreds of thousands of rows for no DR benefit) and `spotify_connections` (live OAuth tokens, not content — backing up credentials is an exposure, not a safeguard). Restore is manual by design.
> - ⚠️ **Found while building the backup script: `blocked_users` was never actually created live.** It's defined in `20260625000001_report_block.sql` in the same transaction as `reports` (which does exist), so this can only mean that migration was applied partially, not that the table was dropped after. **Every block attempt on both web and iOS has been silently failing since Report/Block shipped** — reports work, blocking specifically does not. New migration `20260703000008_blocked_users_missing.sql` recreates it (`IF NOT EXISTS`, safe regardless of actual current state). **Needs to be applied.**
> - **Still open from the 23-finding audit** (deliberately not attempted this pass — each needs either a new external account/service the user would need to set up, or is a large enough scope to warrant its own dedicated session): no staging environment, no uptime/health alerting, no backup *verification* (this pass added the backup itself, not a tested restore drill), unstructured logging, deep linking/Universal Links, lifecycle/transactional email, feature flags (PostHog already supports them, just nothing uses it yet), sitemap/structured data (correctly deferred pre-launch per the audit itself).
>
> **What was built 2026-07-04 (Mac — first automated tests on both platforms):**
> - ✅ **Web: Vitest** — `lib/elo.test.ts` (31 assertions across `kFactor`, `expectedScore`, `updateElo`, `eloToScore`, `starToElo`, `deriveInstinctScores`) and `lib/sillaScore.test.ts` (`computeTierlistScores`, `combineSillaScores`), scoped deliberately to the pure, dependency-free rating math — exactly "every rating/Elo calculation... verified by hand or not at all" from the audit. Skipped `accomplishments.ts`/`rateLimit.ts` for this first pass — both are thin wrappers around Supabase/Redis calls, not pure logic, and would need real mocking infrastructure for comparatively little value. `npm run test` (`apps/web`).
> - ✅ **iOS: new `sillajukuTests` XCTest target**, added via the `xcodeproj` Ruby gem rather than hand-editing `project.pbxproj` directly — this project's own prior notes flagged raw pbxproj edits as corruption-risk (same reasoning that punted the Sentry SPM setup to Xcode's GUI earlier this session); `xcodeproj` is the same purpose-built library CocoaPods/Fastlane use for this, and the resulting diff was cleanly additive (134 lines, 0 deletions) with the existing file's structure intact. `ReleaseTests.swift` (15 tests: `isPredominantlyHangul` script-detection edge cases, `displayTitle`/`displayArtist` fallback behavior, `typeLabel`) and `DateFormattingTests.swift` (7 tests covering the minute/hour/day/week boundaries). Two tests initially failed — correctly, on my own wrong assumptions, not code bugs: one assumed `isPredominantlyHangul` would filter out a birth name stored in Hangul (it can't — it's a *script* check, not an *identity* check; that distinction is exactly why this session's E SENS data fix had to happen at the DB layer, not here), the other miscounted Latin vs. Hangul letters in a mixed test string. Fixed both tests once the mistake was clear; all 22 pass.
> - ✅ **Both wired into `.github/workflows/ci.yml`** — web job now runs `vitest run` before `next build`; iOS job switched from build-only to `xcodebuild test` (needs a concrete simulator destination, unlike the build-only generic destination) using `iPhone 16 Pro` as a reasonable default for the runner image — flagged in a workflow comment in case that simulator isn't preinstalled there.
>
> **What was built 2026-07-04 (Mac — iOS accessibility, first pass):** picked "iOS has no accessibility support" off the same audit list — confirmed zero uses of `accessibilityLabel`/`accessibilityHint` anywhere in the app beforehand. Deliberately scoped to purely additive, low-risk fixes: icon-only controls and meaningful images. **Explicitly not attempted:** a Dynamic Type / font-size overhaul — the app's layouts are tuned to fixed point sizes throughout, and blanket-converting to scalable text risks breaking many screens without dedicated per-screen testing; that's a separate, bigger, riskier follow-up.
> - ✅ Mapped via an Explore agent across all 37 Swift files: ~20 icon-only interactive controls (kebab menus, like/comment buttons, clear-search ×4, tab bars, etc.) and ~35 cover-art/avatar image sites.
> - ✅ **Icon-only controls** all gained a real `accessibilityLabel` — reusing existing nearby strings where available (`release.displayTitle`, `profile.displayName`) rather than writing fresh copy.
> - ✅ **The star-rating widget** (`AlbumDetailView.swift`'s `StarRatingView`) got a proper treatment, not just a label — the 5 individual stars are meaningless to VoiceOver navigation (half/full tap zones don't map to swipe gestures), so it's now exposed as one adjustable element with a spoken value ("3.5 out of 5 stars") and increment/decrement actions when interactive, matching how a native slider behaves.
> - ✅ **Cover-art/avatar images**: most sit directly next to a visible title/artist `Text` in the same row — adding a separate label there would just make VoiceOver repeat the same information twice, so those are marked `.accessibilityHidden(true)` instead (the more correct pattern per Apple's own guidance, not a shortcut). Real labels were only added where an image is the *sole* content with no adjacent text (e.g. the Ranking teaser's collapsed cover-only view, EditProfileView's photo picker).
> - ✅ **21 new user-facing strings** (all button/hint labels) added to `Localizable.xcstrings` with Korean translations, maintaining the same bar as the rest of the app's i18n; a few (`"Notifications"`, `"Settings"`, `"More options"`) already existed and were reused rather than duplicated.
> - ✅ Full rebuild + the `sillajukuTests` suite (22 tests) reverified clean after every batch of changes, not just at the end.
>
> **What was built 2026-07-02 (Mac iOS — UI polish, 20 items):**
> - ✅ **Rating modal size lock** — all instinct phases stay at `.fraction(0.36)` (no size jump after bucket tap).
> - ✅ **Instinct DB write deferred** — bucket tap only sets local Elo state; DB upsert happens in `continueFromPostRating()` after the full pipeline, not on first tap.
> - ✅ **Manual rating modal redesign** — `ManualRatingSheet.ratingView` + `TrackRatingSheet` redesigned to match instinct modal: horizontal header (52pt cover + title + type badge + artist), Spacers for centering, Divider, 26pt score, fits `.fraction(0.33)`. Manual drag handle removed.
> - ✅ **Tap score to re-rank/edit** — tapping the rated score pill on album page opens instinct re-rank or manual edit sheet.
> - ✅ **ManualRatingSheet back button** — "← Back" in PostRatingOptionsView returns to rating phase.
> - ✅ **"Rate this track" respects instinct mode** — `SongDetailView` accepts `ratingMode` param; routes to `InstinctTrackRatingView` in instinct mode.
> - ✅ **Type labels everywhere** — `Release.typeLabel` applied to `DiscoveryAlbumCard`, `SongRow`, instinct bucket views, both manual sheets, `PostRatingOptionsView` header.
> - ✅ **Delete confirmations** — `.confirmationDialog` before delete fires in `ProfileView` (both list + posts modes) and `AlbumDetailView`.
> - ✅ **Home feed layout** — title 17pt bold, type·artist 14pt, score to trailing, padding trimmed. Gap between Explore/Following header and first post closed (`contentMargins` top 90→52).
> - ✅ **Charts polish** — Country filter emojis removed; rank "100" no longer wraps; "See all" → "View all"; empty By Genre + Best by Year sections removed; more breathing room throughout.
> - ✅ **Dark mode near-pure black** — `sjCream` dark 0.067→0.020, `sjSurface` 0.118→0.067, `sjBorder` 0.173→0.118.
> - ✅ **Tracklist not blue** — `TrackRow` title color `sjBlue` → `sjInk`.
> - ✅ **Comment icon** — `bubble.right` → `bubble.left` (Instagram-style).
>
> **What was built 2026-07-01 (Mac iOS):**
> - ✅ **Delete account fix** — `Config.webBaseURL` → `https://www.sillajuku.com`. `authGuard.ts` uses `supabase.auth.getUser(token)`. Debug logs removed.
> - ✅ **`ratings.review_text` column** — migration `20260701000001_ratings_review_text.sql` ✅ applied.
> - ✅ **Post-rating comment + list flow** — `PostRatingOptionsView.swift` (inline comment, Add to list via MixPickerView). Instinct: `pendingReviewText` saved in `finalize()`. Normal: `ManualRatingSheet` → postRating phase. `HomeView` FeedCard shows `review_text`.
> - ✅ **Profile posts display mode** — list/posts toggle; `ProfilePostCard` (cover + score chip + review text + likes/comments/date); bulk-fetched counts.
> - ✅ **Delete ratings from profile** — long-press context menu on list rows + post cards. Optimistic local remove + DB delete.
>
> **Open — pick up next session:**
> 1. **Profile > Stats subtab (iOS)** — not yet built.
> 2. **TestFlight setup** — Apple Developer account active ($99 paid 2026-06-23). Need App ID + provisioning profile + first build upload.
> 3. **DATA-FIX TRACK activation** — Windows code built + committed; activation steps still pending (apply 2 migrations, deploy web, restart pipeline, seed:missing, backfill:rg-credits). See DATA-FIX TRACK block above.
> 4. **`npm run prestige:reconcile`** — re-run after the prestige artist ingest queue drains (timed out at 409; will be higher once stable).
>
> **What was built 2026-06-28 (session 1):** prestige system redesign (MBID-keyed `external_scores`, `release_groups.prestige_score`, `reconcile_prestige_scores()`, rebuilt `get_silla_leaderboard`); seeder rewritten to use MB search; Grammy re-seeded 360/360.
>
> **What was built 2026-06-28 (session 2 — prestige blitz):** Completed Weiv 2015–2019; seeded Golden Disc Daesang + Bonsang, MMA AOTY, Seoul Music Awards, IZM 2023. 15 sources total, 247 release_groups with prestige_score, 452 pending. RankingBlock wired to real Silla leaderboard.
>
> **What was built 2026-06-29 (session 3 — Grammy genre blitz):** 5 Grammy genre data files created + seeded (Rap, R&B, Rock, Alternative, Pop Vocal, Dance/Electronic partial). 6 new seeder cases. Windows prompt drafted for pipeline + RS500 + Pitchfork + Brit Awards.

> **Build note (Mac):** Always build from **Xcode GUI (Cmd+B)**, not `xcodebuild` CLI — the CLI has an Xcode 26 SPM dependency-ordering bug. Project: `apps/ios/sillajuku.xcodeproj`. **Physical iPhone:** Debug config now has `CODE_SIGN_STYLE = Automatic` + team `GGJ5HX3A4M` — connect iPhone via USB, select it as destination in Xcode, Cmd+R to run. (Simulator still blocked on 8 GB RAM.)

> **⚠️ AFTER macOS UPDATE (26.2 → 26.5):** 1) Open Xcode — it may prompt to install additional components, let it finish. 2) Connect iPhone via USB (phone unlocked). 3) If "Trust This Computer?" appears on the phone — tap Trust. 4) Xcode will download iOS 26.5 device support files automatically (~few minutes). 5) iPhone should then appear in the destination picker — select it and Cmd+R to run. 6) Run `cd apps/web && npm run dedup:releases` to see duplicate count (script was fixed this session — tracklist removed from bulk load).

**✅ FULL MB CATALOG PIPELINE BUILT & RUNNING + LAUNCH 5K QUEUED (2026-06-26, Windows):**

The renovation is applied and the catalog pipeline is a **single long-running orchestrator** on **MusicBrainz** (CC0, MBID identity) — *not* iTunes. Run it: **`cd apps/web && npm run pipeline`** · status: **`npm run pipeline:status`** · health: **`npm run pipeline:verify`**. (The iTunes catalog-expansion sections further down are **superseded**.)

**UPDATE 2026-06-29 (Windows):** Pipeline hardened + prestige-prioritized over several sessions — all live in committed code (5 commits, **not pushed**): **resolver** alias-aware exact-match + short-CJK guard (stops short-Korean-name false-matches like 우디→Woodie Gochild) + **special-MBID blocklist** (Various Artists / [unknown] / … can't be ingested — fixed a "Ray"→Various Artists 324k-release stall) + **`padDate` `??` partial-date fix**; **heartbeat watchdog** on the ingest lane (dual-signal beat+MB-activity → a silent hang auto-restarts). **726 modern Western prestige artists queued at priority** → catalog **~71k release_groups** (canon comp-heavy). **Genre backfill** `release_groups.genres` 52%→98% (`backfill:genres:rg` + `:rg:lastfm`). `pipeline:verify` 6/7 (lone fail = benign same-name dups: 김광석/S.E.S./Cream, each partner 0 RGs). After reboot/restart: `cd apps/web && npm run pipeline`; reconcile prestige (`npm run prestige:reconcile`) once the prestige queue drains.

**Status (end of 2026-06-27):**
- **7 lanes built + live, supervised:** INGEST · FRESHNESS · EMBEDDINGS · DISCOVER (self-feeding) · QC · GAPFILL · DEEZER (gated). A lane that throws restarts; transient network blips no longer kill the process.
- **All 5 pipeline migrations applied** (`20260626000001` attempt_count · `…0002` charts RPCs · `…0003` gapfill_checked · `…0004` ingest_priorities · `20260627000000` deezer_source).
- **Launch 5,000 queued at planned proportions** (`npm run queue:build:global -- --target=5000`): KR 1400 · West 1500 · JP 750 · CN 350 · SEA 250 · S.Asia 200 · Latin 250 · Africa 150 · Other 150 — **draining** (2026-06-27: ~20 artists/hr, ETA ~10.6d — within the 2-wk window but tight; **watch throughput** — if it holds ≤20/hr, stand up the local MB mirror).
- **`pipeline:verify` 7/7, catalog clean.** Periodic checks in [PIPELINE_CHECKS.md](PIPELINE_CHECKS.md) (daily while draining → weekly; auto-run when due per CLAUDE.md).
- **Skipped-artist recovery:** generic names → `mb-overrides`; genuinely MB-missing artists → **Deezer fallback** (`mb:deezer-fallback`, or the gated `DEEZER_FALLBACK=1` lane) — clean (one artist row, `source='deezer'`, ISRC, no shadows; guarded exact/token-set match). Validated: Gen Hoshino → 35 groups. GAPFILL **job C (iTunes skipped-artist recovery) stays DISABLED** (`GAPFILL_RECOVER_ARTISTS=1` to re-enable) — it created store-country shadow artists; covers + tracklists only.
- **Web orphan leak fixed + deployed:** `app/api/search/route.ts` no longer persists Spotify/iTunes search hits as bare `releases` (was leaking null-`release_group_id` orphans on every search); existing orphans cleaned.
- **Open (optional, non-blocking):** fill `mb-overrides` for the generic skips (H.O.T, god, Dean, GRAY, SOLE, BIBI); re-run `relink:ratings` after the 5k drains.

**Pipeline lanes** (all in [`apps/web/scripts/pipeline.ts`](apps/web/scripts/pipeline.ts)):
- **INGEST** ✅ — claim queued artist → MB resolve ([`mb-ingest.ts`](apps/web/scripts/mb-ingest.ts)) → `ingestArtist`. Composition filter `shouldIngestRG` trims to core (own album/EP/single; **drops guest features** + live/remix/dj-mix). Inline Cover Art Archive covers. Single-worker (MB ~1 req/s **per IP**), crash-resumable, MBID-idempotent.
- **INGEST + FRESHNESS** ✅ **(2026-06-26)** — the single MB worker weaves in re-polls: every `FRESHNESS_EVERY` new ingests (and whenever the queue is empty) it re-ingests an artist whose `next_check_at` has passed, picking up new releases (MBID-idempotent — also catches back-catalogued/old-dated releases a date-cutoff would miss). **Cadence tiering** (QC runs `recompute_ingest_priorities()` daily, migration `20260626000004` ✅ applied): `ingest_priority` is derived from release-recency + engagement (released ≤3mo → `hot` 1d · ≤18mo/rated → `active` 7d · catalog → `known` 30d · old+unrated → `dormant` 90d), and `next_check_at` re-derived so promotions take effect at once. Manual: `npm run mb:tiers`.
- **QC** ✅ **(2026-06-26)** — DB-only concurrent lane ([`mb-qc.ts`](apps/web/scripts/mb-qc.ts)): each cycle snapshots the mb-audit invariants (dup artists, canonical integrity, source purity, empty artists) and **auto-requeues** transiently-`failed` rows → `pending` (self-healing), capped by `attempt_count` (migration `20260626000001_queue_attempt_count.sql` ✅ applied — auto-requeue live).
- **EMBEDDINGS** ✅ — Jina v3 → `release_groups.embedding` ([`mb-enrich.ts`](apps/web/scripts/mb-enrich.ts)), runs concurrently (no MB contention).
- **GAPFILL** ✅ **(2026-06-26)** — iTunes fallback for MB's holes ([`mb-gapfill.ts`](apps/web/scripts/mb-gapfill.ts) + [`itunes-client.ts`](apps/web/scripts/itunes-client.ts)), **strictly append-only + `source='itunes'`-tagged** (never overwrites MB rows — every write is guarded `WHERE … IS NULL`). Jobs: fill null `release_groups.cover_url` + fill empty canonical tracklists (**on**); re-ingest MB-`skipped` artists from iTunes (**job C — OFF by default**, `GAPFILL_RECOVER_ARTISTS=1` to re-enable; it created store-country shadow artists that duplicated MB rows). Deliberately **slow/bounded** with a **non-fatal 403 breaker** (backs off 2h on an IP block; other lanes keep running). Standalone: `npm run mb:gapfill`. Migration `20260626000003_gapfill_checked.sql` ✅ applied. Shadow-cleanup tool: `npm run cleanup:itunes-shadows`.
- **DISCOVER** ✅ **self-feeding (2026-06-26)** — seeds the ~275 curated artists once at startup ([`seed-artists.ts`](apps/web/scripts/seed-artists.ts)), then a concurrent loop tops up the queue **when `pending` runs low** so the catalog grows over a week instead of idling. Bounded + controlled: refills toward a target, a lifetime **ceiling** on auto-discovered rows, and region-rotated **Wikipedia** ([`wikipediaTopUp`](apps/web/scripts/build-global-queue.ts)) as the counterweight to **ListenBrainz** snowball ([`listenBrainzTopUp`](apps/web/scripts/mb-discover.ts)). Hits LB+Wikipedia, **not** MB → no contention. Tuning via env: `DISCOVER_LOW_WATER` (40), `DISCOVER_TARGET` (200), `DISCOVER_CEILING` (12000), `DISCOVER_POLL_MS`. Flags: `--no-discover` (drain-only). Standalone breadth still works: `npm run mb:discover` / `npm run queue:build:global`.

**Tooling:** `npm run mb:audit` (read-only integrity), `mb:ingest:one`, `mb:embed`, `mb:requeue-overrides` (clean wrong generic-name rows; `--requeue` resets their queue rows at restart).

**⚠️ Core engine + self-feeding discovery done — remaining build order:**
1. ✅ **Self-feeding DISCOVER lane** — *done 2026-06-26* (see DISCOVER above). Activates on next `npm run pipeline` restart.
2. ✅ **iTunes GAPFILL** — *done 2026-06-26* (covers + tracklists; job C disabled — see GAPFILL lane). [`mb-overrides.ts`](apps/web/scripts/mb-overrides.ts) **5 of 8 filled** (txt→TOMORROW X TOGETHER, a pink→Apink, loco→로꼬, woo→우원재, miso→MISO — all MBID-verified). **dean / gray / kai** left as `needs_review` on purpose — their Korean artist doesn't surface in MB search even KR-filtered; resolve manually on musicbrainz.org later. ⚠️ Overrides take effect on **pipeline restart**; run `npm run mb:requeue-overrides -- --requeue` at restart to re-resolve names already mis-ingested.
3. ✅ **FRESHNESS + QC lanes + cadence tiering** — *done 2026-06-26* (migrations `…0001` + `…0004` ✅ applied). Live.
4. ✅ **Rating re-link + chart RPC rebuild** *(2026-06-26)*:
   - **Rating re-link** — [`relink-ratings.ts`](apps/web/scripts/relink-ratings.ts) (`npm run relink:ratings` dry-run · `-- --write` to upsert). Matches `backups/*_win.json` (97 album + 20 track ratings) by title+artist → `release_group_id` / `recording_id`, **idempotent + re-runnable** (handles Spotify verbose titles `NewJeans 2nd EP 'Get Up'` + collab credits). ⚠️ **Catalog still draining → ~8 matched so far; RE-RUN `npm run relink:ratings -- --write` after the pipeline finishes draining** to fill in the rest.
   - **Chart RPC rebuild** — ✅ migration `20260626000002_charts_rpcs_rebuild.sql` applied. Rebuilds all 11 charts RPCs (pulse, top/most-rated, trending, trending-for-genres, hidden-gems, controversial, user-top-genres + 3 song charts) on the new schema. **DROP-IN for iOS** (contract confirmed with Mac 2026-06-26): aliases `release_groups.id AS release_id` + `artist_display AS artist`; song charts map `recording_id` → canonical-release `position AS track_position`. No iOS change needed. Genre filter uses `release_groups.genres` text[] (hyphen-tolerant); charts surface **manual `score` only**.
   - **Still open (separate, not charts):** `get_user_genre_standings` (TasteView) + `get_calibrated_bayesian_scores` + `recommendable_releases` view were also dropped — rebuild when those consumers are migrated (need their own iOS contract).

> **Schema note (for iOS too):** a release group's artist FK is **`release_groups.primary_artist_id`** (there is no `artist_id` column). Artist→releases queries key on `primary_artist_id`.

**iOS schema (for the Swift rewrite, delivered 2026-06-26):** rate **`release_group_id`** (not release_id); songs key on **`recordings.id`** (uuid); `release_groups.release_group_type` is lowercase; artist field is **`artist_display`** (recordings too — old `artists` is gone); track loading = canonical `releases` (`is_canonical=true`) → `release_tracks` join `recordings` (no view yet); PostgREST embeds `ratings→release_groups` / `mix_items→release_groups` **auto-detect** (no FK hint). Chart song RPCs **rebuilt drop-in** (2026-06-26) — same `release_id`/`track_position` shape Swift already decodes (aliased from `release_group_id` / canonical-release position).

Rating backups saved to `backups/` (98 album ratings, 20 track ratings, gitignored).

**Mac priority order:** ✅ Report/Block wired (2026-06-25) → ✅ **All 9 Swift files updated to new DB schema (2026-06-26)** → ✅ **Silla Score leaderboard RPC + iOS wired (2026-06-27)** → ✅ **Prestige system redesigned + Grammy re-seeded 360/360 (2026-06-28)** → ✅ **Build succeeded (2026-06-28)** → ✅ **Mercury Prize + 13 Korean prestige sources seeded, 247 release_groups with prestige_score (2026-06-28)** → ✅ **RankingBlock wired to real Silla leaderboard (2026-06-28)** → ✅ **6 Grammy genre sources seeded (2026-06-29)** → ⏳ Send Windows prompt → Profile > Stats subtab → TestFlight setup.

**Windows — backend + web prep (`apps/web/`):** ✅ Instinct rating mode shipped end-to-end (2026-06-17/18). All three migrations applied to prod (see table below).
- ✅ Elo math (`lib/elo.ts`) + `/api/rate/compare`; essentials removed; Spotify OAuth scopes added.
- ✅ Album page **Add/Save** redesign (`AddModal` popup); Settings Manual/Instinct selector + 0.1 precision + single scrollable page; hard delete-account (`/api/account/delete`).
- ✅ **Instinct scoring reworked + Manual→Instinct import (2026-06-18):** display score is now an absolute sentiment-anchored Elo curve (`eloToScore`, replaces rank interpolation) so a loved library clusters high instead of smearing 0–5. Switching Manual→Instinct offers to import existing star ratings as Elo seeds (`starToElo` via `/api/rate/seed-from-manual`); imported rows drift *gradually* (K=16 via `IMPORT_GAMES=30`), fresh ratings place fast (K=40). `InstinctImportModal` (Use / Start fresh), en+ko i18n. Album-page actions on a rated album: **Re-rank** (Instinct = redo comparisons with no reseed, fixes the old history-wipe bug; Manual = change the star) + **Delete** (removes the rating + its `pairwise_comparisons`); **Add** when unrated. "Edit" reserved for comments. ⏳ **Not yet smoke-tested in the live app.**
- ⏳ **Owed:** Korean i18n for the Add modal + song UI — **proposed translations reviewed in `apps/web/i18n-review.html`** (open in a browser): buckets decided as single-line **별로 / 보통 / 좋아요** (drop the hint line); the friendlier import-modal copy is already applied; the remaining rate-modal / `StarRatingWidget` / song-page strings still need wiring into en.ts/ko.ts. Also owed: verify Spotify provider scopes in the Supabase dashboard; mirror `eloToScore`/`starToElo`/`IMPORT_GAMES` into the Swift `elo.ts` for iOS parity. (Instinct scores now feed the profile rated grid + avg/distribution/capsule via effective `score ?? eloToScore(elo_score)`; leaderboard **Silla** scoring still consumes Manual `score` only.)
- ✅ **Vercel "Fluid Active CPU" hit 75% pre-launch** — caused by open crawling of ~2.3M uncached dynamic pages (418k `/album` + ~1.9M `/song`). Added `apps/web/app/robots.ts` → `Disallow: /` (block all crawlers pre-launch). **RELAX AT LAUNCH** (allow `/` + add a sitemap). Do NOT upgrade to Pro unless the Vercel Observability breakdown shows real *user* traffic.
- ▶ **Songs as first-class:** `tracks` table + backfill ✅; song pages (`/song/[trackId]`), song ratings (Add=rate, Manual+Instinct parity — `track_ratings.elo` + `track_pairwise_comparisons` + `/api/rate/compare-song`), clickable tracklist (rightmost **Add** = rate; bookmark **Save** = collections) all ✅ shipped (SONGS_PLAN steps 1–4). `backfill:tracks --reset` ✅ (161,747 releases → ~1.95M track rows). **Remaining: SONGS_PLAN steps 5–7** (home/feed/search song sections, profile song section, score-driven song leaderboards) + iOS parity.
  - **▶ Tracklist gap (IN PROGRESS, ~29k non-singles still null):** re-diagnosed as iTunes **region-mismatch** (stored `itunes_id` resolves only in a non-US store), NOT throttling. A broad ~44-store sweep tripped iTunes' **IP-level 403 block** and collapsed yield → reverted to a **lean fallback** (GB + JP/KR/DE/BR) + a **403 circuit breaker** (`backfill-tracklists.ts`). **Resume after an IP cooldown (~1–2h):** `npm run backfill:tracklists` (lean), check gap (`select count(*) from releases where tracklist is null and release_type not ilike 'single';`), repeat across sessions; then `npx tsx --env-file=.env.local scripts/backfill-tracks.ts --reset` to expand the new tracklists. Then `queue:ingest:albums` (21,254 pending) + **HNSW rebuild** (69,795 new embeddings unindexed). Literal 100% isn't reachable via iTunes (dead ids / non-iTunes) — optional MusicBrainz/Deezer pass later. Full plan in **[SONGS_PLAN.md](SONGS_PLAN.md)**.

**Mac — iOS Swift app (`apps/ios/`) — scaffolding done, build next:**
1. ✅ Xcode project — bundle ID `com.sillajuku.app`, Supabase Swift SDK 2.48.0 via SPM, URL scheme `sillajuku://`
2. ✅ Auth flow — Spotify (recommended) + Apple (stubbed) + Google via `supabase.auth.signInWithOAuth`; auth state observer in `RootView`
3. ✅ Onboarding — profile step + rating mode picker + [genre step for Google] + notifications
4. ✅ Main tab scaffold — 5 tabs, all placeholder `Text()` views
5. ✅ BUILD SUCCEEDED — runs on iPhone 17 simulator (iOS 26.5)
6. ✅ **Logo assets added** — `logo-flower.imageset` and `logo-text.imageset` added to `Assets.xcassets` (SVGs). `AuthView.swift` updated: flower mark at top, `logo-text` wordmark below, `SpotifyIcon` (Canvas-drawn 3-bar soundwave), `GoogleGIcon` (Canvas-drawn multicolor G).
7. ✅ Tab screens built — `HomeView`, `SearchView`, `RankingsView`, `ActivityView`, `ProfileView` (2026-06-18). Real Supabase queries, genre carousels, search, activity feed, profile grid.
8. ✅ **Album detail screen** — `AlbumDetailView` (2026-06-18 session 2): cover hero, title/artist/meta, community stats, half-star rating widget (writes to `ratings` via upsert), tracklist. `NavigationLink` wired into all 4 tappable surfaces (home carousels, search grid, profile grid, activity list).
9. ✅ **Physical device** — Debug signing fixed (Automatic, team GGJ5HX3A4M). Connect iPhone via USB → select in Xcode → Cmd+R.
10. ✅ **UI polish + dark mode (2026-06-18 session 3):** AuthView decorative flowers + pinned legal text, onboarding 4-step redesign (single-question screens, auto-keyboard, provider name pre-fill), tab bar renamed + reordered + ViewModel hoisting, `AppLoadingView` loading screen, dark mode (5 color assets + app-level appearance toggle + Profile Appearance submenu), all `Color.white` → `Color.sjSurface`.
11. ✅ **Session 4 (2026-06-19):** Home tab → social feed (Explore + Following subtabs, `FeedCard`, `HomeViewModel`); Add tab → discovery mode with "For You" (personalized from user's rating history) + "Popular" sections, each split into Albums (horizontal scroll) + Songs (vertical list); active search now returns Albums and Songs in separate sections. Profile UI polish: gear icon → SettingsView, swipeable subtabs, amber underline tab bar. Edit profile (avatar, username, display name, bio). Settings page. Share profile (link + custom thumbnail). Dark mode logo. `checkOnboarded` fix. `avatar_url` DB migration created (⏳ run in SQL editor). See SESSIONS.md for full detail.
12. ✅ **Session 5 (2026-06-20):** Notification bell in `HomeView` floating header (red dot badge, push nav to `NotificationsView`). Comment system fixed (silent auth failure → error banner). PTR spinner repositioned below "Explore / Following" tabs (`.contentMargins(.top, 90)` + silent `refreshExplore()`). App icon: light/dark 1024×1024 PNG (amber flower / cream flower on dark). Feed share changed to URL (unlocks more share targets). "Save to library" renamed "Save". **Mixes** feature fully implemented: `MixLibraryView`, `MixDetailView`, `MixPickerView`, `CreateMixView`, `Mix/MixItem/MixRelease` models; default "Listen Later" mix; migration `20260620000001_mixes.sql`. **Critical bug fixed:** feed showing "No ratings yet" after `000005_fix_social_fks` created two paths from `ratings→profiles`, causing PostgREST PGRST201 (ambiguous join) swallowed by `try?` — fixed with explicit FK hints (`profiles!ratings_user_id_fkey`, `profiles!rating_likes_user_id_fkey`, `profiles!rating_comments_user_id_fkey`).
13. ✅ **Session 6 (2026-06-20):** Charts tab — renamed "Rankings" tab to **"Charts"**; rewrote `RankingsView.swift` → `ChartsView` data insight hub with Community Pulse card (total ratings, community avg, today count), Trending card (Global / For You inline toggle — For You filters by the user's top 3 genres via `get_user_top_genres` RPC, falls back to global), horizontal album scroll rows for Top Rated + Most Rated (each with podium + full ranked list drill-down), By Genre section (6 SF Symbol genre pills → `GenreDetailView` with Top Rated / Most Rated / Trending / Gems sort chips), Hidden Gems + Controversial insight cards, Best by Year horizontal decade cards. Migration `20260620000002_charts_rpcs.sql` adds 8 SECURITY DEFINER RPCs: `get_charts_pulse`, `get_charts_top_rated`, `get_charts_most_rated`, `get_charts_trending`, `get_charts_trending_for_genres`, `get_user_top_genres`, `get_charts_hidden_gems`, `get_charts_controversial`. All genre icons are SF Symbols (no emoji). Graceful degradation: all `rpc()` calls use `try?` → empty arrays if migration not yet applied.
14. ✅ **Session 7 (2026-06-21):** Bell button fixed (overlay + full-width ZStack); push notifications set up (iOS permission prompt + APNs token → `profiles.push_token`); theme color changed amber → **blue #2979B7** (`sjBlue`; `sjAmber` aliased); profile tab: username centered, tabs scroll with page, ratings use flower-icon badge, sort/filter menu, rating scale reads `manual_rating_step`, swipeable subtabs via `DragGesture`, Following/Followers merged into one swipeable modal, Mix empty state top-aligned; Charts: Top Rated removed from albums tab, Trending thumbnails enlarged; **Artist page** (`ArtistPageView`) — tapping a Spotify artist in Add tab shows their releases; Add tab: empty-space tap dismisses keyboard; Home > Following: nudge footer + **Find People page** (`FindPeopleView`, `get_suggested_users` RPC). Migrations applied: `20260621000002_push_token.sql` ✅, `20260621000003_suggested_users.sql` ✅.
15. ✅ **Sessions 8–10 (2026-06-21):** Add tab `+` button starts rating flow; album/song page redesigned (Compact Header, Option C); Instinct rating pipeline (`InstinctRatingView.swift` — bucket → pairwise comparisons → Elo update → done); song rows navigable; rated releases hidden from Add tab (`ratedReleaseIds` set, immediate removal on `+` tap); `AlbumDetailView` mode-aware (Manual: "Rate" button → `ManualRatingSheet`; Instinct: "Add to Rankings" → `InstinctRatingView`); `ManualRatingSheet` (star picker, Save/Remove).
16. ✅ **Session 11 (2026-06-21):** Profile subtabs now use `TabView(.page)` — same native swipe as Charts (removed `DragGesture`); Add tab "For You" was always empty (ILIKE `%` URL-encoding bug fixed → `.in("artist", values:)` exact match, two-step query avoids join decode failures, limits bumped to 50); album/song page: **Ratings & Reviews** section (all ratings with user handle + score badge) + **In Public Mixes** section (public mixes containing this release).
17. ✅ **Session 12 (2026-06-22):** Profile swipe fixed properly — header (`customNavBar`, `headerRow`, `nameRow`, `actionButtons`, `tabBar`) moved entirely outside `TabView`; each of the 3 subtabs has its own `ScrollView`; only content swipes, header is fixed. Add tab rated items: show blue filled checkmark instead of hiding (`isRated: Bool` added to `AlbumCard`, `DiscoveryAlbumCard`, `SongRow`; `allowsHitTesting(false)` lets tap fall through to `NavigationLink`); rated items no longer filtered out. Add tab suggestions rewired to `.in("artist", values: seeds)` exact match (removed broken OR `%wildcard%` filter where `%` URL-encoded to `%25`); songs shown all-inline, "See all" cap removed. **Spotify permanence:** root cause identified — `supabase.auth.refreshSession()` never returns `providerToken` (proven by `AuthClient.swift:876`; it only appears in the initial OAuth callback URL parser). `validToken()` simplified to fast-path only. 3-layer `loadSpotify()`: (1) UserDefaults instant cache → (2) Supabase DB persistent fallback → (3) live Spotify API when token valid, writes back to both caches. New `SpotifyService` methods: `saveArtistsToDB`, `saveRecentlyPlayedToDB`, `loadArtistsFromDB`, `loadRecentlyPlayedFromDB`. Migration `20260622000001_spotify_data_cache.sql` adds `spotify_artists jsonb`, `spotify_recently_played jsonb`, `spotify_data_updated_at timestamptz` to `profiles` (⏳ apply via SQL editor).
18. ✅ **Session 13 (2026-06-23):** Rating modal redesign — `ManualRatingSheet` now uses `Slider` (0.5 increments, haptic feedback, ✕ close, `.medium` detent). `InstinctRatingView` redesigned: I2 bucket (compact cover + emoji tiles 😞/😐/🙂), I3 compare (full-width cover banner + gradient overlay + Better/Worse buttons), done state (✓ badge + score). **Bug fixes:** Instinct score never written to DB (added `writeScore()` helper called in `finalize()` and `vote()`); Spotify reconnect banner not disappearing (`linkIdentity` → `signInWithOAuth`; `NotificationCenter` notification fires on token arrival); explore feed wiped on pull-to-refresh (guard pattern). **Explore ranking:** weighted relevance algo — following boost (+8), artist taste match (+5), log-scaled likes/comments, prestige, recency. 150-post pool, top 60 surfaced. `loadPersonalization()` pre-loads `followingIds` and `likedArtists` (4+ star artists) before explore. **Add tab:** session checkmarks (`sessionRatedIds`) — tapped items show ✓ and stay visible; rated items hidden only at launch. Song lists capped at 5 with "See all N songs" expand. New **"From Your Taste"** section (4+ star artists, prestige-sorted). New **"Trending"** section (most-rated last 30 days). Artist search results derived client-side from album results, shown at top. **Artist page (A2):** typographic name, stats row, your-ratings chip, community score dot per release row. **Image perf:** `URLCache` increased to 50MB memory + 300MB disk; `String.thumbnailUrl` rewrites iTunes `600x600bb` → `300x300bb` (~4× smaller); applied to all thumbnail `AsyncImage` calls in `SearchView` and `HomeView`.
19. ✅ **Session 15 (2026-06-25):** Report/Block wired in feed card menu (`ReportSheet` + `confirmationDialog`; `reports` + `blocked_users` tables — migration written ⏳ run on Windows). Clickable tracklist songs → `SongDetailView`. Taste lock screen: "albums" → "releases" + "Find releases to rate" button → Add tab. Profile share URL fix: iOS was generating `/@username` (404) → fixed to `/profile/username`; `/@:username` redirect added to `next.config.mjs`.
20. ✅ **Session 16 (2026-06-26):** OG images — main page: flower on white; profile: `avatar_url` direct in metadata; album/song: `cover_url` direct in metadata. New `logo-dense.svg` + `logo-flower.png` in `apps/web/public/`.
21. ✅ **Session 17 (2026-06-26):** **All 9 iOS Swift files updated to the renovated DB schema.** `Release.swift` CodingKeys → `artist_display`, `release_group_type`, `first_release_date`, `native_title`. `AlbumDetailView.swift`: 2-step track loading (canonical release → `release_tracks` + `recordings`), `trackRatings: [UUID: Double]`, all queries on `release_group_id`/`recording_id`. `InstinctRatingView.swift`: `winner_id`/`loser_id`, upsert conflict `user_id,release_group_id`. `HomeView.swift`: `feedSelect` on `release_groups`, `prestige` removed from ranking, personalization seeds from `artist_display`. `SearchView.swift`: all discovery on `release_groups`, 2-step song search, `ArtistPageView` on `artist_display`, `ratedReleaseIds` from `release_group_id`. `ProfileView.swift` + `UserProfileView.swift`: album ratings embed `release_groups`; song ratings 2-step via `recordings` + `release_tracks → release_groups` for cover art; `SongRatingRow`/`SongRating` keyed by `recordingId`. `MixLibraryView.swift`: `MixItem`/`MixRelease` on `release_group_id`/`release_groups`. `TasteView.swift`: `release_groups` embed + `artist_display`. **Deferred:** `ActivityView.swift` (broken `releases` embed, out of scope), Charts RPCs (gracefully degraded via `try?`), song discovery sections (empty until Windows rebuilds RPCs), Taste genre standings (dropped in renovation — empty until Windows rebuilds).
22. ✅ **Session 18 (2026-06-27 Mac):** Silla Score system built — `external_scores` table + `get_external_prestige_scores` RPC ([migration](apps/web/supabase/migrations/20260627000000_external_scores.sql) ✅ applied); Grammy AOTY data file (360 entries 1959–2025) + generic seeder (`seed-external-scores.ts`); `get_silla_leaderboard` RPC ([migration](apps/web/supabase/migrations/20260627000001_silla_leaderboard.sql) ✅ applied — post-renovation schema: `ratings.release_group_id`, `_rg_has_genre`, metadata from `release_groups`); iOS `RankingDetailView` wired to real RPC with genre/country filter reloads + silla_score badge. Grammy seed: ✅ complete (2026-06-28) — 359/360 inserted (282 new + 77 already in DB); 1 failed: Fugees — *The Score* (no Spotify match). Next session continues from here on Mac.
23. ✅ **Session 19 (2026-06-28 Mac):** Grammy seed re-run complete — 359/360 inserted (282 new + 77 already in DB skipped; 1 failed: Fugees *The Score*, no Spotify match).
24. **Next (Mac):** ① Seed next prestige sources: Mercury Prize (`scope_country='uk'`), Korean Music Awards (`scope_country='kr'`), Pitchfork 10.0 albums. ② Profile > Stats subtab. ③ TestFlight once Apple Developer account active. ✅ `avatars` storage bucket confirmed created.
23. **Later:** MusicKit integration (Apple login), Spotify `user-top-read` sync — see `WEB_PARITY.md` §3

**Catalog expansion (ongoing — Windows):** `queue:ingest:albums` paused (killed to run tracklist fix; 21,254 artists still pending — restart with `npm run queue:ingest:albums` after `backfill:tracks` finishes; `backfill:tracklists` + `backfill:embeddings` are ✅ done). Current catalog: 418,514 releases (127k albums, 49k EPs, 230k singles). When ingest finishes: enrichment backfills in order — `backfill:genres` → `backfill:genres:lastfm` → `enrich:genres:lastfm` → `backfill:native` → `backfill:covers` → rebuild HNSW index → `npm run analyze:coverage:albums` + `catalog:status`. Do **not** re-run discovery (saturated).

#### Catalog composition + storage (analyzed 2026-06-14 session 3)

- **Disk:** Supabase Pro, 8 GB. Used ~1.62 GB (database 0.90 · WAL 0.56 · system 0.16); 6.21 GB free. The full expansion is projected to land ~2.4–4 GB total — comfortably within budget. Do not downgrade to Free (DB is 3.2× the 500 MB Free cap → read-only).
- **Composition (recommendable set, 110,728 albums+EPs):** electronic 15.4% · hip-hop 12.3% · rock 10.8% · pop 7.6% · k-pop 5.9%. The Last.fm "similar" snowball drifted the catalog to Western electronic/hip-hop; Asian neighbours are nearly absent (SE Asia 4 albums, China 393, India 63, Japan ~2,823) — that's the gap the expansion fills. Korea is ~8–11%; since the platform targets a **global** community this is acceptable (no forced Korean dominance). Full target proportions + run order live in [CATALOG_EXPANSION_PLAN.md](CATALOG_EXPANSION_PLAN.md).
- **Tooling:** `catalog:status` (live dashboard — queue/artists/releases by type/region/genre), `analyze:coverage[:albums]` (coverage report), `measure-storage.ts` (storage estimate), `queue:build:global` + `queue:discover:global` + `queue:ingest:albums` (deliberate expansion).

#### DB Renovation — 2026-06-24 (⏳ Windows: run migration first)

Full schema rebuild to fix artist identity, release grouping, and song-level identity. Pre-launch window — catalog will be re-ingested from scratch.

**New tables:**
- `artist_aliases` — N name variants → 1 artist. `UNIQUE(alias)` prevents catalog splits ("드레스" and "dress" → same row)
- `artist_external_ids` — `PRIMARY KEY(source, external_id)` allows multiple iTunes IDs per artist (split catalog support)
- `release_groups` — the album/EP/single as a concept. Users rate this, not specific editions
- `recordings` — stable audio entity with ISRC. Song ratings key on this UUID, not `(release_id, position)` — survives remasters
- `release_tracks` — maps recording → release → position

**Changed tables:** `artists` (text PK → uuid PK + disambiguation/country/ingest_priority/next_check_at), `releases` (+ release_group_id + is_canonical + region), `ratings` (release_id → release_group_id), `track_ratings` ((release_id, track_position) → recording_id), `pairwise_comparisons` (→ release_group winner/loser), `track_pairwise_comparisons` (→ recording winner/loser), all user-content tables (reviews, list_items, mix_items, saved_releases, pinned_albums, ranking_votes, curated_releases → release_group_id).

**Dropped (must be rebuilt post-migration):** `recommendable_releases` view; all Charts RPCs (`get_charts_top_rated`, `get_charts_most_rated`, `get_charts_trending`, etc.); `get_user_genre_standings`; `get_calibrated_bayesian_scores`. `record_rating_change` trigger is rebuilt in the migration itself.

**Rating backups (re-import after re-ingestion):**
- `backups/ratings_pre_renovation_20260624.csv` — 98 album ratings from 7 users (gitignored)
- `backups/track_ratings_pre_renovation_20260624.csv` — 20 track ratings (gitignored)

**Windows step-by-step:**
1. Run `apps/web/supabase/migrations/20260624000001_db_renovation.sql` in Supabase SQL editor
2. Update `ingest-itunes.ts` / `ingest-itunes-queue.ts`: check `artist_aliases` before creating artists; find/create `release_groups`; populate `recordings` + `release_tracks`; write iTunes IDs to `artist_external_ids`
3. `npm run itunes:seed` (expanded global seed list) then `npm run queue:ingest:albums` for full re-ingestion
4. After ingestion: re-import ratings from backups by matching title → new `release_group_id`
5. Rewrite all dropped RPCs/views to query `release_groups` instead of `releases`
6. Build sustainability scheduler: Supabase Edge Function driven by `next_check_at`; iTunes chart polling for 15 markets (US, UK, KR, JP, BR, MX, FR, DE, IN, NG, ZA, AU, CA, ES, TW)

**Mac step-by-step (after migration runs):**
1. Update Swift models: `Release` → `ReleaseGroup`; `ratings` use `release_group_id`; `track_ratings` use `recording_id`
2. `AlbumDetailView`: load from `release_groups`, join canonical `release_tracks` → `recordings`
3. `SearchView`: search `release_groups.title` and `recordings.title`
4. `ProfileView`: ratings join `release_groups`; track_ratings join `recordings`
5. `InstinctRatingView`: comparisons write `release_group_id` / `recording_id` pairs

#### DB migrations — production status (verified against prod 2026-06-11 via SQL editor)

⚠️ One migration pending (see renovation section above). If `supabase db push` is blocked by timestamp-collision history, paste into the Supabase SQL editor instead.

| File | What it adds | Prod |
|------|-------------|------|
| `20260625000001_report_block.sql` | `reports` table (abuse reports with reason picker) + `blocked_users` table (feed filtering); RLS: users insert own reports/blocks, blocked users cannot see they're blocked | ⏳ **NOT YET RUN** — run in SQL editor (Windows) |
| `20260624000001_db_renovation.sql` | Full schema rebuild: artists uuid PK, artist_aliases, artist_external_ids, release_groups, recordings, release_tracks; all user-content tables switched to release_group_id / recording_id; sustainability scheduler columns | ⏳ **NOT YET RUN** — run in SQL editor (Windows) |
| `20260622000001_spotify_data_cache.sql` | `spotify_artists jsonb`, `spotify_recently_played jsonb`, `spotify_data_updated_at timestamptz` on `profiles` — persistent Spotify data cache; survives token expiry, reinstalls, and device switches | ✅ applied 2026-06-22 (SQL editor) |
| `20260621000003_suggested_users.sql` | `get_suggested_users(p_user_id)` RPC — active users not yet followed, ordered by rating count, for Find People page | ✅ applied 2026-06-21 (SQL editor) |
| `20260621000002_push_token.sql` | `push_token text` column on `profiles` for APNs device token storage | ✅ applied 2026-06-21 (SQL editor) |
| `20260621000001_taste_rpcs.sql` | `get_user_genre_standings(p_user_id)` RPC for Taste page genre standings | ✅ applied 2026-06-21 (SQL editor) |
| `20260620000003_charts_song_rpcs.sql` | 3 song chart RPCs: `get_charts_top_rated_songs`, `get_charts_most_rated_songs`, `get_charts_trending_songs` | ✅ applied 2026-06-24 (SQL editor) |
| `20260620000002_charts_rpcs.sql` | 8 SECURITY DEFINER RPCs for the Charts tab: `get_charts_pulse`, `get_charts_top_rated` (min 1 rating, was 5), `get_charts_most_rated`, `get_charts_trending`, `get_charts_trending_for_genres`, `get_user_top_genres`, `get_charts_hidden_gems`, `get_charts_controversial` | ✅ applied 2026-06-24 (SQL editor) |
| `20260620000001_mixes.sql` | `mixes` + `mix_items` tables + RLS + partial unique index (one default per user) + `_create_default_mix()` trigger on profiles INSERT + backfill "Listen Later" for all existing users | ✅ applied 2026-06-20 (SQL editor) |
| `20260619000005_fix_social_fks.sql` | Retargets `rating_likes.user_id` + `rating_comments.user_id` from `auth.users` → `profiles(id)` so PostgREST can traverse embedded joins | ✅ applied 2026-06-20 (SQL editor) |
| `20260619000004_notifications.sql` | `notifications` table + RLS (recipient read + system insert) + triggers on `rating_likes`, `rating_comments`, `follows` to auto-insert notifications | ✅ applied 2026-06-20 (SQL editor) |
| `20260619000003_saved_releases.sql` | `saved_releases` table (release bookmarks) with FK direct to `profiles(id)` | ✅ applied 2026-06-20 (SQL editor) |
| `20260619000002_social_features.sql` | `rating_likes`, `rating_comments` tables + RLS + FKs to `profiles(id)` | ✅ applied 2026-06-19 (SQL editor) |
| `20260619000001_profiles_avatar.sql` | `avatar_url` column on `profiles` | ✅ applied 2026-06-20 (SQL editor) |
| `20260618000002_song_ratings.sql` | `track_ratings.elo_score`/`elo_games` (Instinct for songs) + `track_pairwise_comparisons` table + RLS (song-vs-song comparisons) | ✅ applied 2026-06-19 (SQL editor) |
| `20260618000001_ratings_status_default.sql` | Documents legacy `ratings.status` (prod-only) + adds `DEFAULT 'Listened'` so upserts that omit it stop failing with 23502 (fixes Instinct comparison) | ✅ applied 2026-06-19 (SQL editor) |
| `20260618000000_tracks_table.sql` | `tracks` table (songs as first-class) — populated by `npm run backfill:tracks` | ✅ applied 2026-06-18 (SQL editor) |
| `20260617000002_ratings_score_nullable.sql` | Drops NOT NULL on `ratings.score` (Instinct rows store `elo_score`, no star score) | ✅ applied 2026-06-18 (SQL editor) |
| `20260617000001_manual_rating_step.sql` | `manual_rating_step` on profiles (0.5 default / 0.1) — Manual rating precision toggle | ✅ applied 2026-06-18 (SQL editor) |
| `20260617000000_instinct_rating_mode.sql` | `rating_mode` on profiles, `elo_score`/`elo_games` on ratings, `pairwise_comparisons` table + RLS (Instinct mode) | ✅ applied 2026-06-17 (SQL editor) |
| `20260615000000_add_apple_music_platform.sql` | Extends `preferred_streaming_platform` CHECK constraint to include `apple_music` | ✅ applied 2026-06-19 (SQL editor) |
| `20260611000001_user_id_by_email_prefix_fn.sql` | `get_user_id_by_email_prefix` SECURITY DEFINER SQL function — replaces `auth.admin.listUsers(1000)` on profile page | ✅ applied (SQL editor) |
| `20260611000000_genres_trgm_index.sql` | GIN trigram index on `releases.genres` — eliminates full-table ILIKE scans | ✅ applied (SQL editor, Supabase Pro) |
| `20260531000001_daily_questions.sql` | `daily_questions` + `daily_answers` tables + RLS + 30 seeded questions | ✅ applied |
| `20260531000003_profiles_streaming_platform.sql` | `preferred_streaming_platform` on profiles | ✅ applied 2026-06-01 |
| `20260601000000_list_panel_updates.sql` | `position` col on `list_items`; UPDATE RLS policy on `lists` | ✅ applied 2026-06-01 |
| `20260601000001_spotify_connections.sql` | `spotify_connections` table (Spotify OAuth tokens) | ✅ applied 2026-06-01 |
| `20260601000002_adventurousness.sql` | `recommendation_adventurousness` on profiles (default 50) | ✅ applied 2026-06-01 |
| `20260601000010_accomplishments.sql` | `accomplishment_definitions` + `user_accomplishments` tables + RLS + 5 seed badges | ✅ applied |
| `20260601000011_silla_score_tuning.sql` | Silla Score fix: drops + recreates `get_calibrated_bayesian_scores` (damping m=10→3, now 3-col) and adds `get_silla_rating_scores(uuid[], text, int)` | ✅ applied 2026-06-01 |

Also applied to prod (lives in root `supabase/migrations/`, not `apps/web/`): `20260601000002_list_item_tracks.sql` (✅ `list_item_tracks` table). The conflicting `20260601000001_silla_score_fn.sql` in that folder was **deleted** (superseded 2-col duplicate).

#### Spotify playlist export — ✅ configured (2026-06-12)

- ✅ Redirect URI `https://sillajuku.com/api/spotify/callback` added in Spotify developer dashboard
- ✅ `SPOTIFY_REDIRECT_URI` added to Vercel env vars and `.env.local` (localhost value on dev machines)

#### Catalog pipeline — ✅ Complete (2026-06-10)

All pipeline steps done including HNSW index rebuild (2026-06-09). **Next action: deploy to Vercel** to activate hybrid semantic search in production.

| Step | Command | Status |
|------|---------|--------|
| backfill:genres (passes 1+2) | `npm run backfill:genres` | ✅ done (2026-06-01) |
| backfill:native:releases | `npm run backfill:native:releases` | ✅ done (2026-06-01) |
| check:completeness | `npm run check:completeness` | ✅ done (2026-06-04) |
| queue:ingest (runs 1–6) | `npm run queue:ingest` | ✅ done — ~347k releases |
| queue:discover (runs 1–4) | `npm run queue:discover` | ✅ done — queue stable |
| enrich:genres:lastfm | `npm run enrich:genres:lastfm` | ✅ done (2026-06-07) — 15,460 enriched |
| backfill:embeddings | `npm run backfill:embeddings` | ✅ done (2026-06-10); re-run 2026-06-18 for expansion releases — +69,795 embedded, 0 failed |
| Rebuild HNSW index | psql direct (port 5432) | ✅ done (2026-06-09); ⏳ **rebuild owed** — the 69,795 new embeddings (2026-06-18) aren't indexed yet |
| backfill:tracklists | `npm run backfill:tracklists` | ✅ done (2026-06-16) — 107,778 filled (106,652 via itunes_id, 1,126 via search), 7,826 no tracks (93% coverage) |

#### Catalog pipeline — completed steps (historical)

- ✅ Cover art backfill — 15 releases filled (2026-05-28)
- ✅ Semantic search embeddings — 9,213 releases embedded in initial passes (2026-05-28); ~93k total after full backfill (2026-06-10); `JINA_API_KEY` must be set in Vercel env for hybrid search in prod
- ✅ Genre pipeline — iTunes Tier 1 (2,864 matched), Last.fm Tier 2, hand-curated overrides (68 applied), Last.fm enrichment (15,460 enriched 2026-06-07)
- ✅ `normalize-releases.ts` — 135 dates padded, 3,286 genres lowercased
- ✅ `backfill:native:artists` Phase 1 — ~247/536 artists have `name_native`
- ✅ `backfill:native:releases` Phase 2 — done 2026-06-01 (low yield: K-pop uses English titles in local stores)
- ✅ `backfill:covers` — run 2026-05-28; 15 releases filled, 0 remaining
- ✅ `queue:ingest` (run 2) — complete 2026-06-03: ~289k new releases; final catalog **~347k releases** after discover→ingest loop
- ✅ Collab artist cleanup (2026-06-03) — 303 queue entries + 2 artists deleted
- ✅ Dedup bug recovery (2026-06-04) — 0 data loss confirmed; `find-duplicate-releases.ts` fixed
- ✅ discover → ingest loop stable (2026-06-04) — runs 3–6 complete

### Catalog normalization — done

`normalize-releases.ts` fixed three historical inconsistencies across all 5,421 Spotify-sourced rows:
- Partial `release_date` values (e.g., "2024" → "2024-01-01") — **135 rows fixed**
- Mixed-case `genres` (e.g., "K-Pop" → "k-pop") — **3,286 rows fixed** (lower than dry run because iTunes backfill was running in parallel and pre-fixed some rows)
- Lowercase `release_type` values — **0 found** (already correct)

All new write paths (iTunes queue ingest, vote route) enforce these formats at insert time.

### Spotify API — retired from data collection

Spotify is no longer used to collect catalog data. Every data-collection script and npm command that relied on Spotify is either dead or superseded. The web server still uses Spotify at runtime for search fallback and album detail, protected by the circuit breaker. See the [new catalog pipeline](#catalog-pipeline--non-spotify) below.

### New environment variables (check both devices)
`LASTFM_API_KEY` was added to `.env.local`. **Copy it to the other device before running any Last.fm scripts there.** Full list in `apps/web/.env.example`.

### Verified during 404 hardening (no separate verification step required)
- Upstash Redis is receiving cache writes (`spotify:album:*`, `search:albums:*`, `spotify:rate-limited-until`)
- Dev server restarts no longer cost Spotify calls (caches persist across restarts)

---

## 🔧 Debugging Spotify-related production issues

**If you see any of these symptoms in prod, this is almost always Spotify rate-limiting:**

- `/api/search` returns 500 or empty results
- Album pages show "Spotify returned null" in Vercel logs
- Search UI shows the amber "Showing cached results" banner
- Recommendations / explore feels suddenly thinner than usual

### Step 1 — Confirm it's the circuit breaker

```bash
curl -s "https://www.sillajuku.com/api/search?query=test&type=releases"
```

If the response is `{"error":"Spotify circuit breaker open: Xs remaining", ...}` OR returns `{ releases: [...], degraded: true }`, then a Spotify 429 has tripped the breaker in Redis. Confirm by checking Upstash → key `spotify:rate-limited-until` (its value is the UTC timestamp in ms when the breaker auto-clears).

### Step 2 — Find what tripped it (THIS IS THE PART PEOPLE FORGET)

**Check Vercel logs** for the path that actually got the 429. Grep filters worth knowing:

| Log filter | What it tells you |
|------------|-------------------|
| `[spotify] 429 path=` | The exact Spotify endpoint that tripped the breaker (web server side). Added 2026-05-24. |
| `[scriptCircuit] published 429 from` | A local script tripped the breaker (not real user traffic). Names the script. |
| `Spotify circuit breaker open` | Symptom, not cause — these are calls that *got blocked by* the breaker after it was already tripped. Look earlier. |
| `[search] Spotify ... failed, falling back to DB` | Search degraded to DB fallback. Symptom. |

If the **Vercel free tier** is hiding old logs, just wait for the next 429 — instrumentation now logs the path live, so the next incident is self-diagnosing.

### Step 3 — Common root causes

1. **A script bypassing the web server** — `backfill-genres`, `expand-catalog`, `ingest-music`, `seed-prestige`, `seed-rankings` all use the same Spotify credentials. As of 2026-05-24 they refuse to start when the breaker is open and publish their own 429s to the same Redis key, but check the script logs.
2. **Cold-cache traffic burst** — server restart wipes the in-memory token cache and a surge of recommendation grid loads can burn quota fast. The Upstash Redis cache (added 2026-05-22) reduces this risk significantly.
3. **A long-running personalized/recommendations call** — heavy fan-out to many Spotify endpoints from a single page load.

### Step 4 — Recovery options

- **Wait it out** — the breaker TTL matches Spotify's `Retry-After`, so it auto-clears. Production already degrades gracefully (search → DB fallback, albums → basic-row fallback, banner shown to users).
- **Manually clear** — `DEL spotify:rate-limited-until` in Upstash. Only useful if you believe the breaker tripped on a transient blip — if Spotify is genuinely in cooldown, the next API call just re-trips it.
- **Do NOT run scripts during a cooldown** — they now refuse to start, but if you bypass that check you'll prolong the outage.

---

## Local development

### Web

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `apps/web/.env.local` (copy from `.env.example` then fill in values):
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   SPOTIFY_CLIENT_ID=
   SPOTIFY_CLIENT_SECRET=
   SEED_SECRET=pick-any-random-string
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   LASTFM_API_KEY=           # needed for backfill:genres:lastfm
   ```
   ⚠️ **Two-device reminder:** if you add a new env var on one machine, copy it to the other manually. `.env.local` is gitignored and never synced.

3. Run the dev server:
   ```bash
   npm run dev:web
   ```

### Mobile (React Native / Expo)

1. Install dependencies:
   ```bash
   cd apps/mobile && npm install
   ```

2. Create `apps/mobile/.env` (copy from `.env.example`):
   ```
   EXPO_PUBLIC_SUPABASE_URL=
   EXPO_PUBLIC_SUPABASE_ANON_KEY=
   # URL of the deployed web app — used to proxy Spotify search and OAuth redirects
   EXPO_PUBLIC_API_URL=https://sillajuku.com
   ```

3. Start Expo:
   ```bash
   cd apps/mobile && npx expo start
   ```
   Scan the QR code with the **Expo Go** app on your iPhone (requires Expo Go SDK 54).

---

## Supabase setup

Schema changes are written as migration files in `supabase/migrations/` — but in practice, most have been applied by pasting the file's contents directly into the Supabase SQL editor, not via `supabase db push` (the Mac dev environment isn't `supabase link`ed to the project). The CLI workflow below works and is the documented path; treat the migrations folder as the source of truth for what *should* be live, and verify against the actual Supabase instance if in doubt, since not every apply has gone through the CLI.

### Install the CLI (Windows)

Download the binary from GitHub releases and add to PATH:
```
https://github.com/supabase/cli/releases/latest → supabase_windows_amd64.tar.gz
```
Extract `supabase.exe` to a folder and add that folder to your system PATH.

### First-time setup (one time only)

```bash
supabase login
supabase link --project-ref mmbptchpetwdievhrdsj
supabase db push
```

`db push` runs every file in `supabase/migrations/` in order.

### Adding a new schema change

```bash
supabase migration new <short_description>
# edit the generated file in supabase/migrations/
supabase db push
```

---

## Deployment checklist

### Before going live

- [x] Set all environment variables in Vercel
- [x] Run all migrations (`supabase db push`) — all 13 tables + RLS policies applied
- [x] Add jurisdiction to Terms of Service (Republic of Korea)
- [x] Enable Google OAuth in Supabase Auth dashboard
- [x] Enable Spotify OAuth in Supabase Auth dashboard
- [x] Replace contact emails in privacy/terms pages → `admin@sillajuku.com`
- [x] Add `sillajuku://auth/callback` to **Supabase → Authentication → URL Configuration → Redirect URLs** (required for mobile OAuth)
- [x] Enable Supabase Auth email confirmations (Auth → Email Templates) — ✅ confirmed on 2026-06-12; sender: noreply@sillajuku.com via Resend SMTP

### After first deployment

- [ ] **Seed the ranking categories** (6 curated categories):
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-rankings \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```
- [x] **Seed the homepage genre rows:** ~~not needed~~ — `curated_releases` is only a fallback; with 347k releases in the DB, `RecommendationGrid` always uses the primary `recommendable_releases` path and never falls through to this table.
- [x] **Seed default ranking votes** — skipped; all 6 leaderboard categories already have baseline data via `ranking_seed_entries` (RS500 467 albums, K-Pop 29, Hip-Hop 59, Korean all-time, K-Hip-Hop, Best 2025). `scripts/seed-votes.ts` is an unfilled template and not needed.

### After launch (once real users are voting)

- [ ] **Remove or reduce seed votes** — once real votes overtake seeds:
  ```bash
  curl -X DELETE https://your-domain.com/api/admin/seed-votes \
    -H "x-seed-secret: YOUR_SEED_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}'
  ```
- [ ] **Revisit FilterBuilder genre map** — update `genresByCountry` in `components/FilterBuilder.tsx` based on real usage data.
- [ ] **Re-curate ranking categories** — add year-specific categories via `app/api/admin/seed-rankings/route.ts`.

---

## gstack skills

gstack is installed at `~/.claude/skills/gstack`. Skills are available as slash commands in Claude Code.

| Stage | Skill | When to use |
|---|---|---|
| Planning | `/office-hours` | Before writing any code — 6 forcing questions |
| | `/plan-eng-review` | Lock in architecture, data flow, edge cases |
| | `/autoplan` | Runs CEO → design → eng review in one shot |
| Building | `/review` | Pre-merge code review |
| | `/investigate` | Stuck on a bug — systematic root-cause process |
| UI / design | `/design-review` | Audit live UI, rate dimensions, fix AI slop |
| | `/design-shotgun` | Generate 4–6 design variants, compare, iterate |
| QA | `/qa` | Real browser — clicks through flows, finds bugs, commits fixes |
| | `/qa-only` | Same as `/qa` but report-only, no code changes |
| Security | `/cso` | OWASP Top 10 + STRIDE — run before any auth feature ships |
| Shipping | `/ship` | Sync main, run tests, push, open PR |
| | `/land-and-deploy` | Merge PR, wait for CI + deploy, verify production |
| Post-deploy | `/canary` | Watch for console errors, perf regressions |
| Debugging | `/browse` | Give Claude a real browser |

---

## Pre-launch roadmap

Target: **mid-June 2026** (earlier the better).

### Data collection

| Phase | What it does | Status |
|-------|-------------|--------|
| Phase 1 — seed catalog | 315 curated Korean/Japanese/Western classics | ✓ done (306/315) |
| RS500 baseline | Rolling Stone 500 seeds "all-time" ranking | ✓ done (481 seeded) |
| Phase 2 — Wikipedia artist queue | ~759 Korean artists from 19 Wikipedia categories | ✓ done — 759 artists queued (re-run `queue:build` once to backfill `name_native`) |
| Phase 3 — iTunes queue ingest | Full discographies for all queued artists (no auth, no rate limits) | ✅ done — ~347k releases (runs 1–6 complete) |
| Phase 4 — Last.fm similar discovery | Finds related artists for everyone in DB | ✅ done — queue stable (runs 1–4 complete) |
| Phase 4b — Native name backfill | Wikipedia langlinks (artists) + iTunes local store (releases) for `name_native`/`title_native` | ✅ done — Phase 1 ~247/536 artists; Phase 2 done 2026-06-01 |
| Phase 5 — miss-driven ingestion | `search_misses` table populated on every cache miss; ingest nightly | Logging active, no ingest job yet |
| ~~Phase 3 related~~ | ~~Spotify `/artists/{id}/related-artists`~~ | ❌ Dead — Spotify deprecated this endpoint in late 2024 |
| ~~Discography expansion~~ | ~~Spotify `/artists/{id}/albums`~~ | Superseded by iTunes queue ingest |

**New pipeline run order (loop until queue stable):**
```bash
cd apps/web
npm run queue:build          # re-run once to backfill name_native on existing 759 rows
npm run queue:ingest         # drain queue via iTunes (no auth, no rate limits)
npm run queue:discover       # find similar artists via Last.fm, add to queue
# repeat queue:ingest → queue:discover until queue is empty
npm run backfill:native      # fill native names for existing artists + releases
npm run backfill:covers      # fill any remaining null cover_url (iTunes → Last.fm → MusicBrainz → Spotify)
```

---

### Week 4 — May 31–Jun 6: remaining

- [x] **Rate limiting** — `/api/check-username` (20/min), `/api/rankings/vote` (30/min), `/api/follow` (10/min), `/api/search` (30/min) + more via `lib/rateLimit.ts` + Upstash Redis
- [x] **Per-user rate limit on `/api/search`** — 30 req/min sliding window via shared `rateLimit` helper
- [x] **DB-FTS-first search rewrite** — artist search now tries DB first (≥5 results = skip Spotify); releases path was already DB-first; removed background Spotify refresh on successful DB hits
- [x] **Upstash Redis caching** — ranking leaderboard scores (`sj:ranking:scores:v3:*`), album avg rating + count (`sj:album-stats:*`), album ranking badges (`sj:album-rankings:*`), search suggest (`sj:suggest:*`) all cached with appropriate TTLs
- [ ] Korean i18n (next-intl; language toggle in settings) — DB schema is ready (`native_language` columns), UI display in AlbumCard is done; remaining work is route-level i18n and language toggle
- [x] **Genre overrides applied** (2026-05-24) — 68 hand-curated overrides applied; `genre-overrides.json` workflow complete
- [x] **404 hardening + Spotify circuit breaker** (2026-05-23) — `/api/search` persists results to `releases`; `lib/spotify.ts` has a Redis circuit breaker that short-circuits all Spotify calls during a 429 window
- [x] **Search graceful degradation + script breaker cooperation + 429 instrumentation** (2026-05-24) — `/api/search` returns DB results with `degraded: true` instead of 500 when Spotify is rate-limited; degraded banner in search UI; `lib/spotify.ts` logs `[spotify] 429 path=...` for log-grep diagnosis; all 5 scripts read+publish the shared circuit breaker key via `scripts/spotify-circuit.ts`; debugging runbook in this README
- [x] **Non-Spotify catalog pipeline** (2026-05-24) — Wikipedia → iTunes queue → Last.fm similar → miss-driven; all scripts built and tested (dry run); migrations applied
- [x] **Multilingual catalog** (2026-05-24) — `title_native`/`artist_native`/`native_language` columns on releases; `name_native`/`native_language` on artists; language-agnostic ISO 639-1 design; `detectLanguage()` from Unicode ranges; search queries native columns; `AlbumCard` displays native names; `backfill-native-names.ts` two-phase pipeline for existing rows; `build-artist-queue` + `ingest-itunes-queue` enriched for new ingestion
- [x] **Column consistency guarantee** (2026-05-24) — all 9+ write paths to `releases` audited; all inconsistencies fixed; `normalize-releases.ts` corrected 153 dates + 3,687 genre casings in historical data
- [x] **React Native app** (Expo SDK 54) — core screens built (see Mobile App Status below)
- [ ] EAS build + App Store (iOS) + Play Store (Android) submission
  - ⚠️ Apple review takes 1–2 weeks — submit by Jun 1 to hit mid-June

### Week 5 — Jun 7–14: QA + production deploy

- [x] Create dummy/test account and QA all social flows end-to-end — ✅ 2026-06-14 (local)
- [x] Production deployment (custom domain, all env vars set, migrations pushed) — live at sillajuku.com
- [x] Seed all ranking categories with baseline data — ✅ 2026-06-12
- [x] **Fix N+1 queries in `/api/reviews/route.ts`** — batched via `Promise.all` (already done)
- [x] **Replace `releases(*)` wildcard in `ProfilePanel.tsx`** — specifies `id, title, artist, cover_url` (already done)
- [x] **Add env var validation at startup** — `instrumentation.ts` fails fast on missing Supabase keys (already done)
- [x] **Add `router` to useEffect deps in `AuthForm.tsx`** — `[awaitingConfirmation, router]` (already done)
- [x] **Add error UI to `PersonalizedFeed.tsx`** — `'error'` status + fallback render (already done)
- [x] **Replace silent `catch {}` blocks with `console.error`** — one intentional silent catch remains in `RecommendationGrid.tsx` (DB fallback path)
- [x] **Collect country on onboarding** — `COUNTRIES` dropdown in Step 1, `country` column on profiles, migration `20260521000000_profiles_country.sql` (already done)
- [x] Final QA pass end-to-end on production — ✅ 2026-06-14 (local dev; push 5 commits to run on prod)

### Post-launch

- [ ] **사업자등록 (개인사업자)** — register on 홈택스 (hometax.go.kr); free, ~1-2 days approval; unlocks Kakao 비즈 앱
- [ ] **KakaoTalk login** — after 사업자등록: convert Kakao app to 비즈 앱, enable `account_email` in 동의항목, set `available: true` in `settings/page.tsx`
- [ ] **US LLC via Stripe Atlas** — once revenue is consistent; ~$500 one-time; needed for App Store/Play Store payouts at scale
- [ ] **Apple login** — requires Apple Developer account ($99/yr); code already stubbed, enable in Supabase dashboard
- [ ] Wrapped page — needs months of user data to be meaningful
- [ ] Remove/reduce seed votes once real community votes overtake the baseline
- [ ] **Typesense for fuzzy search** — typo-tolerant search on top of PostgreSQL; not needed for launch
- [ ] **Insights + History page** — `/profile/[username]/insights`: rating timeline, genre evolution, taste drift. Needs ~1–3 months post-launch data.
- [ ] **Music ingestion script** (`scripts/ingest-music.ts`) — Korean (full), Japanese (curated ~80 artists), Western essentials (~200 artists)

---

### Recommendation algorithm roadmap

Current: genre-based + artist-based pools with random shuffle. Presentation trick, not a real algorithm.

| Stage | Users | Approach |
|---|---|---|
| Now | 0–500 | Genre + artist pools, shuffled |
| Phase 1 | 500–5k | **Item-based collaborative filtering in SQL** — co-rated-highly albums. Computable in Postgres, no ML infra. |
| Phase 2 | 5k+ | **Matrix factorization via `pgvector`** — user and album embeddings, nearest neighbor queries |

Phase 1 trigger: once ~500 users, build the SQL co-rating query and surface on the For You page.

---

## Music catalog ingestion

### Catalog pipeline — non-Spotify

As of 2026-05-24, Spotify is no longer used for data collection. The new pipeline is:

```
Wikipedia categories → artist_ingestion_queue → iTunes discography ingest
                                                        ↓
                                          Last.fm similar discovery → queue (loop)
                                                        ↓
                                          search_misses table → nightly ingest job
```

#### Step 1 — Build the Wikipedia artist queue

Scrapes 19 Korean music Wikipedia categories (K-pop groups, solo male/female, hip-hop, rock, indie, jazz, trot, electronic, ballad, Korean pop) using the MediaWiki JSON API. Cleans disambiguation suffixes ("IU (singer)" → "IU"). Upserts to `artist_ingestion_queue`.

```bash
npm run queue:build        # populate queue
npm run queue:build:dry    # preview (no DB writes)
```

State: table-based (re-run is idempotent — skips artists already in queue). User-Agent: `sillajuku-catalog-builder/1.0`.

#### Step 2 — iTunes queue ingest

For each pending artist in the queue: searches iTunes for the artist ID, fetches their full discography, upserts releases. No auth, no API key, no rate limit beyond iTunes throttling (650ms/req delay with exponential backoff on 429/403).

```bash
npm run queue:ingest             # drain all pending artists
npm run queue:ingest:dry         # dry run
npm run queue:ingest -- --limit=50   # process only 50 artists
```

- Deduplicates by `itunes_id` first, then title+artist ilike match
- Enriched path only backfills `cover_url` if existing record has none (preserves Spotify art)
- Marks each queue row as `done` / `failed` / `skipped`; re-run to resume
- Paginates automatically (1000 artists/page) — a single run drains the entire queue; `--limit=N` caps total across all pages

#### Step 3 — Last.fm similar artist discovery

For every artist in the `artists` DB table, calls Last.fm `artist.getSimilar` and adds similar artists to `artist_ingestion_queue` (source: `lastfm_similar`). Then run `queue:ingest` again. Loop until the queue stabilizes.

```bash
npm run queue:discover        # discover similar artists
npm run queue:discover:dry    # preview
```

Requires `LASTFM_API_KEY` in `.env.local`. State file: `scripts/discover-lastfm-similar-state.json`.

#### Step 4b — Native name backfill (existing DB rows)

Fills `name_native` / `native_language` on artists and `title_native` / `artist_native` / `native_language` on releases for rows that already exist. Language-agnostic: covers Korean, Japanese, Chinese, and any future CJK language automatically.

- **Phase 1** (artists) — Wikipedia langlinks. For each artist, looks up the English Wikipedia article and picks the first non-Latin-script language title. Priority: ko → ja → zh → any other detected script (Arabic, Thai, Devanagari, Cyrillic, Hebrew, Greek). ~2 requests per artist, 350ms delay each. Much better coverage than MusicBrainz.
- **Phase 2** (releases) — iTunes local store. For each artist whose language was set by phase 1, fetches their discography from the local country store (KR / JP / TW). Only runs on releases from known Asian artists — Western releases are skipped with zero API calls.

```bash
npm run backfill:native:artists   # phase 1 only
npm run backfill:native:releases  # phase 2 only (requires phase 1 first)
npm run backfill:native           # both phases back-to-back
npm run backfill:native:dry       # preview, no DB writes
```

State saved every 20 records to `scripts/backfill-native-names-state.json`. Safe to Ctrl+C and resume anytime.

#### Step 5 — Cover art backfill

Finds all releases with `cover_url IS NULL` and runs a 4-tier fallback per release:
1. iTunes: `artworkUrl600` from search
2. Last.fm: `album.getInfo` → image[extralarge]
3. MusicBrainz → Cover Art Archive (1 req/s limit)
4. Spotify: search per album (last resort; skip with `--skip-spotify`)

```bash
npm run backfill:covers              # full run (all 4 tiers)
npm run backfill:covers:dry          # preview
npm run backfill:covers:no-spotify   # skip tier 4 (no Spotify calls)
```

Writes `cover_url` and `cover_source` ('itunes'/'lastfm'/'musicbrainz'/'spotify'). State file: `scripts/backfill-cover-art-state.json`.

#### Step 6 — Tracklist backfill

The iTunes queue ingest stores only `total_tracks` (the count), never the track list, so iTunes-sourced album pages render without a tracklist section. This backfill fills the `tracklist` column from iTunes. Per release: look up songs by stored `itunes_id` (1 call); if absent, search iTunes by title+artist to resolve the collection, then look up songs (and persist the resolved `itunes_id`). Writes tracks in the album page's render shape (`{ position, title, durationMs, artists }[]`) and sets `total_tracks` when null. No auth, no key — only iTunes throttling (650ms/req + backoff).

```bash
npm run backfill:tracklists              # full run (resumable)
npm run backfill:tracklists:dry          # preview, no DB writes
npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --limit=500       # batch
npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --include-singles # singles too
npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --skip-search     # itunes_id only
```

Singles skipped by default. State file: `scripts/backfill-tracklists-state.json`. ✅ **Full run complete (2026-06-16):** 115,604 non-single rows processed — 107,778 filled (106,652 via `itunes_id`, 1,126 via search), 7,826 no tracks found (93% coverage). The 7,826 misses are releases with no resolvable iTunes match (long-tail / non-iTunes catalog). Future ingests can populate tracklists inline with `npm run queue:ingest -- --with-tracks` (off by default to keep the discover→ingest loop fast).

#### Genre pipeline (run after queue ingest)

```bash
# Tier 1: iTunes backfill (fills null genres from iTunes search — resumable)
npm run backfill:genres           # or --dry-run
# State: scripts/backfill-genres-itunes-state.json

# Tier 2: Last.fm fallback (fills remaining nulls via album.gettoptags)
npm run backfill:genres:lastfm    # or --dry-run
# State: scripts/backfill-genres-lastfm-state.json

# Tier 3: Hand-curated overrides (68 high-value rows, applied 2026-05-24)
# Already done. Re-run if you add new overrides to genre-overrides.json:
npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts

# Supplementary: Last.fm enrichment — MERGES tags with existing genres (not just fallback)
# Run on ALL releases (not just null-genre ones). iTunes wrote "k-pop", Last.fm adds "r&b" → "k-pop,r&b"
npm run enrich:genres:lastfm      # or --dry-run
# State: scripts/enrich-genres-lastfm-state.json
```

#### Normalize historical data

Safe to re-run anytime. Fixes partial dates, mixed-case genres, lowercase release_type values.

```bash
npm run normalize:releases         # fix all inconsistencies
npm run normalize:releases:dry     # preview only
```

Last run (2026-05-24): 153 dates fixed, 3,687 genres lowercased, 0 release_types to fix.

### Supabase migrations applied (2026-05-24 sessions)

All applied to prod via `supabase db push`:
- `20260525000000_catalog_ingestion_queue.sql` — creates `artist_ingestion_queue`, `search_misses` tables
- `20260525000002_native_language_columns.sql` — adds `title_native`, `artist_native`, `native_language` to `releases`; `name_native`, `native_language` to `artists`; trigram indexes
- `20260525000003_native_language_constraint.sql` — CHECK constraint `native_language ~ '^[a-z]{2}$'`

### Legacy scripts (Spotify-based — mostly dead)

```bash
# These still exist but should not be used for data collection:
npm run ingest              # Spotify seed catalog (original 315-artist list) — still works but burns quota
npm run expand:discography  # Spotify discography expansion — still works, 60 artists/day
npm run expand:genre        # Spotify genre sweep — still works
# npm run expand:related    # ❌ DEAD — Spotify deprecated /artists/{id}/related-artists in late 2024
```

---

## Mobile app status (iOS Swift — in progress)

> **2026-06-17:** React Native (`apps/mobile`) retired. Rebuilding as native Swift/SwiftUI in `apps/ios/`. See `WEB_PARITY.md` for the full feature spec and `SESSIONS.md` (2026-06-17) for the decision rationale.

### Target screens (Swift rebuild)

| Screen | Status | Notes |
|--------|--------|-------|
| Home | ✓ | Genre carousels, "See all" → genre browse, search icon auto-focuses |
| Search / Explore | ✓ | 3-column grid, community picks, personalized recs, people search, Spotify fallback |
| Album detail | ✓ | Rating, reviews, tracklist, artist link, inline review modal, "In Rankings" chips |
| Artist page | ✓ | Full discography |
| Genre browse | ✓ | Infinite scroll, paginated |
| Leaderboard list | ✓ | All categories (route: `/leaderboard`) |
| Leaderboard page | ✓ | Silla Score normalized 0–100 (route: `/leaderboard/[slug]`) |
| Tierlist builder | ✓ | Numbered tiers + tie support; drag-and-drop (route: `/leaderboard/[slug]/rank`) |
| Activity feed | ✓ | Following / everyone toggle |
| My profile | ✓ | Stats, score distribution, top genres, essentials (pin 6), recent ratings grid (3-col), taste DNA, taste collisions, taste contradictions |
| Friends | ✓ | Search bar, follow/unfollow, follow-back, suggested accounts |
| Login | ✓ | Email, Google OAuth, Spotify OAuth; Kakao + Apple stubbed (coming soon) |
| Onboarding | ✓ | 3-step setup |
| Other user profiles | ✓ | Taste DNA, score distribution, top genres, essentials, recent ratings grid, taste collisions/contradictions |
| Settings | ✓ | Edit display name, username, bio |
| Notifications | ✓ | Mark-all-read |
| Listen Later | ✓ | Basic |

### Still missing vs web

- **Home personalized feed** — static genre carousels only; web shows a dynamic personalized feed
- **Settings** — web has 5 organized tabs (account, preferences, notifications, privacy, danger zone)
- **Notifications** — web has filters + clear all
- **Listen Later** — web has full list management
- **Help page** — searchable FAQ + contact form
- **Privacy & Terms** — legal pages

### Architecture notes (mobile)

- **No native modules** — intentionally avoids packages that require a dev build (no `react-native-reanimated`, no `react-native-gesture-handler`). Drag-and-drop rankings will need EAS build when added.
- **Supabase client** — configured with `AsyncStorage` for session persistence and PKCE OAuth support.
- **Spotify search** — proxied through the web app (`EXPO_PUBLIC_API_URL/api/search`); mobile has no direct Spotify credentials.
- **Recommendation pool** — both web and mobile query the `recommendable_releases` view (albums + EPs only, must have cover art). Change the view definition once to affect both apps.
- **OAuth deep link** — `sillajuku://auth/callback` must be in Supabase Redirect URLs allowlist.
- **FK schema** — all `user_id` columns reference `profiles(id)` (not `auth.users`), making PostgREST joins traversable within the public schema. Cascade chain: `auth.users` → `profiles` → all dependent tables.

---

## Architecture notes

- **DB-first:** Album and artist data cached to DB on first visit — Spotify only called on cache miss. `saveBasicReleases` is now called from `/api/search` AND from the recommendations/personalized routes, so any album returned from Spotify (search or fallback) gets persisted, and future `/album/[id]` loads skip Spotify entirely. Spotify integration is metadata only, not content streaming.
- **Spotify rate limits:** Account-wide client-credentials limit; exceeding it triggers `Retry-After` headers of up to 80+ minutes. Scripts batch at 60 artists/day and exit cleanly on quota hit. Never delete state files mid-run (`scripts/ingest-state.json`, `scripts/expand-state.json`). Restarts no longer cost Spotify calls since the 2026-05-22 Upstash migration.
- **Spotify circuit breaker** (`lib/spotify.ts`, 2026-05-23) — Redis key `spotify:rate-limited-until` stores a timestamp when Spotify returns a 429. While the key is live, all concurrent `spotifyFetch` calls short-circuit immediately via `SpotifyCircuitOpenError` (~30ms Redis ping) instead of each hitting Spotify and waiting up to `MAX_RETRY_WAIT_SEC = 10` seconds. Breaker auto-clears via TTL matching `Retry-After`. 2026-05-24: every fresh 429 also logs `[spotify] 429 path=... retryAfter=...s untilUtc=...` so the offending endpoint is greppable in Vercel logs.
- **Scripts cooperate with the circuit breaker** (`scripts/spotify-circuit.ts`, 2026-05-24) — The five scripts that hit Spotify directly (`backfill-genres`, `expand-catalog`, `ingest-music`, `seed-prestige`, `seed-rankings`) share Spotify credentials with the web server, so a script burst can trigger an account-wide 429 that breaks production. They now (a) refuse to start when the prod breaker is open via `assertSpotifyCircuitClosed()`, and (b) publish their own 429s to the same Redis key via `recordSpotify429(retryAfterSec, source)` so the web app stops hammering Spotify too.
- **Search degrades to DB on Spotify failure** (`/api/search`, 2026-05-24) — when any Spotify call throws (circuit open, 429, network error), the route returns `{ releases | artists, degraded: true }` from `searchReleasesInDb` / `searchArtistsInDb` (ilike against `releases.title` ∪ `releases.artist` and `artists.name`, backed by pg_trgm GIN indexes from migration `20260524000000_search_trigram_indexes.sql`). `AlbumSearchForm` shows an amber banner when `degraded: true`. Tracks return empty array (no local `tracks` table).
- **Spotify endpoint deprecations (late 2024):** `/artists/{id}` no longer returns useful `genres` (mostly `[]`) and `/artists/{id}/related-artists` returns 404. `scripts/backfill-genres.ts` and `expand:related` mode in `scripts/expand-catalog.ts` are therefore dead. Hand-curated overrides for high-value rows: `apps/web/scripts/genre-overrides.json` + `apply-genre-overrides.ts`. Long-tail genre backfill needs a Last.fm rewrite.
- **Album page fallback chain** (2026-05-28: now DB-first) — `getCachedAlbum` (DB row with tracklist) → `getBasicRelease` (DB row without tracklist; still renders a usable page) → `getSpotifyAlbum` (only for genuinely unknown Spotify-ID deep-links) → `notFound()`. Spotify is no longer called when a basic DB row exists — eliminates the per-visitor Spotify cost. Tracklists historically only appeared on Spotify-cached albums; iTunes-sourced rows rendered without a tracklist section. **2026-06-14:** `backfill:tracklists` (iTunes `lookup?entity=song`) fills the `tracklist` column for iTunes-sourced rows — see the catalog pipeline section. The album page already renders whatever's in `tracklist` (and hides the section when empty), so no page changes were needed.
- **Artist page discography** (2026-05-28: now DB-first) — `getArtistReleases` (DB query on `releases.artist_id`) is tried first. `getSpotifyArtistAlbums` only runs when the DB has zero releases for that artist (typical case: freshly-clicked Spotify-only artist not yet ingested). With 4,568 newly-ingested iTunes releases, most Korean artists hit the DB path and skip Spotify entirely.
- **Supabase region:** Seoul. ~180–220ms latency for Western users — acceptable while Korea-focused; address with read replicas at Western expansion.
- **Supabase free tier:** 500MB storage (~100,000 albums). Paid tier ($25/mo) gives 8GB.
- **Service role key** — server-side only for aggregate queries. Never exposed to client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, resets on server restart. Covers artists, albums, artist IDs, album detail, and recommendations.
- **ISR** — artist album pages revalidate every 3600s.
- **Migrations** — all schema changes in `supabase/migrations/`, applied with `supabase db push`.
- **`recommendable_releases` view** — both web and mobile query this view instead of `releases` directly; encodes shared eligibility rules (albums + EPs only, must have `cover_url`). Uses `LOWER(release_type)` comparison — DB stores `'Album'`/`'EP'` with capital first letter. Edit the view migration to change recommendation rules across both apps at once.
- **Native language schema** — `releases` stores `title_native`, `artist_native`, `native_language` (ISO 639-1: `'ko'`, `'ja'`, `'zh'`) alongside English `title`/`artist`. `artists` stores `name_native` and `native_language`. Language is derived from Unicode character ranges (Hangul / Hiragana-Katakana / CJK unified ideographs) — never hardcoded per language. Search queries both romanized and native columns (`name.ilike OR name_native.ilike`). `AlbumCard` shows native names when they differ from the English name (case-insensitive comparison). Adding support for a new language only requires adding artists to the Wikipedia queue — no schema changes needed.
- **Singles filtering** — enforced at every layer: `recommendable_releases` view, `include_groups=album,ep,compilation` in Spotify artist-albums API calls, `.not('release_type', 'ilike', 'single')` on all DB queries, and post-fetch `releaseType === 'Single'` guards in route handlers.
- **CSP (`next.config.mjs`)** — includes explicit `wss://*.supabase.co` for Safari (Safari does not automatically allow WebSocket when only `https://` is listed in `connect-src`), `us-assets.i.posthog.com` for PostHog session replay, and `lh3.googleusercontent.com` for Google OAuth avatars.
- **Server Component error handling** — `RecommendationGrid` wraps Supabase queries in try/catch so a transient network failure (common on mobile) falls through to the Spotify fallback instead of bubbling to the error boundary.
- **Homepage Suspense streaming** (2026-06-11) — `<RecommendationGrid />` is wrapped in `<Suspense fallback={null}>` so the page shell (header, nav) streams to the browser immediately. Without this, Next.js blocked the entire page response on DB queries that could take seconds. `<RevealWhenReady>` still coordinates the fade-in.
- **`releases.genres` GIN trigram index** (2026-06-11) — migration `20260611000000_genres_trgm_index.sql`. `RecommendationGrid` uses `ILIKE '%genre%'` (substring match) which requires a trigram index; without it every category fires a full sequential scan across ~347k rows. These scans were exhausting Supabase's Disk IO Budget and throttling disk throughput to 5 MB/s. Building the index required upgrading to Supabase Pro.
- **Album page ranking badge cache** (2026-06-11) — `album/[mbid]/page.tsx` caches the "In Rankings" badge computation in Redis (`sj:album-rankings:{id}`, 5-min TTL). Pre-cache this was 10–15 queries per page load; post-cache it is a single ~30ms Redis ping on cache hit.
- **Live search suggest endpoint** (2026-06-11) — `/api/search/suggest` is a dedicated lightweight endpoint that bypasses Jina embedding, Spotify, and iTunes entirely. Uses prefix match (`q%` instead of `%q%`) which hits B-tree indexes and is near-instant. Both artist and release queries share a single DB connection. Results cached in Redis (`sj:suggest:{query}`, 10-min TTL). Component: `SearchBar.tsx` — 300ms debounce, 2-char minimum, keyboard nav, loading spinner.
- **Profile page user lookup** (2026-06-11) — replaced `auth.admin.listUsers({ perPage: 1000 })` with a targeted `SECURITY DEFINER` RPC `get_user_id_by_email_prefix` (migration `20260611000001`). Was fetching up to 1,000 users to match one username.
- **Next.js route groups** — all pages live under `app/(main)/` or `app/(auth)/`. Never create directories directly under `app/` without a route group — empty ghost directories cause "No default component for parallel route" errors.

## Known issues

- **`notFound()` returns HTTP 200 instead of 404** on `/album/[mbid]` and `/rankings/[slug]`. The `not-found.tsx` body renders correctly (user sees the friendly "Page not found" page); only the HTTP status code is wrong. Reproduced in both dev and prod with Next.js 14.2.35. Truly nonexistent routes (no `page.tsx` at all) return 404 correctly. Other pages with `notFound()` but without cookie reads (`/artist`, `/genre`, `/explore`) also return 404 correctly. Removing `export const revalidate` and adding `export const dynamic = 'force-dynamic'` did not fix it. Affects SEO and analytics, not user-visible UX. Post-launch fix candidates: (a) Next.js 15/16 upgrade with breaking-change migration, (b) refactor album page to defer all cookie-reading code into a child Server Component that mounts only after `notFound()` check.
