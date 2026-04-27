# Handoff: Neiro — Music Album Rating & Cataloging App

## Overview
Neiro (音色) is a music album rating and cataloging web app — think Letterboxd but for albums. The name comes from the Japanese word for "the color of sound." Users rate albums out of 5 stars, write reviews, build a personal catalog, and follow friends to see what they're listening to.

## About the Design Files
The files in this bundle are **high-fidelity design references created as HTML prototypes** — they are not production code to copy directly. Your task is to **recreate these designs in your target codebase** (React, Next.js, etc.) using its established patterns, routing, and component libraries. The HTML files open in any browser and are fully interactive — use them as the visual and behavioral spec.

To open them locally: open `Neiro Hi-Fi.html` in a browser. The canvas lets you pan/zoom; click any artboard to focus it fullscreen.

## Fidelity
**High-fidelity.** These are pixel-precise mockups with final colors, typography, spacing, interactions, and copy. Recreate them faithfully using your codebase's component system. Where your existing components differ slightly (e.g. a design-system button with different padding), prefer the design system — but match color, typographic weight, and layout intent exactly.

---

## Design Tokens

### Colors
```
--color-mint:        #3DFFD1   /* Primary accent */
--color-mint-bg:     #EDFFF9   /* Mint tint background */
--color-mint-dark:   #00453A   /* Text on mint surfaces */
--color-ink:         #111111   /* Primary text */
--color-mid:         #444444   /* Secondary text */
--color-muted:       #888888   /* Tertiary text / labels */
--color-border:      #EBEBEB   /* Dividers, input borders */
--color-surface:     #F7F7F5   /* Card / section backgrounds */
--color-white:       #FFFFFF   /* Page background */
```

### Typography
Font: **Plus Jakarta Sans** (Google Fonts) — weights 400, 500, 600, 700, 800.

| Role            | Size | Weight | Usage                        |
|-----------------|------|--------|------------------------------|
| Display         | 30px | 800    | Page greetings, hero titles  |
| Album title     | 34px | 800    | Album page hero              |
| Section heading | 17px | 700    | Section titles               |
| Card title      | 13px | 600    | Album card primary text      |
| Body            | 14px | 400    | Review text, descriptions    |
| Label / meta    | 12px | 400–500| Artist name, dates, subtitles|
| Micro           | 11px | 500–600| Chips, badges, tags          |

Letter-spacing: `-0.5px` to `-1.2px` on display headings. `+0.5px` on uppercase labels.

### Spacing
Base unit: 4px. Common values: 4, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 52, 56.
Content max-width: **1104px**, centered with `padding: 0 36px`.

### Border Radius
```
4px  — small chips, score badges
6–7px — album art thumbnails
8px  — inputs, buttons, cards
10px — activity feed cards
12px — tweaks panel
24px — search bar pill (full round)
50%  — avatars
```

### Shadows
```
Album art hero:  0 8px 40px rgba(0,0,0,0.09)
Panels/overlays: 0 4px 24px rgba(0,0,0,0.10)
```

### Star Rating Component
- 5 stars, half-step increments (0.5, 1.0 … 5.0)
- Filled: `#3DFFD1` (mint)
- Empty: `#E5E5E0`
- Half: clip the filled star to 50% width
- Sizes used: 11px (inline), 13px (reviews), 14px (cards), 16px (stats), 28–30px (user input)

---

## Screens

### 01 — Homepage (1280px desktop)
**Purpose:** Personalized feed for logged-in users. No hero. Search lives in the navbar.

**Layout:** Full-width nav (60px) → content area (max-width 1104px, centered, `padding: 44px 36px 56px`). Sections separated by 1px `#EBEBEB` dividers with 44px vertical margins.

**Nav:**
- Logo left: `音色 neiro` — "音色" in `#111`, "neiro" in `#3DFFD1`, 16px 800-weight
- Center: search bar pill — `background: #F7F7F5`, `border: 1px solid #EBEBEB`, `border-radius: 24px`, `padding: 8px 16px`, max-width 420px, `flex: 1`
- Right: text links (Home, Activity, Lists) in 13px 500-weight `#888`, then avatar (34px circle, mint bg/border)

**Greeting section:**
- "Good evening, [username]." — 30px 800-weight, `letter-spacing: -1px`
- Subtitle: user stats in 14px 400-weight `#888`

**Sections (repeated pattern):**
Each section has a header row: title (17px 700) + optional subtitle (12px `#888`) left-aligned, "See all →" right-aligned in 12px 500 `#888`.

1. **"Pick up where you left off"** — Horizontal scroll of 6 album cards (152px square art). Each card has an "Rate →" button (dark, `#111` bg, white text, 11px 600, `border-radius: 6px`) overlaid bottom-right on hover.

2. **"Because you love [Artist]"** — Same card layout with ★ score badges on art (mint bg, `#00453A` text, 11px 700, `border-radius: 5px`, `padding: 2px 7px`).

3. **"Friends are listening to"** — 2-column CSS grid. Each card: `background: #F7F7F5`, `border: 1px solid #EBEBEB`, `border-radius: 10px`, `padding: 16px`. Contains 54px art (left) + user avatar (22px) + username + star row + album title + quoted review snippet (2-line clamp).

4. **"Trending in [genres]"** — Same scroll card layout with scores.

5. **"Your Listen Later"** — Vertical list. Each row: 46px art + album title (14px 600) + artist/type-pill + "Rate now →" link right + × dismiss.

---

### 02 — Album Page (1280px desktop)
**Purpose:** View album details, see community rating, submit your own rating, add to listen later.

**Hero section** (`background: #F7F7F5`, `border-bottom: 1px solid #EBEBEB`):
- Max-width container, `padding: 44px 36px 40px`, `display: flex`, `gap: 44px`
- **Left:** 228px × 228px album art, `border-radius: 10px`, `box-shadow: 0 8px 40px rgba(0,0,0,0.09)`
- **Right:** metadata pills row (TypePill) → album title (34px 800, `letter-spacing: -1.2px`) → artist name (17px 500 `#888`) → community stats row → user rating section

**TypePill component:** `background: #F7F7F5`, `border: 1px solid #EBEBEB`, `border-radius: 20px`, `padding: 2px 9px`, 11px 500 `#888`

**Community stats row** (`border-top: 1px solid #EBEBEB`, `padding-top: 18px`, `margin-top: 22px`):
- Average score: 30px 800 ink + "avg / 5" label in 12px `#888`
- Vertical 1px divider (`#EBEBEB`)
- Ratings count: 18px 700 + "ratings" label
- Reviews count: 18px 700 + "reviews" label

**User rating section:**
- "YOUR RATING" label: 12px 600 `#888`, `letter-spacing: 0.6px`, `text-transform: uppercase`
- Star rating: 30px stars (interactive, half-step)
- Helper text: "Tap to rate · half-steps supported" — 12px `#888`
- Review textarea: `background: #FFF`, `border: 1px solid #EBEBEB`, `border-radius: 8px`, `padding: 12px 16px`, `height: 68px`
- Action row: "**+ Listen Later**" outline button (`border: 1.5px solid #EBEBEB`, `border-radius: 8px`, `padding: 9px 18px`, 13px 600 ink) + "**Save rating →**" filled button (`background: #111`, white text, same shape)

**Body** (below hero, max-width 1104px, `padding: 40px 36px 56px`):
- 2-column grid: `gridTemplateColumns: 1fr 1.3fr`, `gap: 52px`
- **Left — Tracklist:** 17px 700 heading, then rows: 00-padded index (12px, `#DDDDD8`) + track name (14px 500) + duration (12px `#888`), each `padding: 10px 0`, `border-bottom: 1px solid #EBEBEB`
- **Right — Reviews:** 17px 700 heading, then review cards: avatar (32px) + username + date + stars, then review text (14px 400, `line-height: 1.65`), `padding: 18px 0`, `border-bottom: 1px solid #EBEBEB`

---

### 03 — Profile Page (1280px desktop)
**Purpose:** User's public profile showing their catalog, stats, and listening habits.

**Header** (`background: #F7F7F5`):
- `padding: 36px 36px 0`, `display: flex`, `gap: 24px`
- Avatar: 82px circle, mint bg/border, initial
- Username: 24px 800, `letter-spacing: -0.6px`
- Location: TypePill
- Joined date: 13px `#888`
- Stats row (5 items, `gap: 32px`): value in 20px 700 ink + label in 12px `#888`. Items: albums rated, avg score (with ★), reviews, followers, following
- Follow button (outline): `border: 1.5px solid #EBEBEB`, `border-radius: 8px`, `padding: 9px 18px`, 13px 600

**Tab bar** (`border-top: 1px solid #EBEBEB`):
- Tabs: All, Albums, EPs, Singles, Compilations — 13px 600, `padding: 12px 20px`
- Active tab: `color: #111`, `border-bottom: 2px solid #111`
- Inactive: `color: #888`, `border-bottom: 2px solid transparent`
- Sort: right-aligned, 12px 500 `#888`

**Body** (`padding: 36px 36px 56px`), 2-column: `1fr 240px`, `gap: 48px`

**Album grid:** `repeat(6, 1fr)`, `gap: 14px`. Each cell: square art (padding-bottom: 100% trick) with score badge bottom-right, album title below in 11px 600 (ellipsis overflow).

**Sidebar:**
1. **Score Distribution:** Bar chart — 10 bars (0.5★ to 5★), height proportional to count, `background: #3DFFD1` for top 3 (4–5★ range), `background: #EBEBEB` for rest, `border-radius: 2px 2px 0 0`
2. **Listen Later:** List of 3 items — 36px art square + album title (12px 500, ellipsis)
3. **Top Genres:** 4 genres with percentage bars — label (12px 500) + pct (11px `#888`) + 4px progress bar (`background: #EBEBEB` track, `background: #3DFFD1` fill, `border-radius: 2px`)

---

### 04 — Search Results (1280px desktop)
**Purpose:** Show album results for a search query with release type filtering.

**Search bar area** (`background: #F7F7F5`, `padding: 24px 36px 20px`):
- Active search bar: `background: #FFF`, `border: 1.5px solid #111`, `border-radius: 24px`, `padding: 11px 20px`, max-width 520px — shows query text in 14px 500 ink
- **Artist match card** (shows when query matches an artist): `background: #EDFFF9`, `border: 1.5px solid #3DFFD1`, `border-radius: 10px`, `padding: 12px 18px` — contains 42px avatar + name (14px 700) + stats (12px `#888`) + "View artist page →" link in `#00453A` 12px 600
- Filter chips row: "All" active (dark bg, white text) then "Albums", "EPs", "Singles", "Live" (surface bg, `#888` text). Shape: `border-radius: 20px`, `padding: 6px 14px`, 12px 600

**Results grid** (`padding: 36px 36px 56px`):
- `repeat(6, 1fr)`, `gap: 22px`
- Each card: 152px art (with score badge) + title (13px 600, ellipsis) + artist · year (11px `#888`) + TypePill

---

### 05 — Auth Page (Sign Up / Login)
**Purpose:** Single auth page with toggle between login and signup.

**Layout:** Minimal nav (logo only, 60px) → centered card (width: 420px), vertically and horizontally centered in the remaining viewport.

**Mode toggle:** Pill toggle at top — `background: #F7F7F5`, `border-radius: 10px`, `padding: 4px`. Active option: `background: #FFF`, `border: 1px solid #EBEBEB`, `box-shadow: 0 1px 4px rgba(0,0,0,0.08)`, `border-radius: 7px`. Labels: "Log in" / "Sign up", 14px 600.

**Heading:** 30px 800, `letter-spacing: -0.9px` — "Welcome back." (login) or "Join neiro." (signup)

**Fields:**
- Label: 13px 600 ink, `margin-bottom: 7px`
- Input: `background: #FFF`, `border: 1.5px solid #EBEBEB`, `border-radius: 8px`, `padding: 12px 14px`, 14px 400
- Focus: `border-color: #111`
- Signup shows: Username → Email → Password
- Login shows: Email → Password (with "Forgot password?" right-aligned link)

**Primary CTA:** `background: #111`, white text, `border-radius: 8px`, `padding: 14px`, full width, 15px 700, centered

**Google SSO:** Outline button, full width, `border: 1.5px solid #EBEBEB`, 14px 600

**Value prop card** (below auth form): `background: #EDFFF9`, `border: 1.5px solid #3DFFD1`, `border-radius: 10px`, `padding: 14px 16px` — title 13px 600 `#00453A` + body 12px 400 `#00453A` at 75% opacity

---

## Interactions & Behavior

### Star Rating
- Tap/click a star to rate
- Hovering half of a star = half-step value
- Clicking again on same value = clears rating
- Animate fill on hover: transition fill color `100ms ease`
- Rating persists per user per album (one rating only)

### Listen Later
- "＋ Listen Later" toggles to "✓ In your list" (outline → mint bg)
- Accessible from album page and homepage listen later section
- Appears in profile sidebar and personalized homepage section

### Navigation
- Active nav item: bold, `color: #111`
- Search bar in nav: clicking expands / focuses; `Cmd+K` shortcut
- Album cards: entire card is clickable → album page
- User avatars/names: → profile page

### Homepage sections
- "Pick up where you left off" — albums the user has added to Listen Later or started
- "Because you love X" — collaborative filtering based on ratings overlap
- "Friends are listening to" — shows 4 most recent friend activities
- Sections are server-rendered; personalization requires auth

### Responsive behavior
- Below 1024px: switch to 2-column album grids, single-column friends section
- Below 768px: mobile layout — single column, bottom nav bar, search full-width
- Nav collapses to logo + avatar + hamburger at mobile

---

## Score System
- All ratings are **out of 5 stars** with **half-step increments** (0.5, 1.0, 1.5 … 5.0)
- One rating per album per user (update allowed)
- Community average displayed as `X.X` (e.g. "4.5") with "avg / 5" label
- Score badges on album art: `★ X.X` format, mint bg, dark green text

---

## Release Type Labels
Albums are tagged with one of: **Single** / **EP** / **Album** / **Live** / **Compilation**
Displayed as TypePills — `background: #F7F7F5`, `border: 1px solid #EBEBEB`, `border-radius: 20px`, 11px 500 `#888`.

---

## Assets
- **Album art:** Real album cover images (JPEG/PNG) replace the diagonal-stripe placeholders in all design files. Placeholders are labeled "album art" in monospace.
- **User avatars:** Real profile photos or generated initials avatars
- **Logo:** "音色 neiro" typeset in Plus Jakarta Sans 800 — no separate image asset needed

---

## Files in this Package

| File | Description |
|------|-------------|
| `Neiro Hi-Fi.html` | **Primary reference.** All 5 hi-fi pages on an interactive canvas. Open in browser. |
| `Neiro Wireframes.html` | Early wireframes — structural reference for all 5 pages |
| `Neiro Variations.html` | Layout explorations — 3 homepage directions, 3 album page directions, plus refined versions |
| `design-canvas.jsx` | Support file required by the canvas layout (do not ship) |

> Open any HTML file in a browser, pan/zoom the canvas, and click an artboard to focus it fullscreen. The files require an internet connection to load fonts and React from CDN.
