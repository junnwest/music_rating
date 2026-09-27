# Web change prompts — round 2 (mixes, add page, album/song pages)

Each **P#** block below is a standalone prompt for its own chat. Paste "Global
rules" + the prompt (or trust CLAUDE.md for the rules). Prompts marked
**⚠ OPEN** still have a decision pending with Jun — resolve it before handing
the prompt off.

## ► Status board

> **Checkpoint 2026-09-26:** P1–P8 built (🟡 = code done + `tsc` clean, not yet lint/build/browser-verified). P9 not started. Handoff: [`HANDOFF_WEB_CHANGES_2.md`](HANDOFF_WEB_CHANGES_2.md).

Build order: **P1 first** (every "add to mix" surface consumes it) →
**P2, P3, P4, P5, P7** in any order, but not in parallel with each other where they touch the same files (noted per prompt) →
**P6, P8, P9** are independent and can run any time, in parallel.

| # | Task | Depends on | Status |
|---|------|-----------|--------|
| P1 | Mix engine: songs in mixes, "last mix" target, Spotify-style saved dropdown, label fix | — | 🟡 built, tsc ✅ — needs lint/build/browse |
| P2 | Home + Add page cover controls, artist link, drag fix, delete Quick Add (web + iOS) | P1 | 🟡 built (iOS build unverified, no Mac) |
| P3 | Mix Dock — foldable right-side tab for mixes | P1 | 🟡 built |
| P4 | Mix page — "+" quick search-add mode, Post to feed | P1 (P3 nice-to-have) | 🟡 built |
| P5 | Album page — tracklist redesign + track right-click menu | P1 | 🟡 built |
| P6 | Album page — ranked comments section | — | 🟡 built, migration applied |
| P7 | Song page — full redesign | P1 | 🟡 built |
| P8 | Taste — replace "scene" with artist country | — | 🟡 built |
| P9 | Popular searches (new) at top of Add page, from clicked/viewed entities | P2 (banner removed) | ⏸ deferred by Jun (2026-09-26) |

---

## Global rules (applies to every prompt)

- Web app only (`apps/web`). Don't touch iOS or shared API payloads iOS consumes unless the prompt says so. Note any new iOS parity gaps in text.
- Every user-facing string goes through i18n (`useLanguage()` / `t(...)`), with keys added for **both `en` and `ko`**. Check that a key resolves. A raw key showing in the UI (like `sj.listenLater.title`) is a bug.
- Ratings use the 0.1 scale internally, with `profile.manual_rating_step` (default 0.5) for manual input.
- Reuse the existing primitives. Don't fork them: `AlbumOverflowMenu`/`OverflowMenuSurface`, `ContextMenu` (`useContextMenuFor`), `AlbumPeek`, `Cover`, `FlowerRateControl`, `DragScrollShelf`, `Loading` skeletons, `ScoreBadge`/`spectrumColor`.
- ⚠ `components/sj/Modal.tsx` is **not a portal**. A modal rendered inside a `<Link>` makes clicks navigate away. Portal new dialogs or popovers to `document.body`.
- ⚠ PostgREST embeds through `profiles` need an explicit FK hint (`profiles!<fk>(...)`). Always check `error`, not just `data`.
- Migrations: from `apps/web/`, `npx tsx --env-file=.env.local scripts/db-exec.ts <file.sql>`. RLS on every new table, in the wrapped-auth style (`(select auth.uid())`).
- CLAUDE.md scope rule: only change what the prompt names. Report other problems in text.
- Verify with `tsc --noEmit`, `next lint`, `next build`. Then use `/browse` to click the change through signed-in at desktop and phone widths. Don't mark done without that.
- Update `README.md` + `SESSIONS.md` and this file's status board after each prompt.
- Always feel free to propose UX improvements beyond the spec. Put them in the final report as suggestions, and build them only if they're clearly inside the prompt's surface.

## Shared design decisions (all prompts must follow these)

**D1 — One "save target".** Every bookmark/"Add to mix" action saves to a single *current target mix*, resolved in this order:
1. If the Mix Dock (P3) is open, the mix shown in the dock.
2. Otherwise the **last mix the user saved to**, persisted in `localStorage` keyed by user id (decided: per-browser is fine). Wrap reads and writes in try/catch. If the stored mix no longer exists, fall through to 3.
3. First-ever save: the default "Listen Later" mix (`mixes.is_default`).

Choosing a mix anywhere (in the dropdown, picker, or dock) updates the target.

**D2 — Spotify-style saved dropdown.** A save is instant (optimistic). A small anchored dropdown then appears under the button: "✓ Saved to **{mix}** · Change". It is **non-blocking**: no backdrop, the page keeps scrolling, and the dropdown follows its anchor or fades out when the anchor leaves the viewport. It auto-dismisses after ~4s, and ignoring it keeps the save. "Change" opens an inline mix list inside the same dropdown (search, pick, "+ New mix"), not a modal. It also offers "Remove from {mix}". No banners or toasts at the page level.

**D3 — Button state.** The bookmark is filled when the item is in **any** of the user's mixes. Clicking a filled bookmark does **not** unsave. It opens the dropdown with the current membership, where Remove and Change live. This avoids accidental removal.

**D4 — Songs are first-class mix items.** They use `mix_song_items` (recording_id + release_group_id for cover and context). They appear everywhere albums do, with a "song" chip.

---

## P1. Mix engine (foundation)

**Goal:** One shared client module for all "add to mix" behaviour. Albums and songs work the same way, the target follows D1, and the UI follows D2 and D3. Every later prompt calls this module rather than touching `mix_items` directly.

Context: `components/sj/AlbumBookmarkButton.tsx` (album-only, always Listen Later, 4s popover), `MixPickerModal.tsx` (album-only multi-select modal), `AlbumContextMenu.tsx`, and `FeedCard.tsx` (its "Save to Mix" menu item opens the modal). The DB already has `mix_song_items` (`supabase/migrations/20260722000000_mix_song_items.sql`), but nothing on web uses it. iOS does: see `apps/ios/.../MixLibraryView.swift` and `AlbumContextMenu.swift` for parity.

Build:
1. **`lib/sj/mixes.ts`**: typed helpers `listMyMixes`, `addToMix(mixId, item)`, `removeFromMix`, `membershipFor(item)`, and `createMix(name, isPublic)`. `item` is `{kind:'album', releaseGroupId} | {kind:'song', recordingId, releaseGroupId}`. Check every error.
2. **`components/sj/MixTargetContext.tsx`**: provider mounted in `AppShell`. It holds the user's mixes (cached, refreshed on change), the current target (D1), `setTarget`, a `dockMixId` slot (P3 fills it), and an event emitter or `lastAdded` signal (P3 animates on it). Persist the last-used target in localStorage (D1).
3. **`components/sj/SaveToMixButton.tsx`**: replaces `AlbumBookmarkButton`. Accepts an album or song item. Variants: `overlay` (the dark pill on covers) and `inline` (plain icon for rows and headers). Implements D2 and D3. Keep a re-export or alias so existing call sites still compile, then migrate them.
4. **Dropdown `SavedToMixPopover`**: portalled, anchored, non-blocking. It has a "Change" view (searchable mix list with checkmarks for membership, "+ New mix" inline create) and Remove.
5. Rewrite `MixPickerModal` on top of `lib/sj/mixes.ts` with song support and new-mix creation, or delete it if the popover covers every use. List the call sites you changed.
6. Update `AlbumContextMenu` "Save to Mix" and `FeedCard`'s menu item to use the engine: save to target and show the popover at the cursor or button.
7. **Bug:** the bookmark hover label shows `sj.listenLater.title`. The key lives at `listenLater.title`, not under `sj`. Fix it by making the label dynamic ("Save to {target mix}") via a proper `sj.mix.*` key.
8. Mix page (`app/(main)/mix/[id]/page.tsx`) must now **render song items** (cover from the release group, a song chip, a link to `/song/[id]?rg=`) alongside albums, ordered by `created_at`. Owners can remove them.

Acceptance: saving an album and a song from any existing surface lands in the target mix. The popover never blocks scrolling. Change and Remove work, including a new mix created from the popover. No raw i18n keys. Signed-out users get the existing auth prompt.

---

## P2. Home + Add page: cover controls, artist link, drag fix, delete Quick Add

Depends on P1. Touches `FeedCard.tsx`, `app/(main)/search/page.tsx`, `DragScrollShelf.tsx`, and the Quick Add files. Don't run it in parallel with P3 if P3 is also editing `search/page.tsx`.

1. **Home (`FeedCard.tsx`):** move the bookmark off the cover and into the card header, **directly left of the `…` button**. Use the `inline` variant of `SaveToMixButton`, sized and aligned to match the `…` hit target, with a tooltip of "Save to {mix}". The cover keeps Not-interested (top-left) and Rate (bottom-right). Remove "Save to Mix" from the `…` menu if it's now redundant, or keep it as "Save to another mix…" (which opens the Change view). Pick one and state why.
2. **Add page (`/search`, `AlbumCard` and song rows):**
   - Add the `…` overflow menu (`AlbumOverflowMenu`) at the **top-left** of each album cover, mirroring the home cover (bookmark top-right, rate bottom-right). It shows on hover or focus, and always on touch.
   - Bookmark → `SaveToMixButton` (D2/D3). Song rows get one too.
   - The artist name becomes a link to `/artist/[id]` via `ArtistLink`. It's currently inside the album `<Link>`, so split the link: title → album, artist → artist. Make sure the data mapping carries the artist id. Add it to the query if it's missing.
3. **Drag bug (Add page shelves):** dragging a cover drags the image ghost instead of scrolling the shelf. Fix it at the source in `DragScrollShelf` (and `Cover` if needed): `draggable={false}` on imgs and anchors inside the shelf, `onDragStart` preventDefault, and `user-select:none` while dragging. Also suppress the click that ends a drag, so releasing on a cover doesn't navigate. Check every other `DragScrollShelf` / `CandidateRow` user gets the fix for free.
4. **Delete Quick Add completely, on web and iOS (decided):**
   - **Web:** remove `app/(main)/quick-add/`, the entry banner at the top of `search/page.tsx` (~L270–L287), and any components, helpers and i18n keys (`quickAdd.*` in en+ko) used only by it. Check `CandidateRow` and `DragScrollShelf` for other users before deleting.
   - **iOS** (an exception to the web-only rule for this item): remove `Main/QuickAddView.swift`, the `quickAddBanner` in `SearchView.swift`, and every navigation reference and localized string used only by them. Remove the file from the Xcode project too (`project.pbxproj`), and build-check if a Mac is available. Otherwise say it's unverified.
   - **DB:** keep `get_quick_add_candidates` and the genre-prefs objects (#14) for now. Already-installed iOS builds still call them. Add a README follow-up: "drop Quick Add RPCs once the iOS release without Quick Add is the minimum version."
   - Grep both apps for dead links afterwards.

Acceptance: home header shows bookmark then `…`. Add page covers show `…` top-left, bookmark top-right, rate bottom-right. The artist name navigates to the artist page. Drag-scrolling over covers pans the shelf with no ghost image and no accidental navigation. `/quick-add` returns 404 and nothing links to it.

---

## P3. Mix Dock — foldable right-side tab

Depends on P1. Touches `AppShell.tsx` and the `MixTargetContext` from P1.

**Concept:** a browser-style vertical side panel on the right edge, available app-wide on pages where saving makes sense (home, add/search, album, artist, song, charts, mix, profile). Closed, it's a slim rail: a bookmark icon plus the target mix's cover stack, with a count badge. Open, it's a ~320px panel that **pushes** content at ≥xl widths and **overlays** below that. **Hidden on mobile (below md)** — decided; the P1 dropdown is the phone UX. Remember open/closed state and width per user (localStorage is fine for UI state).

Panel contents:
1. **Header:** the current mix (name, cover mosaic, item count) as a switcher dropdown listing all mixes, with "+ New mix" inline. Changing it here sets the D1 target. While the dock is open, **the dock mix is the target**.
2. **Item list:** the mix's items, newest first. Albums show a chevron that **expands a collapsible song list**, which shows the album's tracks, with tracks already in the mix marked and a click on a track toggling the song into the mix. Songs show as single rows with a song chip. Each row has hover remove and right-click (open, open in new tab, remove).
3. **Add animation:** when any `SaveToMixButton` saves to the dock's mix, animate a flying cover thumbnail from the source button into the dock (or the rail when closed). The new row slides in and highlights. The rail badge pulses. Respect `prefers-reduced-motion`: fade only.
4. **Nice-to-haves (propose, then build if cheap):** drag a cover from anywhere onto the dock to add it; reorder items by drag (needs a `position` column, so propose a migration first and don't just do it); keyboard shortcut to toggle the dock; "Open mix page" link.

Acceptance: opening the dock and saving from any page lands in the dock mix, with the animation. Switching mixes in the dock changes where bookmarks save, and the P1 dropdown label agrees. Collapsing and expanding album song lists works. The layout doesn't jump or overlap the top-bar omnibox, and there's no horizontal scroll.

---

## P4. Mix page — "+" quick search-add, Post to feed

Depends on P1. Touches `app/(main)/mix/[id]/page.tsx` and the feed components.

1. **"+" add mode (owner only):** a "+" button in the mix header opens an inline search panel on the page, not a modal. It uses the same suggest API as `SearchOmnibox` (`/api/search/suggest`) and extends it to songs if needed (check the route; if songs aren't returned, add them there, which is the only API change allowed). Results render like the Add page, but **the flower rate control is replaced by a "+" button** that adds the item to *this* mix directly, bypassing D1's target. Added items show a ✓ and animate into the list below. Keyboard: type → arrows → Enter adds. Esc closes. Show recent or suggested albums (e.g. from the user's recent ratings) when the query is empty.
2. **Post to feed:** a **"Post"** button (the label is "Post", never "Share") that opens a composer with an optional caption (≤500 chars, per `mix_shares_caption_length`) and a preview card. It writes `mix_shares` (`20260706000015_mix_social.sql`). The mix must be public; if it isn't, the composer offers to make it public first. Mirror iOS `MixShareComposerView.swift` and `MixShareCard.swift`.
3. **Feed rendering:** check whether the web home feed renders `mix_shares` at all. If it doesn't, add a `MixPostCard` (cover mosaic, mix name, caption, owner, likes and comments via `mix_share_likes` and the mix-share comment table, matching `FeedCard` structure) and merge it into the Following feed by `created_at`. Profile posts too, if iOS shows them there. Report what was missing.

Acceptance: the owner can add albums and songs from the "+" panel without leaving the page. Posting creates a `mix_shares` row that shows up in followers' web feeds with likes and comments working. Non-owners don't see "+" and can still Post a public mix (RLS allows any user to share a public mix).

---

## P5. Album page — tracklist redesign + track context menu

Depends on P1. Touches `app/(main)/album/[id]/page.tsx` (tracklist section ~L587+). Coordinate with P6, which touches the same file in a different section.

Redesign the tracklist as a proper list component (extract `components/sj/Tracklist.tsx`):
1. **Row layout:** number (it becomes a play/hover affordance or a rating dot on hover), title (linked to the song page), featured-artist credit if the data has it, duration, **the user's track rating as an inline `FlowerRateControl` or score chip** (same interaction as album covers, replacing the current modal-only button), and the community average as a subtle `ScoreBadge`. Add a hover bookmark (`SaveToMixButton` inline, song variant) and a `…` button at row end.
2. **Header and sorting:** a sticky, compact column header with sort options: track order (default), your rating, community rating, duration. Show the total runtime and "rated X/Y tracks" progress. Keep the multi-disc grouping in track-order sort; flatten it in other sorts.
3. **Rating UX:** the half-step and 0.1 behaviour follows `manual_rating_step`. Optionally add a "rate all remaining" flow that steps through unrated tracks with the keyboard. Propose it; build it if it's clean.
4. **Right-click and `…` menu** (`useContextMenuFor`): Rate…, Add to mix (target, D2), Add to other mix…, Open song, Open in new tab, Copy link. Remove rating if rated.
5. Keep the existing track comments and likes modals reachable from the row.

Acceptance: every action is reachable by click, right-click and keyboard. Sorting is stable and remembered per session. There's no layout shift while ratings load (use skeletons). It works on a phone: the rate control stays reachable and the context menu becomes a long-press or `…`.

---

## P6. Album page — ranked comments section

Independent. Touches the album page (a new section) plus a new RPC. Coordinate with P5 on the same file.

Comments are `ratings.review_text` (plus `comment_likes` from `20260508000001`, and visibility per `20260508000000_comment_visibility.sql`). Right now the album page shows only the viewer's own inline comment.

1. **Server-side ranking:** a SQL function `get_album_comments(p_release_group_id, p_sort, p_limit, p_offset)` (security invoker, respecting comment visibility and blocks) returning the comment, author, score, likes, created_at, author follower count and author role. Do the ranking in SQL (or in a route if it needs Node), not by client-sorting everything.
2. **"Top" score (default sort).** Start from the factors below. Tune and document the weights in the migration header, and note that reordering must never leak private comments:
   - **Engagement:** comment likes, Wilson lower bound or log-damped, so one like doesn't beat substance.
   - **Substance:** length with diminishing returns (log of chars, capped; very short "good" ≈ 0, a wall of text doesn't win on length alone).
   - **Author credibility:** log(followers), plus a **role multiplier** (critic, verified and similar roles, once a role column exists — design the hook now, default 1.0), plus a small boost for authors with many ratings.
   - **Recency:** a gentle time decay (half-life of weeks, not hours; albums are evergreen).
   - **Relevance and diversity:** a small boost when the comment's score diverges from the average (an interesting take); at most N top slots per author; the viewer's followees get a small personal boost.
   - **Penalties:** reported or hidden comments are removed; for near-duplicate short comments, collapse and keep one.
3. **UI:** a "Comments (N)" section below the tracklist, with sort tabs **Top · Newest · Highest rated · Lowest rated · Following**. Each card shows the author (avatar, @username, role badge slot), their flower score, the text (clamped, with "more"), relative time and likes (like button). Paginate with "Show more", and use skeletons while loading. The viewer's own comment is pinned first, with an edit affordance that links to the existing inline editor.
4. Fold in the existing `CommentsModal` if the album page uses it. Don't duplicate lists.

⚠ No user-role column exists yet (the `critic_affiliation` view is about *albums*, not users). Build the multiplier as a parameterised hook and **don't add a role column** without asking.

Acceptance: an EXPLAIN on a popular album is fast (index plan, <100ms). Sorts are deterministic. Private and blocked comments never appear. The weights are documented.

---

## P7. Song page — full redesign

Depends on P1. Touches `app/(main)/song/[id]/page.tsx` (currently 270 lines, minimal).

Redesign it to feel like the album page's sibling, not a stub:
1. **Hero:** the album cover (large, with `AlbumPeek` behaviour), song title, artist (`ArtistLink`, including featured artists), a clickable "from {album} · track N · year" line, duration, and genre chips if the data has them.
2. **Actions row:** a big `FlowerRateControl` (quick and precise, same UX as the album cover), **Add to mix** (`SaveToMixButton`, song variant, D2), `…` / right-click (add to other mix, open album, copy link, not interested if applicable), and Post, if song posts exist (check `ProfileSongPostCard`, and if they do, reuse the song-post flow).
3. **Community:** the average score, rating count and distribution (`RatingHistogram`), and a song comments list using track comments (`TrackCommentsModal` data), shown inline with the P6 ranking approach (reuse the RPC pattern if P6 landed; otherwise a simple Top/Newest sort).
4. **Context:** the "other tracks on this album" mini tracklist (reuse P5's `Tracklist` in compact mode if it exists) with the current track highlighted, other versions or releases of the recording if the data supports it, and "more by this artist" songs.
5. Handle `?rg=` for recordings on several releases, and add loading skeletons and a not-found state.

Acceptance: at parity with or better than iOS `SongDetailView`. Adding to a mix works and appears in the dock (P3). No raw IDs are shown while loading.

---

## P8. Taste — replace "scene" with artist country

Independent. Touches `app/api/taste/profile/route.ts` (scene counts ~L309), `lib/taste/albumVector.ts` (`sceneOf`), `app/(main)/taste/page.tsx` (`SCENE_ORDER`, `SceneBar`), and `TasteCharts.tsx`.

1. Replace the kr/jp/west/other buckets with the **actual `artists.country` codes** (ISO 3166). Aggregate counts per country in the route, and bump the payload version (see the version comments at the top of the route).
2. **Handle the length automatically:** show the top countries until they cover about 90% of the total, or up to N (about 6 on desktop and 4 on mobile), then collapse the rest into "Other (k countries)", with the full list on expand or hover. Unknown or null country gets its own muted "Unknown" slot, never counted in "Other".
3. **Labels:** localized country names via `Intl.DisplayNames([lang], {type:'region'})`, which is en and ko for free. Add a flag emoji only if it renders consistently. Long names truncate with a tooltip. Colors: keep the categorical palette approach (the colour follows the entity; assign by rank with a stable fallback).
4. Keep `sceneOf` where the **clustering and world labels** still use it (for example "2020s · Korean scene"), unless ⚠ Q5 says otherwise. Only the chart and report section change.

Acceptance: a user with 20+ countries sees a tidy bar plus "Other" with no overflow at 360px width. Korean and English labels come from `Intl`. The old cached payloads recompute.

---

## P9. "Popular searches" at the top of the Add page ⚠ confirm

Depends on P2 (P2 removes the Quick Add banner that sits in this spot). Touches `app/(main)/search/page.tsx` (top, above `Discovery`), a new API route, and a migration.

Finding: **no search-based "popular" list exists today.** The top of the Add page is only the search input and the Quick Add banner. The "Popular" shelf further down is prestige-ranked canon from `/api/discovery` and doesn't come from searches. Nothing logs searches except `search_misses`. So this is a *new* feature, built the right way from the start: rank what people **clicked and viewed**, not the raw text they typed.

1. **Log selections, not queries:** a new `search_selections(user_id, entity_type ('artist'|'album'|'song'), entity_id, source ('omnibox'|'add_page'|…), created_at)` table. Insert-only RLS for your own rows. At most one row per user per entity per day (unique index on `(user_id, entity_type, entity_id, (created_at::date))`, insert with on-conflict-do-nothing) to resist spam. Log from `SearchOmnibox` picks, `/search` result clicks and song rows, via one `logSearchSelection()` helper and fire-and-forget.
2. **Ranking:** a SQL function or view over the last 7 days, with a time-decayed count of distinct users per entity. Mix artists and albums, cap one entity per artist so one comeback doesn't fill the row, and drop entities under a minimum distinct-user threshold. Serve it from `/api/search/popular`, cached like suggest (Redis + CDN, ~10 min). If the data is too sparse (early days), fall back to the most-viewed entities, or hide the row. Never show an empty row.
3. **UI:** a single horizontally scrolling row of chips under the search bar, titled "Popular searches". Each chip has a small avatar or cover, a `displayName` (localized) and a type hint. **Clicking a chip opens that artist, album or song page directly**, not a text search. Hide the row while the user is typing (results take over).
4. i18n en+ko. Mention the iOS parity gap in the report; don't build it.

Acceptance: picking an entity from search records one row. The chip row reflects distinct-user picks and is fast (cached). Chips navigate to the entity page.

---

## Decisions log

- **2026-09-26** — D1 target order confirmed (dock → last used → Listen Later). Last-used mix lives in **localStorage**. Quick Add is removed on **web + iOS** (DB RPCs stay until old iOS builds age out). The Mix Dock is **hidden on mobile**. "Popular searches" = the top of the Add page, but nothing search-based exists there, so P9 builds it new (⚠ Jun to confirm that's the intent).

## ⚠ Still open

- **2026-09-26:** Jun chose to skip P9 for now (not built). P1–P8 committed on branch `ux-round-2`.

- **P9** — confirm that a new "Popular searches" chip row (ranked by clicked entities) is what you meant, rather than a change to the existing "Popular" album shelf.
- **P8** — default: only the country chart changes; the taste-world labels ("2020s · Korean scene") keep using scenes, because clustering depends on them. Say so if the labels should switch too.
