# sillajuku — Full Project Handoff

## Project Overview

**sillajuku** is a music rating and discovery web application — think "RateYourMusic meets Spotify" — built with React, TypeScript, Vite, Tailwind CSS, shadcn/ui, and Framer Motion.

**Tech Stack:**
- React 19 + TypeScript (Vite)
- Tailwind CSS 3.4 + shadcn/ui theming
- React Router DOM (SPA routing)
- Framer Motion (animations)
- Lucide React (icons)
- Plus Jakarta Sans (Google Font)

---

## Design System

### Colors (custom Tailwind tokens in `tailwind.config.js`)
| Token | Value | Usage |
|-------|-------|-------|
| `ink` | `#111111` | Primary text, headings |
| `mid` | `#444444` | Secondary text |
| `muted` | `#888888` | Tertiary text, placeholders |
| `surface` | `#F7F7F5` | Card backgrounds, subtle fills |
| `mint` | `#3DFFD1` | Accent color — badges, active states, stars |
| `mint-bg` | `#EDFFF9` | Mint-tinted backgrounds |
| `mint-dark` | `#00453A` | Mint text on mint backgrounds |
| `divider` | `#EBEBEB` | Borders, separators |
| `placeholder` | `#C0C0BE` | Input placeholders |
| `subtle` | `#DDDDD8` | Dashed borders, inactive states |

### Typography
- Font: **Plus Jakarta Sans** (weights 400–800, loaded from Google Fonts)
- No emojis in UI text (per shadcn/ui rules)

### Component Patterns
- Cards: `rounded-xl border border-divider bg-white`
- Buttons: `rounded-xl px-6 py-2.5` — ink bg for primary, border for secondary
- Inputs: `bg-surface border border-divider rounded-xl px-4 py-2.5`
- Pills: `rounded-full px-[10px] py-[3px] text-[11px] font-semibold`
- Hover: `hover:border-mid hover:shadow-sm` on cards

---

## File Structure

```
src/
  App.tsx          — Root router with all routes + ListenLaterProvider
  main.tsx         — React entry (StrictMode, BrowserRouter)
  index.css        — Global styles + Tailwind directives
  App.css          — (minimal, keep or remove)
  data.ts          — ALL mock data: albums, artists, reviews, rankings, user profiles, genres, helpers
  rankingData.ts   — Ranking-specific data: active rankings, filter options, album pool, community top 10
  components/
    Layout.tsx     — Wraps Header + Sidebar + Footer + Outlet
    Header.tsx     — Sticky top bar: hamburger, logo, search form, profile dropdown
    Sidebar.tsx    — 72px vertical rail: Ranking, Feed, Explore, Friends + logo-home
    Footer.tsx     — Bottom nav: links, legal
    AlbumCard.tsx  — Reusable album card with Cover, hover effects
    Cover.tsx      — Gradient album/artist placeholder with light effects
    StarRating.tsx — Star display (read-only for now)
  hooks/
    useListenLater.tsx — React context for "Listen Later" saved album IDs
  pages/
    Home.tsx           — Personalized feed: greeting, recent ratings, genre rows
    Login.tsx          — Auth page: login/signup toggle, email, password, Google
    Onboarding.tsx     — 3-step signup: profile info, genre picks, Pinned Ten
    AlbumDetail.tsx    — Album hero: cover, stats, star rating, tracklist, reviews, similar albums
    Artist.tsx         — Artist hero: avatar, stats, discography grid
    Profile.tsx        — Dynamic profile: own (kenneth) vs others. Pinned Ten, stats sidebar, catalog tabs
    Search.tsx         — Search results: albums + artists grid
    Rankings.tsx       — Rankings hub: active ranking cards + filter builder (country/genre/time)
    RankingDetail.tsx  — Ranking builder: 2-col layout — Your Ranking slots + Album Pool + Community Top 10
    Activity.tsx       — Activity feed: ratings and reviews from community
    Genre.tsx          — Genre page: album grid filtered by genre
    Lists.tsx          — "For You" curated list grid
    ListDetail.tsx     — Individual curated list detail
    ListenLater.tsx    — Saved albums grid (from context), remove on hover
    Friends.tsx        — Social page: Following / Followers / Discover tabs, follow toggles
    Notifications.tsx  — Full notifications: grouped by time, read/unread, mark all read, clear
    Settings.tsx       — 5-tab settings: Account, Preferences, Notifications, Privacy, Danger Zone
    HelpFeedback.tsx   — FAQ accordion + contact form with category selector
    Privacy.tsx        — Redesigned privacy policy with icon sections
    Terms.tsx          — Redesigned terms of service with icon sections
    Wrapped.tsx        — Year in review: stats cards, best/worst albums
```

---

## Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Personalized feed |
| `/album/:id` | AlbumDetail | Album page with reviews, tracklist |
| `/artist/:id` | Artist | Discography page |
| `/profile/:id` | Profile | Dynamic user profile |
| `/search` | Search | Search results with `?q=` param |
| `/rankings` | Rankings | Filter builder + active rankings |
| `/rankings/build?country=&genre=&time=` | RankingDetail | Build your Top 10 ranking |
| `/rankings/:id` | RankingDetail | (legacy route, same as above) |
| `/activity` | Activity | Community feed |
| `/genre/:id` | Genre | Genre album grid |
| `/lists` | Lists | "For You" page |
| `/lists/:id` | ListDetail | Curated list detail |
| `/listen-later` | ListenLater | Saved albums |
| `/friends` | Friends | Social page |
| `/notifications` | Notifications | Notification inbox |
| `/settings` | Settings | Account settings |
| `/settings?tab=notifications` | Settings | Opens on Notifications tab |
| `/help` | HelpFeedback | FAQ + contact form |
| `/wrapped` | Wrapped | Year in review |
| `/privacy` | Privacy | Privacy policy |
| `/terms` | Terms | Terms of service |
| `/login` | Login | Auth (no Layout) |
| `/onboarding` | Onboarding | Signup flow (no Layout) |

---

## Data Architecture

### `data.ts` — Main data file

**Interfaces:** `Album`, `Track`, `Artist`, `Review`, `ActivityItem`, `Ranking`, `RankingItem`, `CuratedList`, `UserProfile`

**Exported data arrays:**
- `albums: Album[]` — 47 albums with full metadata, cover gradients, tracklists
- `artists: Artist[]` — 28 artists with genres, followers, releases, avatar gradients
- `reviews: Review[]` — Review objects with user, album ref, rating, text
- `activityFeed: ActivityItem[]` — Community activity items
- `rankings: Ranking[]` — 10+ rankings with country, genre, votes, items
- `curatedLists: CuratedList[]` — Curated collections
- `userProfiles: Record<string, UserProfile>` — **Key for dynamic profiles**:
  - `kenneth` (own profile): full data with `insights`
  - `jiyeon_music`, `minwave`, `soundwatcher`, `popwatcher` (others): have `relationshipInsights` vs Kenneth
- `recentRatings`, `genreRows`, `forYouAlbumIds`, `pinnedTenIds`, `profileStats`, `wrappedStats`

**Helper functions:**
- `getAlbumById(id)` — lookup album
- `getArtistById(id)` — lookup artist
- `getAlbumsByArtist(id)` — filter + sort by year desc
- `getAlbumsByGenre(genre)` — filter by genre
- `getReviewsForAlbum(id)` — filter reviews
- `getUserProfile(id)` — lookup user profile (NEW)

### `rankingData.ts` — Ranking-specific data

- `activeRankings` — 8 popular ranking cards with top album, submissions count, status
- `filterCountries` — 10 countries including Global
- `filterGenres` — 16 genres including "All Genres"
- `filterTimes` — 7 time periods including "All Time"
- `albumPool` — 20 realistic hip-hop/R&B albums for the ranking builder
- `communityTop10` — Aggregated community ranking with scores and movement indicators

### `useListenLater.tsx` — Context

```typescript
const { ids, add, remove, has, toggle } = useListenLater();
```
- Pre-seeded with 3 album IDs: `['broken-mirror', 'palette', 'night-swimming']`
- Persisted in React state (not localStorage yet)

---

## Key Features Already Built

### Profile System
- **Own profile** (`/profile/kenneth`): Edit profile button, personal insights ("Your ratings land close to community average...")
- **Other profiles** (`/profile/jiyeon_music`, `/profile/minwave`, etc.): Follow button, "vs. You" relationship insights
- Dynamic avatar colors, different stats, different pinned albums, different badges per user

### Rankings System
- Country → Genre hierarchy (Global first, then Korea, Japan, USA, UK, Philippines, Indonesia, Thailand, Vietnam, China)
- Filter builder with live preview title generation
- Two-column ranking builder: **Your Ranking** (10 slots, click-to-add from pool) + **Album Pool** (searchable, filterable)
- Community Top 10 preview below the builder

### Sidebar + Header
- **Sidebar** (72px narrow rail): Trophy (Ranking), Flame (Feed), Compass (Explore), Users (Friends). Logo at bottom = home.
- **Header**: Logo (home), search form (submits to `/search?q=`), profile avatar dropdown
- **Profile dropdown** (click K avatar): Profile, Listen Later, Wrapped, Notifications (badge 4), Settings, Help, Log out

### Listen Later
- Toggle button on every album page ("Listen Later" / "Saved")
- Dedicated page at `/listen-later` showing saved grid with remove-on-hover

### Notifications
- Full page at `/notifications` with 10 sample notifications
- Grouped by: Today / This week / Earlier
- Unread = mint-tinted background + bold title + green dot
- Actions: Mark all read, Clear all, filter by All/Unread

---

## Assets

- **Logo**: `public/logo.png` — user's dotted-flower sillajuku logo
- **No other image assets** — all covers use CSS gradient placeholders via `Cover.tsx`

---

## Build Instructions

```bash
cd /path/to/project
npm install
npm run build    # outputs to dist/
npm run dev      # dev server
```

**Deploy**: `dist/` folder contains `index.html` + bundled assets. Uses `deploy_website` tool with `type: "static"`.

---

## What the Next Agent Should Know

1. **All data is mock/static** — lives in `data.ts` and `rankingData.ts`. No backend API yet.
2. **No localStorage persistence** — Listen Later, notifications, settings don't persist across reloads yet.
3. **Auth is UI-only** — login/onboarding pages don't actually authenticate. The "K" avatar is always kenneth.
4. **Search** — searches across the static `albums` and `artists` arrays only.
5. **Cover gradients** — all album/artist covers are CSS gradients (no real images). See `COVER_GRADIENTS` in `data.ts`.
6. **Responsive design** — sidebar collapses on mobile (hamburger menu), search bar hides on mobile (replaced by icon).
7. **Framer Motion** — used for page transitions, staggered lists, accordion animations.
8. **No backend API integration** — everything is frontend mock. Spotify is mentioned for attribution but not actually integrated.

---

## Known Gaps / TODOs for Next Agent

- [ ] **Backend integration**: Replace mock data with real API (Supabase/Spotify/REST)
- [ ] **localStorage persistence**: Save Listen Later, settings, notification read state
- [ ] **Real auth**: OAuth (Google), JWT sessions, protected routes
- [ ] **Image assets**: Replace gradient placeholders with real album artwork
- [ ] **Drag & drop in ranking builder**: Make the ranking slots actually draggable
- [ ] **Real-time notifications**: WebSocket or polling for live notifications
- [ ] **Search debounce**: Add proper search debouncing + loading states
- [ ] **Pagination**: Lists, rankings, activity feed need pagination
- [ ] **Error boundaries**: Add React error boundaries for graceful failures
- [ ] **Loading skeletons**: Replace empty states with shimmer skeletons
- [ ] **Accessibility**: ARIA labels, keyboard navigation, focus management
- [ ] **Dark mode**: Implement toggle + color tokens for dark theme
- [ ] **Settings save**: Currently just shows "Saved" toast — no persistence
