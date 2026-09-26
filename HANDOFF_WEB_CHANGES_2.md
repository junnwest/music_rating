# Handoff: WEB_CHANGE_PROMPTS_2, checkpoint 2026-09-26

Paste this into the next chat: *"Continue from `HANDOFF_WEB_CHANGES_2.md`."*
The spec is [`WEB_CHANGE_PROMPTS_2.md`](WEB_CHANGE_PROMPTS_2.md). Its status board is updated.

## Where things stand

P1–P8 are **written, and `tsc --noEmit` passes** (ignore the stale `.next/types` errors; they come from deleted routes). Every `t('…')` key resolves in en and ko. **Nothing is committed yet.** Nothing has been through `next lint`, `next build`, or a browser check.

P9 (Popular searches) has **not been started**. It's still ⚠ "confirm" in the spec. Ask Jun first, or build it as the spec describes.

## To do, in order

1. **Verify:** from `apps/web`, run `npx tsc --noEmit`, `npx next lint`, and `npx next build`. Fix whatever they find.
2. **Click through with `/browse`**, signed in, at desktop (≥1280 px and ~1024 px) and phone (~375 px) widths:
   - **P1:** Bookmark an album and a song. The "Saved to X · Change" dropdown:
     - follows its anchor while you scroll, and fades out when the anchor leaves the screen or after ~4s
     - Change lets you toggle mixes and create a new one
     - Remove works
     - a filled bookmark does **not** unsave
     - signed out, you get the auth prompt
     - the label reads "Save to {mix}" (no raw `sj.listenLater.title`)
   - **P2:**
     - Home card: bookmark sits left of `…` in the header; "Save to another mix…" is in the `…` menu
     - Add page covers: `…` top-left, bookmark top-right, rate bottom-right
     - The artist name links to the artist page (looked up via `lib/sj/artistIds.ts`)
     - Dragging a cover pans the shelf with no ghost image and no navigation
     - `/quick-add` returns 404
     - Song rows now rate the **track**, not the album (this was a logic bug)
   - **P3 (Mix Dock):**
     - The rail shows on the right on home, search, album, artist, song, charts, mix and profile. It's hidden below md.
     - Alt+M toggles it
     - Open, it pushes the page at xl and overlays below that
     - Saving while it's open lands in the dock mix, with a flying cover
     - The switcher updates the target
     - Album rows expand into their tracks
     - Resize works and persists
     - You can drop an album or song link onto it
     - Check for horizontal scroll
   - **P4:** On a mix page:
     - "+ Add" opens the search panel (keyboard: ↑↓, Enter, → to expand an album, Esc to close)
     - Songs appear from `suggest?types=songs`
     - Post works, including "Make public & post" for a private mix
     - The post appears in the home feed (Explore and Following) and in profile Posts mode, with likes and comments working
   - **P5:** Album tracklist:
     - sticky header sorting
     - flower rating per row
     - community average via `get_track_rating_stats`
     - `…` and right-click menu
     - "Rate N unrated" steps through tracks one sheet at a time
     - multi-disc grouping only in track order
   - **P6:** Album comments:
     - tabs: Top / Newest / Highest / Lowest / Following
     - your own comment pinned first, with Edit focusing the inline editor
     - likes, reply thread, Report hides the comment
   - **P7:** Song page:
     - hero, rate, save and `…`
     - inline comment
     - community stats and histogram
     - comments
     - the album mini-tracklist with this track highlighted
     - "Also on" and "More by artist"
     - the not-found state
     - `?rg=` switching
   - **P8:** On Taste, the country bar shows the top countries until ~90% (5 wide / 4 narrow), then "Other (k countries)", which expands. "Unknown" is its own muted slot. Names come from Intl in en and ko. Check it at 360 px.
3. **Pipeline check:** a migration was applied this session (`20260926000000`), so per CLAUDE.md run `pipeline:status` and `pipeline:verify` if the pipeline is running, and log the result in `PIPELINE_CHECKS.md`. (It only adds functions and an index on `reports`; the pipeline's write path is untouched.)
4. **Docs:** add a SESSIONS.md entry and update the README START HERE, roadmap and Known Issues (the README has a new follow-up item below). Then commit on a branch, since the current branch is `genre-taxonomy-phase1`. Confirm the branch with Jun first.
5. **P9:** Confirm with Jun, then build it as the spec describes.

## What was built (map of files)

**P1 mix engine**
- `lib/sj/mixes.ts`: typed helpers (`listMyMixes`, `loadMembershipIndex`, `addToMix`, `removeFromMix`, `membershipFor`, `createMix`, `itemKey`).
- `lib/sj/mixEntries.ts`: loads the albums and songs of one mix.
- `components/sj/MixTargetContext.tsx`: the provider, mounted in `AppShell`. It holds:
  - the D1 target (dock → localStorage `sj-mix-target:<uid>` → Listen Later)
  - an in-memory membership index
  - `add`, `remove`, `createMix`, `saveAndShow`, `openChange`
  - `lastAdded` and `version`
  - the single app-wide popover
  - `add(..., { remember: false })` skips updating "last used". The mix-page add panel uses this.
- `components/sj/SavedToMixPopover.tsx`: the D2 dropdown.
- `components/sj/SaveToMixButton.tsx`: overlay and inline variants, plus an `AlbumSaveButton` shorthand.
- `components/sj/SongChip.tsx`.
- **Deleted:** `AlbumBookmarkButton.tsx` and `MixPickerModal.tsx`. All call sites were migrated: artist, charts, charts/[slug], search, FeedCard, AlbumContextMenu, PostRatingOptions, album page.
- The mix page renders song items.
- The profile Mixes tab counts songs and shows "Listen Later" localized.

**P2**
- Changes in `FeedCard.tsx` and `app/(main)/search/page.tsx`.
- New `lib/sj/artistIds.ts` (batched release→artist id lookup) and `lib/sj/trackRatings.ts`.
- `DragScrollShelf.tsx`: `onDragStartCapture` preventDefault plus `-webkit-user-drag:none`.
- **Quick Add removed:**
  - web: `app/(main)/quick-add/`, `CandidateRow.tsx`, the `quickAdd.*` i18n block (the scroll arrow labels moved to `sj.common`)
  - iOS: `QuickAddView.swift`, the `quickAddBanner`, `SearchView`'s `onGoToSettings` param, and 14 unused `.xcstrings` entries
  - The project uses Xcode synced folders, so no pbxproj edit was needed. **The iOS build is unverified (no Mac).**

**P3**
- `components/sj/MixDock.tsx`.
- `components/sj/AlbumSongPicker.tsx`, which the dock and the add panel share.
- `components/sj/MixMosaic.tsx`.
- CSS `sj-row-in` and `sj-badge-pulse` in `globals.css`, with reduced-motion handling.
- Prefs are stored in localStorage `sj-mix-dock:<uid>`.

**P4**
- `components/sj/MixAddPanel.tsx`, `MixPostComposer.tsx`, `MixPostCard.tsx`, and `lib/sj/mixShares.ts`.
- `/api/search/suggest` takes an opt-in `types=songs`: 3+ characters, a 1.5s abort budget, and a separate cache key. The omnibox is unaffected.
- `CommentsModal` and `LikersModal` now take `mixShareId`.
- Mix posts merge into the home feed (Explore is ranked, Following is chronological, matching iOS) and into your profile Posts mode. In Posts mode they only show when the filters are "all, by date".

**P5 / P6 / P7**
- Migration **`20260926000000_album_song_comments.sql` (applied)** adds:
  - `get_album_comments` and `get_song_comments` (security invoker; the weights are documented in the header)
  - `get_track_rating_stats`
  - `_comment_rank` and `_comment_role_weight` (verified = 1.25; this is the hook for future roles)
  - `_comment_hidden_for` (security definer; covers blocks both ways, actioned or self-reported reports)
  - `idx_reports_rating_id`
- EXPLAIN on the most-rated album: 26 ms. The dataset is tiny (at most 6 ratings per album), so re-check once there's real volume.
- `lib/sj/tracks.ts`: `loadAlbumTracks`, `loadMyTrackScores`, `loadTrackStats`, `formatDuration`.
- `components/sj/Tracklist.tsx` (full and compact modes) and `components/sj/CommentsSection.tsx`.
- The album page's old "Ratings & reviews" list is replaced by ranked comments.
- `ReportModal` gained `onReported`.
- The song page (`app/(main)/song/[id]/page.tsx`) was fully rewritten.

**P8**
- `/api/taste/profile` now sends an additive `charts.countries` (cache key v12). `charts.scenes` is **kept for iOS**, and the world labels still use scenes, per the spec's default.
- `CountryMix` and `countryName` live in `TasteCharts.tsx`. `SceneBar` was removed.

## Decisions made on my own (tell Jun)

- **"Change" in the dropdown toggles mixes on or off.** Picking a mix also makes it the target. It does not *move* the item.
- **The home card keeps "Save to another mix…" in `…`**, because the header bookmark only covers the target mix.
- **The Mix Dock shortcut is Alt+M.**
- **"Comments" means `ratings.review_text`.** Their likes are `rating_likes` (the old `comment_likes` table points at the retired `reviews` table).
- **Bots are neither excluded nor boosted in comment ranking.**
- **"More by artist" ranks the artist's recordings by rating count.** It takes only the first 60 recordings, so the pool is arbitrary.
- **Featured artists on the song page are plain text.** There's no recording-credits table, so only the primary artist is linked.

## Follow-ups to note in README

- Drop the Quick Add RPCs (`get_quick_add_candidates`, genre-prefs #14) once the iOS release without Quick Add is the minimum version.
- iOS parity gaps:
  - song items in mixes on the web dock and add panel (iOS already supports song items)
  - the country chart (iOS still shows scenes)
  - ranked comments
  - the Mix Dock
  - "Popular searches" (P9)
- `get_mix_covers` only returns album covers, so a mix holding only songs shows the icon tile on feed cards.
- The Add page's `%q%` song search is slow for common words (it's the same query as before).
- The mix item reorder (P3 nice-to-have) needs a `position` column. That's proposed, not built.
