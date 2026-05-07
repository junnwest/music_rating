# Sillajuku — Rank Builder Page
## Handoff Document

---

## 1. Product Context

**Sillajuku** is a music discovery and rating web application. Users browse albums, listen to tracks, and build ranked lists of their favorite music.

This document specifies the **Rank Builder** page — a dedicated interface where users construct tiered rankings of albums via drag-and-drop.

---

## 2. Page Purpose

The Rank Builder allows users to:
- Create a ranked list of albums (1st, 2nd, 3rd place, etc.)
- Drag albums between tiers or drop between slots to create new tiers
- Browse a suggested album pool and add albums to their ranking
- Search for specific albums by title or artist
- Save their completed ranking

---

## 3. Design System

### Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#FFFFFF` | Page background |
| `--ink` | `#111111` | Primary text, buttons |
| `--inkLight` | `#444444` | Secondary text, rank numbers |
| `--muted` | `#888888` | Placeholder text, borders, inactive states |
| `--surface` | `#F7F7F5` | Card backgrounds, hover surfaces |
| `--border` | `#EBEBEB` | Dividers, card borders, dashed buttons |
| `--mint` | `#3DFFD1` | Accent color — drag highlights, active states, CTAs |
| `--mintDark` | `#00453A` | Mint contrast text |
| `--placeholder` | `#C0C0BE` | Empty state text |

### Typography
- **Font**: `Inter`, weights 300–800
- **Header logo**: 18px, weight 800, letter-spacing -0.5px
- **Page title**: 28px, weight 800, letter-spacing -0.8px
- **Rank numbers**: 32px, weight 800, tabular-nums
- **Album titles**: 10–11px, weight 600
- **Artists**: 9–10px, weight 400, muted color
- **Section labels**: 11px, weight 700, uppercase, letter-spacing 0.08em

### Layout
- **Container**: max-width 1280px, 2-column grid (`1fr 380px`)
- **Left panel** (builder): border-right 1px solid `--border`, padding 32px 28px
- **Right panel** (picker): sticky top 56px, height `calc(100vh - 56px)`, overflow-y auto
- **Header**: sticky top, height 56px, border-bottom 1px solid `--border`
- **Responsive** (≤900px): single column, left panel stacks above right

---

## 4. Data Model

### Album Object
```typescript
interface Album {
  id: string;        // e.g. 'a1', 'a2'
  title: string;     // Album title
  artist: string;    // Artist name
  year: string;      // Release year
  color: string;     // Hex placeholder color for cover art
}
```

### Ranking State
```typescript
type Ranking = Album[][];  // Array of tiers, each tier is an array of albums
// Tier index = rank position (0 = 1st place, 1 = 2nd place, etc.)
// Multiple albums in one tier = tied rank
```

### Album Pool
- Total pool: **28 albums** (expandable)
- **Display pool**: `POOL_SIZE = 8` — only 8 unadded albums shown at a time
- When an album is added to the ranking, it disappears from the suggested grid and the next album from the pool slides in to maintain 8 visible items.

---

## 5. Component Breakdown

### 5.1 Header
- Left: Back link ("← Rankings") + Logo "sillajuku"
- Right: "Save Ranking" button (solid black bg, white text, 8px 20px padding, 8px radius)

### 5.2 Left Panel — Builder

#### Builder Header (sticky)
- Title: "Greatest Album of All Time" (or dynamic ranking title)
- Subtitle: "Drag albums to rank. Drop between slots to create a new tier."

#### Tier List
Each tier row consists of:
1. **Drop Zone** (8px tall, expands to 48px on drag-over) — dropping here creates a new tier at this position. Shows "New rank" label when active.
2. **Tier Row** (flex, gap 16px):
   - **Rank Number** (48px wide, right-aligned, 32px weight 800). Color: `--border` when empty, `--inkLight` when filled, `--muted` when tied.
   - **Tier Body** (flex wrap, min-height 64px, 4px padding, 10px gap). Empty state shows dashed "Drop album here" placeholder. Drag-over shows `--surface` bg + 2px `--mint` inset shadow.

#### Album Card (inside tier body)
- 64px × 64px cover square (border-radius 6px, border 1px solid `--border`)
- Placeholder text: first 2 letters of title
- Meta below: title (ellipsis) + artist (ellipsis)
- **Remove button** (×) appears on hover, top-right, 18px circle
- `cursor: grab`, `draggable: true`
- Dragging state: `opacity: 0.3`

#### Final Drop Zone
Last drop zone after all tiers — dropping here creates a new tier at the bottom.

#### Add Tier Button
- Text: "+ Add Tier"
- Style: 12px, weight 600, dashed `--border` border, no bg
- Hover: `--inkLight` text + border
- **Drag-over state**: `--mint` border, `--mintDark` text, `rgba(61,255,209,0.08)` background
- **Behavior**: Click adds empty tier. Drop adds a new tier containing the dragged album.

### 5.3 Right Panel — Picker

#### Search Input
- Placeholder: "Search for an album…"
- Style: `--surface` bg, `--border` border, 10px radius, 10px 14px padding
- Focus: `--ink` border
- Real-time filtering

#### Suggested Grid
- 2-column grid: `repeat(2, minmax(0, 1fr))`, gap 12px
- **Normal mode** (no search query): Show up to `POOL_SIZE` unadded albums only. Added albums are completely hidden.
- **Search mode** (query present): Show all matching albums. Already-added ones get the `already-added` class (dimmed cover, "Added" badge, no click/drag).

#### Suggested Card
- Cover: 1:1 aspect-ratio, 8px radius, placeholder color bg, first 2 letters
- Hover: translateY(-2px)
- **Add overlay** (hidden by default, shows on hover): mint bg badge saying "Add"
- **Already-added overlay** (always visible): faded white overlay, badge says "Added" in muted gray
- Click: adds album to first empty tier, or appends new tier if none empty
- Draggable: same ghost behavior as tier cards

---

## 6. Interaction Specifications

### 6.1 Drag & Drop — From Tier to Tier
- **Drag start**: Card opacity → 0.3, ghost element follows cursor (64px cover with 2px `--mint` border, rotated 3deg)
- **Drag over tier body**: background → `--surface`, inset 2px `--mint` shadow
- **Drop on tier body**: Album moves to that tier. If same tier, no-op.
- **Drag over drop zone**: zone expands to 48px, shows "New rank" badge
- **Drop on drop zone**: Creates new tier at that position containing the album. Ranks renumber.
- **Drag end**: Ghost hidden, all drag-over states cleared.

### 6.2 Drag & Drop — From Suggestions to Builder
- Same ghost behavior
- Can drop on: tier body (add to tier), drop zone (create tier), or Add Tier button (create new bottom tier)
- From suggestions: `fromTier = -1` in data payload

### 6.3 Drag & Drop — On "Add Tier" Button
- **Drag over**: Button gets `drag-over` class (mint border, mintDark text, subtle mint bg)
- **Drop**: Creates new tier at bottom (`ranking.push([album])`), bypasses empty-tier cleanup
- This is the **only** drop target that auto-creates a tier + places the album in one action.

### 6.4 Click to Add from Suggestions
- Finds first empty tier (`tier.length === 0`) and pushes album there
- If no empty tiers exist, appends new tier (`ranking.push([album])`)

### 6.5 Remove Album
- Click × on any tier card → removes album from that tier
- Does NOT delete empty tiers (they remain as placeholders)

### 6.6 Search Behavior
- Input is trimmed, case-insensitive
- **Empty query**: Show only unadded albums, max `POOL_SIZE`, hide all added albums completely
- **With query**: Show all matches (both added and unadded). Added ones show "Added" label and are non-interactive. Unadded ones show "Add" label and work normally.

### 6.7 Tier Reordering (Bonus)
- Drag the tier row itself (not an album card) to reorder tiers
- Drag start: `opacity: 0.4`
- Drop on another tier: insert dragged tier before target tier

### 6.8 Save
- Click "Save Ranking" → toast notification slides up from bottom center
- Toast: "Ranking saved", auto-dismiss after 2 seconds

---

## 7. State Management Logic

### Drop Handler
```typescript
function handleDrop(albumId: string, fromTier: number | null, toIndex: number, mode: 'into' | 'between' | 'addTier') {
  // 1. Find album (from pool if fromTier === -1 or null)
  // 2. Remove from source tier if fromTier >= 0
  // 3. Place based on mode:
  //    - 'into': ranking[toIndex].push(album)
  //    - 'between': ranking.splice(toIndex, 0, [album])
  //    - 'addTier': ranking.push([album])
  // 4. Clean empty tiers (ONLY if mode !== 'addTier')
  // 5. renderBuilder()
}
```

### Suggestion Rendering Logic
```typescript
function renderSuggestions() {
  const usedIds = new Set(ranking.flat().map(a => a.id));
  const query = searchInput.value.trim().toLowerCase();
  
  if (query) {
    // Search mode: all matches, mark added
    const matches = allAlbums.filter(a => 
      a.title.toLowerCase().includes(query) || 
      a.artist.toLowerCase().includes(query)
    );
    // Render each with isAdded ? "Added" : "Add"
  } else {
    // Normal mode: only unadded, max POOL_SIZE
    const available = allAlbums.filter(a => !usedIds.has(a.id));
    const visible = available.slice(0, POOL_SIZE);
    // Render each as "Add"
  }
}
```

---

## 8. CSS Architecture Notes

- All sizing uses `box-sizing: border-box`
- Album cards are **64px** squares with **10px** gap in tier body
- Suggested cards use **aspect-ratio: 1** for covers
- Drag ghost uses `position: fixed`, `z-index: 9999`, `pointer-events: none`
- Tabular nums on rank numbers to prevent jitter when renumbering
- `minmax(0, 1fr)` on suggested grid to enforce equal columns regardless of content

---

## 9. Current Standalone Implementation Reference

The current working prototype is a **single HTML file** (`rank-builder.html`) using vanilla JS + HTML5 Drag & Drop API. It is **not** a React component.

Key implementation files/locations for a React rewrite:
- **Route**: `/rank-builder`
- **Entry file**: `pages/RankBuilder.tsx` (or equivalent)
- **Data**: Album pool lives in `data/albums.ts` or fetched from API
- **State**: `useState<Album[][]>` for ranking, `useState<string>` for search query
- **D&D**: Can use `@dnd-kit/core` or native HTML5 DnD
- **Album Cover Images**: Currently uses colored placeholders. Replace `<div className="cover-placeholder">{title.slice(0,2)}</div>` with actual `<img>` tags once cover art assets are available.

---

## 10. Open Questions / Next Steps

1. **Backend integration**: Where do rankings persist? POST to `/api/rankings`?
2. **Cover art**: Replace placeholder colors with actual album cover images.
3. **Album pool source**: Currently hardcoded 28 albums. Should this come from a database/API?
4. **Auth**: Who can save? Is this user-specific?
5. **Undo/redo**: Should we add keyboard shortcuts (Ctrl+Z) for removing accidental drops?
6. **Mobile**: Touch-based drag and drop needs a polyfill or library on mobile.
7. **Tier naming**: Should tiers have custom labels (S, A, B, etc.) instead of just numbers?

---

## 11. Quick Reference — Key Numbers

| Value | Usage |
|-------|-------|
| 8 | `POOL_SIZE` — suggested albums visible at once |
| 28 | Total albums in the pool |
| 64px | Album cover square size |
| 56px | Header height |
| 380px | Right panel width |
| 1280px | Max container width |
| 12px | Suggested grid gap |
| 10px | Tier body card gap |
| 6px | Cover border-radius |
| 8px | Card/suggested cover border-radius |
