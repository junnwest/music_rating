# Web change prompts

Each numbered block below is a standalone prompt. Hand them to a session one at a
time (or in small batches). They assume the shared constraints in "Global rules"
— paste that once at the top of any session, or trust CLAUDE.md to cover it.

## ► Status board (keep this current)

Build order (dependencies): ~~**#2 + #12 first** (others consume them)~~ →
~~**#1** (creates the … menu)~~ → ~~**#3, #17** (reuse it)~~ → independent page fixes
(~~#5, #10, #11, #18~~) → larger surfaces (~~#4~~, **#6, #7, #8, #13, #14**, ~~#15~~,
~~#16~~, ~~#9~~).

| # | Task | Status |
|---|------|--------|
| 2 | Quick-rate gauge redesign + new color ramp | ✅ **done** (2026-07-19) |
| 12 | Global loading animation / skeletons | 🟡 **partial** — `Loading.tsx` shipped; applied to album + artist + mix |
| 11 | No raw ID during album/artist load | ✅ **done** (2026-07-19) |
| 18 | Home — remove "Go to charts" | ✅ **done** (2026-07-19) |
| 1 | "Not interested" in the … menu | ✅ **done** (2026-07-19) — migration applied |
| 3 | Right-click context menu | ✅ **done** (2026-07-19) |
| 17 | "Add to mix" icon → bookmark | ✅ **done** (2026-07-19) |
| 5 | Album page — star → flower, half-step click | ✅ **done** (2026-07-19) |
| 16 | Album page — flower on cover bottom-right | ✅ **done** (2026-07-19) |
| 10 | Mix page shows nothing (bug) | ✅ **done** (2026-07-19) — root cause was a PostgREST embed |
| 15 | Artist page — grouped discography | ✅ **done** (2026-07-19) |
| 4 | Profile > Stats tab polish | ✅ **done** (2026-07-19) |
| 9 | Profile — @username over display name | ✅ **done** (2026-07-19) |
| 6 | Taste > Graph rebuild | ⬜ not started — **START HERE NEXT** |
| 7 | Refresh + reconstruct taste report | ⬜ not started |
| 8 | Profile — merge list+table, add filters | ⬜ not started |
| 13 | Quick Add — horizontal rows + arrows + See more | ⬜ not started |
| 14 | Quick Add — explore/like genres | ⬜ not started |

### Where to pick up next

1. **#6 + #7 are the next task, and should be one session** — the refresh has to
   feed the graph, so building them apart means building the data path twice.
   #8 is the next-most-self-contained if you want a smaller one.
2. **⚠ Audit every PostgREST embed that crosses a join table.** #10's root cause
   was `mixes → profiles` being ambiguous (`mix_likes` is a second path), so
   `profiles(...)` failed with **PGRST201** on *every* request and the page read
   the null as "mix not found". The same bug was live on the album page's public-
   mixes list. Both now pass `profiles!mixes_user_id_fkey(...)`. Any table with a
   likes/shares join table pointing at `profiles` can have this; the errors are
   invisible because most call sites destructure `{ data }` and drop `error`.
3. **#12 is only half-applied.** `components/sj/Loading.tsx` exists and exports
   `FlowerSpinner`, `PageLoader`, `Skeleton`, `SkeletonLine`, `SkeletonBlock`,
   `SkeletonCover`, `SkeletonCard`, `SkeletonCardGrid`, `SkeletonRows`. Album,
   artist and mix pages use it. **Still to convert** (they all hand-roll
   `animate-pulse` today): `taste/page.tsx:122`, `song/[id]/page.tsx:140`,
   `charts/page.tsx` (3 spots), `notifications/page.tsx:55`, `search/page.tsx:621`,
   `quick-add/page.tsx:269`, `post/[id]/page.tsx:194`, `page.tsx:309` (home),
   `ProfileView.tsx:447` and `:857` (Mixes tab), `ProfileExtras.tsx:69`,
   `HeaderMenus.tsx:104`, `AlbumPeek.tsx`.
4. **Nothing from 2026-07-19 has been clicked through in a live browser.** The
   builds are clean, but the *feel* of #2's new radii (`OFFSET` 36 / `STEP` 34,
   0.1 steps), the new `ScoreBadge` ramp (changed appearance app-wide), every #3
   right-click surface, and the album page's two new rating affordances (#5's
   half-flower hit targets at 22px, #16's gauge button on a 112px mobile cover)
   are judgement calls the user should confirm. #10 and #15 (2026-07-19, pt 2) are
   also unverified in a browser, though #10's two fixed queries *were* run against
   the live DB and now return rows. **#4's rebuilt Stats tab (pt 3) is the biggest
   open visual question** — the histogram's spectrum bars, the dashed average
   marker's placement, and the card grid at mobile width all want a real look.
5. **Migrations on this machine** go through the Management API — there's no
   direct DB URL here. From `apps/web/`:
   `npx tsx --env-file=.env.local scripts/db-exec.ts <migration.sql>`
   (needs `SUPABASE_ACCESS_TOKEN` in `apps/web/.env.local`). The `--sql "..."`
   form runs ad-hoc statements for verification.

---

## Global rules (applies to every prompt)
- Web app only (`apps/web`). Do not touch the iOS app or shared API payloads
  consumed by iOS unless the prompt says so.
- All user-facing strings go through i18n (`useLanguage()` / `t(...)`), with keys
  added for both `en` and `ko`.
- Ratings use the 0.1 scale internally; manual step defaults to 0.5
  (`profile.manual_rating_step`). Anything score-related must work across both.
- Respect CLAUDE.md scope rules: only change what the prompt names. If you spot an
  unrelated problem, note it in text — don't fix it.
- Update `README.md` (state/known issues) and add a line to the current
  `SESSIONS.md` entry after each change.

---

## 1. "Not interested" in the overflow (…) menu → feed the algorithm
**Status: ✅ done 2026-07-19 (Windows). Migration applied to the hosted project.**

Shipped:
- **`apps/web/supabase/migrations/20260719000000_not_interested.sql`** —
  `not_interested(user_id, release_group_id, created_at)`, composite PK (so
  marking twice is a no-op upsert), owner-only `FOR ALL` RLS in the wrapped-auth
  style; deliberately not readable by other users. Same file re-issues
  `get_quick_add_candidates` (20260717000000's body verbatim) with a second
  `NOT EXISTS` against the new table — signature/columns unchanged, so the
  server-side exclusion needs no client change. **Applied 2026-07-19** and
  verified (`relrowsecurity = true`, 1 policy, 2 indexes, function body carries
  the exclusion).
- **`components/sj/AlbumOverflowMenu.tsx`** — the `…` button (styled to match
  `AlbumBookmarkButton`'s cover-overlay pill) **plus an exported
  `OverflowMenuSurface`** that takes a viewport point rather than a button
  element. That split exists for #3: the right-click menu should render the same
  surface at the cursor. It portals to `document.body` (so a menu inside a list
  row or an `overflow-hidden` cover can't clip), clamps to both viewport edges,
  closes on outside-mousedown / Escape / scroll / resize, and defers registering
  the outside-click listener one tick so the opening click doesn't close it.
  Extra actions come in via `items`; **Not interested** is built in and last.
- **`lib/sj/notInterested.ts`** — `fetchNotInterestedIds` / `markNotInterested` /
  `unmarkNotInterested`, all best-effort: a missing table or an RLS refusal
  resolves to "nothing dismissed" instead of throwing, so an unmigrated
  environment degrades to session-only filtering rather than a dead feed.
- **Surfaces:** Quick Add rows (menu bottom-right of the cover, opposite the
  bookmark) and Home **explore** `FeedCard`s (one more `MenuItem` added to the
  existing inline menu rather than swapping the menu out). Both filter at
  *render* against a dismissed `Set`, not by splicing the fetched array — that
  keeps Quick Add's `albums.length`-based pagination offset honest.
- **Scope call:** the **Following** feed is not filtered — those are people the
  user chose to follow, not a recommendation.
- i18n `sj.notInterested.{action,done,undo}` in en+ko. `done`/`undo` are unused:
  no toast/undo affordance was built, the card just disappears. Add one if the
  removal feels too abrupt in the browser.
- Verified `tsc --noEmit` + `next lint` + `next build`. Not browser-verified.

Follow-ups left open: the signal is only *excluded*, never *down-weighted*, and
nothing outside Quick Add + explore consumes it (personalized rails, taste recs).

---

## 2. Quick-rate gauge redesign — "radial sector arc" (awwwards-grade)
**Status: ✅ done 2026-07-19 (Windows). Not yet browser-verified.**

Shipped in `components/sj/FlowerRateControl.tsx` + `lib/sj/display.ts`:
- Flower is **stationary** and stays visible (the `opacity-0` hide is gone); the
  gauge is anchored to the button's *centre*, not the press point.
- Single **fading arc** at the current score's radius, built from 22 short
  strokes with a `sin^1.4` opacity falloff (no gradient math needed), oriented at
  the cursor's angle, ±26°.
- **Dotted horizontal baseline** with whole-star ticks, drawn as two halves
  starting at the dead-zone edge so nothing crosses the flower.
- **Score reveals over the flower** — glyph fades/shrinks out, number pops in on a
  `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot. Glyph and number are stacked in
  one CSS-grid cell (`gridArea: '1 / 1'`) rather than `absolute`, because several
  call sites pass their own `absolute …` in `className`.
- Radii recalibrated: `OFFSET` 36 (dead zone) + `STEP` 34px/star → full sweep at
  ~206px, ~3.4px per 0.1. **Rounds to 0.1**, not 0.5.
- Ramp replaced with an **OKLCh interpolation** at fixed lightness per variant —
  `spectrumFill` (L .92), `spectrumNumber` (L .45), `spectrumRing` (L .63) — over
  5 anchors: deep red 25° → orange 58° → yellow-green 126° → teal 196° → blue
  262°. Out-of-gamut colors are fixed by walking chroma down, not clipping
  channels, so lightness survives. Measured fill/number contrast stays 5.6–6.3
  across the whole 0.5–5.0 range. New export: `spectrumColor(score, L, cScale)`
  for gradients/charts (**use it for #4's histogram and #6's heatmap**).
- `spectrumHue` now returns **OKLCh degrees, not CSS HSL degrees** — no external
  caller relied on it, but don't feed it to `hsl()`.
- ⚠ iOS `Components/ScoreBadge.swift` still uses the old HSL sweep — **new parity
  gap**, deliberately not touched (web-only rule).

---

## 3. Right-click context menu, globally where appropriate
**Status: ✅ done 2026-07-19 (Windows). Not browser-verified.**

Shipped:
- **`components/sj/ContextMenu.tsx`** — deliberately thin, no second popover.
  Exports `useContextMenu(items)`, `useContextMenuFor(build)` (one menu instance
  for a whole list, each row passing itself as the subject — avoids extracting
  every row into its own component just to hold a hook), a `<ContextMenu>`
  wrapper for surfaces that can take an extra div, and `openInNewTab(href)`.
  All of them capture `e.clientX/clientY` and render #1's `OverflowMenuSurface`,
  so clamping/portalling/dismissal are inherited.
  - `stopPropagation()` in the handler → the **innermost** wrapper wins (a track
    row inside a card opens the track menu only).
  - `wantsNativeMenu()` returns the browser's own menu over `input` / `textarea`
    / `select` / `contenteditable` and whenever there's a live text selection.
- **Album covers, globally, in one wiring:** `AlbumPeek` already wraps every
  cover in the app, so `useAlbumContextMenu` hangs off its **existing root node**
  — no new DOM, no per-page changes. New **`AlbumContextMenu.tsx`** is
  self-contained like `AlbumRateButton` (owns the precise-rating modal, the mix
  picker, and its own `ratings` upsert/delete): *Open in new tab · Rate… · Save
  to Mix · Not interested*, the last three session-gated.
- **`AlbumPeek` gained `release?: SJRelease` and `onNotInterested?`.** `release`
  is passed where one was already in scope (`FeedCard`, search, artist);
  **charts still synthesize one from display props**, so their rating modal shows
  the generic "Release" type chip — pass the real record if that bothers you.
- **`ArtistLink.tsx`** — drop-in for `<Link href={`/artist/…`}>` with *Open in
  new tab · Go to artist*. Still a real anchor, so middle-click/⌘-click work
  natively. Used on album (×2), song, and search pages.
- **Album track rows** — *Open song in new tab · Rate…* (one `useContextMenuFor`
  for the list). **Mix rows** — *Open in new tab · Remove from Mix* (owner only).
- i18n `sj.context.{openNewTab,rate,saveToMix,goToArtist,removeFromMix}` en+ko.

**⚠ Landmine found here, worth knowing before #5/#16:** `components/sj/Modal.tsx`
is plain `fixed` markup, **not a portal**, and most covers sit inside a `<Link>`
— a dialog rendered in place has every click inside it bubble to the anchor and
navigate away. `AlbumContextMenu` works around it by `createPortal`-ing its
dialogs to `document.body`. **Portalling `Modal` itself is the real fix** but it
touches every modal in the app, so it was left alone under the scope rule.

Not done: right-click on **profile/user rows** and **post cards** (the original
prompt didn't name them).

---

## 4. Profile > Stats tab — review and perfect the UI
**Status: ✅ done 2026-07-19 (Windows). Not browser-verified.**

The tab moved out of `ProfileView.tsx` into a new **`components/sj/ProfileStats.tsx`**
(ProfileView shed ~140 lines; it now just renders `<ProfileStats items instinctCount />`).
`RatingHistogram.tsx` was **not** touched — despite the name it's the *album* page's
community distribution, a different component with a different data shape.

Issues found in the old tab, and what replaced them:
- **Three different card treatments in one tab** (`rounded-xl bg-ink/[0.05]` strip,
  bare `<section>`s, `rounded-[10px] bg-accent/[0.08]` tiles) → one `StatCard`
  primitive (`rounded-2xl border border-divider/70 bg-surface/40`) + `KpiTile`.
- **`max-w-lg`** pinned the whole dashboard to a narrow column while every other
  tab used the page's full `max-w-3xl` → removed; KPIs are `grid-cols-2 sm:grid-cols-4`
  and the two lower cards are `md:grid-cols-2`.
- **Two undisclosed denominators:** the average was computed over *manual scores
  only* while the histogram included revealed instinct scores, so the "avg" didn't
  describe the chart under it. Now a single `scored` set (one `scoreOf()` applying
  the `INSTINCT_REVEAL_THRESHOLD` rule) feeds the average, the histogram and the
  per-artist averages, and the card header states the count (`fromNScored`).
- **A number on every bar** (dataviz anti-pattern) → selective labels: the tallest
  bucket always, every other bucket on hover, in a fixed-height row so nothing shifts.
- **Bar heights in raw px** (`Math.max(4, … * 72)`) against a `h-24` box → percentage
  heights against `h-32 sm:h-40`, so the chart is actually responsive.
- **Flat `bg-accent` bars** → `spectrumRing(bucketScore)` from #2. `spectrumRing`
  (L .63) rather than `spectrumColor` at a chosen lightness, because it's the one
  variant that reads on both the light and the dark surface without a second value.
  Colour here is redundant with x-position, so nothing is lost to CVD.
- **Added an average reference line** (dashed, `ink/25`) positioned by
  `scoreToPct(score) = ((s*2 - 0.5) / 10) * 100` — bucket *centres*, not edges.
- **Top artists:** the bar track was `bg-transparent`, so bars floated with no
  reference; count column was `w-6` and clipped 3 digits. Now a real `bg-divider/60`
  track, `w-8` + `formatCount`, top 8 instead of 5, and each row also shows that
  artist's average score in the ramp colour. Ties break on average, not insertion order.
- **Rating-mode section** was two ad-hoc tiles → one `SplitBar` (2px segment gap per
  the mark spec) with a legend carrying name + count + percent, so identity is never
  colour-alone. `bg-accent` vs `bg-ink/40` — accent + neutral, no palette validation
  risk. Its `instinct` count is now **elo-only** (`score == null && eloScore != null`)
  so the two segments actually partition instead of double-counting.
- **New low-data states:** no scored ratings → the card says so instead of drawing
  ten empty bars; fewer than 10 → a `lowData` hint under the chart.
- New i18n `sj.profile.{avgShort,statArtists,fromNScored,noScores,lowData}` en+ko.

⚠ `Empty` and `StatCell` stayed in `ProfileView.tsx` — both are still used by the
Rated/Mixes tabs and the header, so they weren't moved.

---

## 5. Album page — star → flower, half-step clickable rating
**Status: ✅ done 2026-07-19 (Windows). Not browser-verified.**

All of it landed in `components/sj/InlineRatingEditor.tsx` — the component is
used by the album page and nowhere else, so nothing downstream moved.

- **Real partial fill.** The old half-star was a fake: the whole lucide `Star`
  rendered at `opacity-50`, so 3.5 and a dimmed 4.0 were indistinguishable. Each
  mark is now two `FlowerGlyph`s on `/icon-flower.svg` — a base at `opacity-25`
  plus a full-opacity copy inside an `absolute inset-y-0 left-0 overflow-hidden`
  span whose width is the fill fraction. Any value renders correctly, which
  matters now that #2 made the gauge resolve to **0.1**.
- **Click targets come from `step`, not from a hardcoded 0.5:**
  `segments = clamp(round(1 / step), 1, 10)` invisible buttons per flower
  (0.5 → halves, 1.0 → wholes, 0.1 → tenths; the cap stops an exotic step from
  spawning hundreds of nodes). Each carries its own value as `aria-label`, runs
  the existing `clampSnap`, and has a `focus-visible` ring.
- `hoverStar: number` became **`hoverValue: number`** so the hover preview can
  show a partial; `onFocus`/`onBlur` mirror it for keyboard traversal.
- **Persistence untouched** — a click still calls `openEditor(v)` / `update(v)`,
  so the debounced auto-save, undo, and remove-rating paths are unchanged and the
  album page's `setRating` is still the only writer.

Left alone deliberately: the numeric score pill next to the row still shows its
own small `FlowerGlyph`, which is now slightly redundant beside a flower row.
Cosmetic, and outside what the prompt named.

---

## 6. Taste > Graph — full interactive rebuild (single prompt)
**Status: ⬜ not started.**

Rebuild the Taste graph in `app/(main)/taste/page.tsx` into an interactive,
awwwards-grade visualization. One comprehensive change.

**Genre bubbles (agar.io + heatmap language):**
- Render genres as **soft circles** whose **area ∝ the user's mass in that genre**
  (count/weight of rated albums), positioned by similarity, colored as a **heat
  map** (intensity = affinity/rating). Fluid, organic look — soft edges, gentle
  drift/settle animation.
- **Click a genre → Prezi-style zoom** into it: the camera smoothly zooms/pans so
  that genre fills the view and its **subgenres** appear as their own bubbles,
  sized by their area within the parent. Zoom back out to return.

**Side panel:**
- When a genre/subgenre is focused, show a side panel listing **the user's rated
  albums in that genre/subgenre** (cover, title, score) and a few
  **recommendations** in that genre (from the recommendation/personalized source).

**Year chart:**
- Replace the current year bar chart with a **histogram over years** (rated albums
  per year) with a **trend line overlaid** (e.g. moving average / regression).

Use the `dataviz` skill. Keep it performant (canvas/SVG as appropriate) and smooth
on mobile. Reuse existing taste data endpoints where possible; note any new
aggregation you need.

Acceptance: genres render as heat-mapped area-scaled bubbles; clicking zooms
Prezi-style into subgenres; side panel shows rated albums + recs for the focus;
year view is a histogram + trend line; all interactive and smooth.

---

## 7. Refresh the Taste page + reconstruct the report
**Status: ⬜ not started.**

Add a way to **refresh/rebuild** the taste report, and improve how it's built.

- Add a visible **Refresh** control on the Taste page that recomputes the taste
  profile/report on demand (with a loading state — see #12), rather than only
  showing a stale cached payload.
- Review how the taste report is currently assembled and **reconstruct it for
  quality** — judge the best structure (sections, ordering, what's most insightful
  to show). Note: the vector math lives in Node / the Micro DB and profiles are
  trigger-maintained (see memory `taste-system-architecture`) — respect that; the
  web should trigger/read a rebuild, not reimplement the math client-side.
- Make sure the refresh feeds #6's graph too (consistent data).

Acceptance: user can refresh the taste report and see it recompute; the resulting
report is better-organized and clearly structured.

---

## 8. Profile — merge list + table view, add list-view filter
**Status: ⬜ not started.**

In `components/sj/ProfileView.tsx` (Rated tab, `displayMode` list/posts/table):

- **Merge the `list` and `table` display modes** into one unified view (decide the
  best single presentation — e.g. a responsive list that shows table-like columns
  on wider screens). Keep `posts` as the separate mode if it's meaningfully
  different; otherwise fold it in too and simplify the toggle.
- Add a **filter** to the (now unified) list view: at minimum by score range and
  by release type (album/EP/single), plus sort (date rated, score, title). Make it
  responsive and keyboard-accessible.

Acceptance: one merged list/table view with working filters + sort; no dead toggle
buttons left behind.

---

## 9. Profile — prioritize @username (handle) over display name
**Status: ✅ done 2026-07-19 (Windows). Presentation only — no query or payload changed.**

Audited every user-row surface first; **most of the app already led with the
handle** via `profileHandle()` (`lib/sj/data.ts`), so only two places were wrong:

- **Profile header (`ProfileView.tsx`).** Was `displayName || @handle` on one line
  with the handle demoted to a trailing muted span — i.e. the *handle* was the
  fallback. Now `@handle` is the 16px semibold line and the display name is a
  13px muted line beneath it, omitted entirely when unset.
- **`FollowListModal` rows.** Same inversion (display name bold, handle muted).
  Now `@username` bold with the display name secondary, and the display-name line
  is suppressed when there's no username to distinguish it from.

Already correct, left alone: `LikersModal`, `TrackLikersModal`, `CommentsModal`,
`TrackCommentsModal` (all `@{profileHandle(...)}`) and `notifications.tsx`
(`@${actor.username ?? actor.display_name}`). **The search page has no user
results at all**, contrary to the prompt's guess — nothing to change there.

---

## 10. Fix the Mix page — clicking a mix shows nothing
**Status: ✅ done 2026-07-19 (Windows). Queries verified against the live DB.**

**Root cause: `PGRST201`, not RLS and not the id.** The page opened with

```
.from('mixes').select('*, profiles(username, display_name)')
```

and `mix_likes` gives PostgREST a *second* `mixes ↔ profiles` relationship
(`mix_likes_mix_id_fkey` + `mix_likes_user_id_fkey`), so the embed is ambiguous
and the request **failed 300 Multiple Choices on every mix, public or private**.
The old code only destructured `{ data }`, so a hard error arrived as `data:
null` and hit the `if (!m) return` branch — indistinguishable from "no such mix".
The `mix_items` query was fine all along; nobody ever got that far.

Shipped in `app/(main)/mix/[id]/page.tsx`:
- Embed now pins the FK: **`profiles!mixes_user_id_fkey(username, display_name)`**.
  Verified against the hosted project with the anon key — mix row + author now
  return, and `mix_items` returns its 2 rows with covers/titles.
- **Same bug fixed in `album/[id]/page.tsx:272`** ("in public mixes"), which used
  the identical bare embed and had therefore been silently rendering empty. It's
  a surface that links *into* the mix page, so it was in scope.
- **Errors are no longer swallowed.** Both queries capture `error`, log it, and
  render a `sj.common.loadError` + `sj.common.retry` state (existing keys, no new
  i18n) that re-runs the fetch via a `reloadKey`. A dropped `error` is what let
  this hide for so long.
- **Fetch gated on `useSession().ready`** — a separate, real latent bug: private
  mixes are owner-only under RLS, so a fetch racing session restore would read as
  "not found" and never retry. Matches home/search/taste.
- A `console.warn` when `mix_items` returns rows but every `release_groups` embed
  is null — that state otherwise looks exactly like an empty mix.
- **#12 skeleton** replaces the bare `…`: title + meta line + `SkeletonRows`,
  matching the real layout so nothing jumps.

Not done: `ProfileView.tsx`'s Mixes tab still has its own `…` loader (line ~857)
— left for #12's rollout.

---

## 11. Album & Artist pages — stop showing the raw ID during loading
**Status: ✅ done 2026-07-19 (Windows).**

Root cause was `app/(main)/artist/[id]/page.tsx` rendering `{name || rawId}` as
the `<h1>` — for a UUID route the name starts empty, so the bare UUID painted
until the `artists` row landed. Now it renders a `SkeletonLine` instead, the
avatar gets a skeleton circle while unknown, and the tab body's bare `…`
placeholder became `SkeletonRows`. The **album page never rendered its id** (its
early-return skeleton already covered the gap) — that skeleton was rebuilt on the
shared primitives for consistency. Original text of the prompt:

- Replace that with a **skeleton/placeholder** (title bar, cover block) until the
  real title/name arrives — never render the id as visible text.
- Tie into the global loading treatment from #12.

---

## 12. Global loading animation where needed
**Status: 🟡 partial — component shipped 2026-07-19, rollout incomplete.**
See "Where to pick up next" at the top for the exact list of remaining call sites.

- Create a shared loader (`components/sj/Loading.tsx`): a branded flower spinner +
  reusable skeleton primitives (line, block, cover, card). ✅ done
- Apply to: album ✅, artist ✅, mix ⬜, taste ⬜, profile ⬜, quick-add ⬜,
  search ⬜ — anywhere a data fetch currently leaves a blank or janky gap. Prefer
  skeletons that match the final layout over spinners where possible.
- Keep it subtle and fast; respect `prefers-reduced-motion`. ✅ (every animation
  carries `motion-reduce:animate-none`)

---

## 13. Quick Add — horizontal scroll rows, arrows, and "See more"
**Status: ⬜ not started.**

On the Quick Add page (`app/(main)/quick-add/page.tsx`):

- Present candidates as **horizontally scrolling rows** (by seed/artist/genre
  grouping) with a visible scrollbar/affordance.
- Add **left/right arrow buttons** to page through each row (hidden at the ends,
  keyboard accessible).
- Add a **"See more"** at the end of each row that opens a full list/grid of the
  similar items for that group.

Acceptance: Quick Add rows scroll horizontally with working arrows; "See more"
opens the expanded list of that group's items.

---

## 14. Quick Add — explore other genres + set liked genres
**Status: ⬜ not started.**

On the Quick Add page:

- Add an **"Explore other genres"** affordance that lets the user browse candidate
  albums by genre beyond their seeded ones.
- Add a way to **mark genres as liked**, feeding the recommendation/seed source
  (persist the preference; coordinate with the taste/seed system rather than a
  throwaway local flag).

Acceptance: user can browse albums from other genres in Quick Add and mark genres
as liked, and that preference persists and influences future candidates.

---

## 15. Artist page — organized discography (albums / EPs / singles) + sort/group
**Status: ✅ done 2026-07-19 (Windows). Not browser-verified.**

The Albums tab in `app/(main)/artist/[id]/page.tsx` is now a `<Discography>`
component (the data source is the `get_artist_release_groups` RPC / an
`artist_display` `ilike`, **not** `/api/artist-albums` as the prompt guessed):

- **Sections in a fixed order:** Albums · EPs · Singles · Compilations ·
  Soundtracks · Other, each with a count, and empty sections omitted. Those six
  are the actual distinct `release_group_type` values in the catalogue (checked:
  single 195k / album 140k / compilation 82k / ep 39k / soundtrack 18k); anything
  unrecognised falls into **Other** rather than minting a section per stray value.
- **Two pill controls** (`Segmented`, plain buttons so tab/enter work): group
  **By type** vs **All** (one chronological list), and sort **Newest / Oldest /
  A–Z**. Grouping is a pure `useMemo` view over the already-fetched `releases`,
  so toggling never refetches.
- **Undated releases sort last in both directions** — an absent
  `first_release_date` is not "year 0", and a discography that opens with the
  undated rows looks broken.
- Row markup is unchanged, just extracted to `ReleaseRow` (AlbumPeek + hover
  bookmark + rate gauge + score chip all intact).
- **`typeLabelKey` gained `compilation` + `soundtrack` cases**, with matching
  `sj.type.*` keys in en+ko. The old row built its type label by hand-capitalising
  the raw column, which was untranslated; now every row goes through i18n. This
  also improves the mix page and anywhere else `typeLabelKey` is used.
- New i18n `sj.artist.{groupAlbums,groupEps,groupSingles,groupCompilations,
  groupSoundtracks,groupOther,groupByType,groupAll,sortNewest,sortOldest,
  sortTitle,oneRelease,nReleases}` in en+ko.

⚠ The RPC still caps at **60 releases** — a prolific artist's discography is
truncated before grouping ever sees it. Unchanged (out of scope), but grouping
makes the cap more visible than a flat list did.

---

## 16. Album page — flower at bottom-right of the cover for quick/gauge rate
**Status: ✅ done 2026-07-19 (Windows), in the same pass as #5. Not browser-verified.**

- `Cover` on the album hero is now wrapped in a `relative` box
  (`w-28 h-28 md:w-64 md:h-64`) with an **`AlbumRateButton`** absolutely placed
  at `bottom-1.5 right-1.5 md:bottom-2.5 md:right-2.5`, `size={32}`.
- **Hidden in `instinct` mode** — a 0–5 manual score isn't that mode's rating
  model, and the page shows the Elo affordance there instead.
- **Syncing with #5's row needed two new optional props on `AlbumRateButton`**,
  both backwards-compatible (its ~10 other call sites pass neither):
  - `score` — a controlled value the page pushes down. It's mirrored into
    internal state via an effect rather than rendered directly, so a drag shows
    its own optimistic value instead of lagging on the page's refetch.
  - `onScoreChange` — fired **after** the write resolves, so the album page's
    `loadRatings()` refetch reads the committed row.
  The component's internal `score` state was renamed `shown` to make the
  "optimistic display value, not source of truth" role explicit.
- **Bug fixed in passing:** `saveModal`'s delete branch used to `return` early;
  a rating removed via the precise modal would have skipped the new callback. It
  now falls through to one shared exit.

⚠ The button writes `ratings` itself (that's `AlbumRateButton`'s whole design),
so the album page now has **two writers** for the same row — its own `setRating`
and the button's upsert. They're identical statements against the same
`onConflict`, and `onScoreChange` re-syncs the page after, but that's worth
knowing before adding a third rating surface here.

---

## 17. Change "add to mix" icon → bookmark, globally where applicable
**Status: ✅ done 2026-07-19 (Windows).**

Swapped to lucide `Bookmark`, behavior untouched (all still open
`MixPickerModal`):
- `FeedCard.tsx` overflow "Save to Mix" (was `ListMusic`)
- `PostRatingOptions.tsx` add-to-list row (was `PlusSquare`)
- `album/[id]/page.tsx` header action (was `ListPlus`)
- `AlbumBookmarkButton.tsx` "Add to another Mix" row (was `ListMusic`) — the odd
  one out, since the button that opened that menu was already a bookmark
- #3's album context menu uses `Bookmark` for "Save to Mix" from the start

**Deliberately left as `ListMusic`** — icons that denote *a mix* rather than *the
act of adding to one*: `MixPickerModal`'s per-mix rows, the profile Mixes tab,
the album page's "in public mixes" list, and the home empty states.

---

## 18. Home — remove "Go to charts" under Trending
**Status: ✅ done 2026-07-19 (Windows).**

Removed the `<Link href="/charts">{t('sj.home.viewCharts')} →</Link>` at the end
of `TrendingRail` in `app/(main)/page.tsx`, plus the now-dead `sj.home.viewCharts`
key from both `lib/i18n/en.ts` and `lib/i18n/ko.ts`. `Link` and `t` are both still
used elsewhere in that component, so no imports changed. Charts remain reachable
from the sidebar.
