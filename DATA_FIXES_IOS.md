# Data-fix hand-off — iOS work (Mac session)

> **Context (2026-06-30):** A data-quality review surfaced 6 issues. Fixes are split: **Windows** owns the DB
> migrations / RPCs / pipeline / web; **Mac (this doc)** owns the iOS surfaces. The two sides meet at the
> **DB contracts** defined below. Windows is building those contracts in parallel — until the migration lands,
> every new `.rpc(...)` call here `try?`-degrades to `[]`, so you can write all of this against the contract now
> and it lights up the moment Windows pushes the migration. **Nothing here is blocked on Windows.**
>
> Issues this doc covers on iOS: **#3** Kanye/Ye split, **#2** collab albums under both artists, **#4** search
> normalization, **#6** artist avatars. (#1 queue + #5 covers are backend-only — no iOS work.)

---

## The DB contracts Windows is delivering (build iOS against these)

Status legend: ⏳ = Windows building now. All are SECURITY DEFINER, callable via `supabase.rpc(...)`.

### Table `release_group_artists` ⏳
One row per credited artist on a release group (ordered). This is what makes a collab album appear on **every**
credited artist's page and lets the album page render **each name as its own link**.

| column | type | meaning |
|---|---|---|
| `release_group_id` | uuid | FK → release_groups |
| `artist_id` | uuid | FK → artists (the real, canonical artist row) |
| `position` | int | credit order; `0` = primary |
| `credited_as` | text | the per-credit display name (e.g. `"Kanye West"`, `"Paloalto"`) |
| `join_phrase` | text | separator that follows this credit (`" & "`, `" feat. "`, `" x "`, or `""`) |

PK `(release_group_id, position)`.

### `search_release_groups(q text, lim int default 30)` ⏳
Normalized lexical search (punctuation/space-insensitive — fixes "new jeans"→NewJeans, "sikk"/"Sik-K"). Albums + EPs only,
newest first. **Returns exactly the columns `Release` already decodes:**
`id, title, artist_display, cover_url, native_title, release_group_type, first_release_date`.

### `search_artists(q text, lim int default 10)` ⏳
Normalized search over the **`artists` table** (name / name_native / aliases), **deduped by artist identity** — this is
what collapses "Kanye West" + "Ye" into the single real artist. Returns:
`id (uuid), name, name_native, cover_url, release_count (int)`.

### `get_artist_release_groups(p_artist_id uuid, lim int default 60)` ⏳
All release groups credited to this artist via `release_group_artists` (any position). Same column shape as
`search_release_groups`. Replaces the `artist_display ILIKE` query in the artist page.

### `get_release_group_credits(p_release_group_id uuid)` ⏳
Ordered credits for an album, for rendering the clickable chips. Returns:
`artist_id (uuid), credited_as (text), join_phrase (text), position (int)`.

---

## iOS task list

> **Line numbers below are against `main` as of commit `c23c8c0` (the Mac's Apple-Sign-In / CachedImage batch).**
> Anchor by symbol name if they've drifted — note there are now **three** artist NavigationLinks in SearchView.

### Task 1 — `ArtistDestination` carries an artist_id  *(foundation for #2/#3)*
`SearchView.swift:1261` (`struct ArtistDestination`). Currently `{ name: String }`. Change to:
```swift
struct ArtistDestination: Hashable {
    let artistId: UUID?     // nil = legacy/Spotify artist with no DB row → name-only fallback
    let name: String
}
```
Every existing `ArtistDestination(name:)` call site must compile — the three artist NavigationLinks at
`SearchView.swift:666, :930, :1014` and the two in `AlbumDetailView.swift:624, :1196`. Add `artistId:` where you have
a real id (album chips, search results), pass `artistId: nil` everywhere else (HomeView carousels, etc.). The
name-only path keeps working via the fallback in Task 4.

### Task 2 — Search uses identity-aware RPCs  *(#3 + #4)*
`SearchViewModel.search()` (`SearchView.swift:340`).
- **Albums:** replace the `.from("release_groups").or("title.ilike…artist_display.ilike…")` block (lines 351–360)
  with `supabase.rpc("search_release_groups", params: ["q": q, "lim": 30])`. Decodes straight into `[Release]`.
- **Artists:** delete the "Derive artist suggestions from album results" block (lines 425–440) — that string-keyed
  derivation is the bug that splits Kanye/Ye. Replace with a `search_artists` RPC call. Extend `SearchArtist`
  (`SearchView.swift:326`):
  ```swift
  struct SearchArtist: Identifiable {
      let id: UUID            // artist_id  (was: name)
      let name: String
      let nameNative: String?
      let coverUrl: String?
      let releaseCount: Int
  }
  ```
  Update the artist NavigationLinks that render search results (`SearchView.swift:666, :930, :1014`) to
  `ArtistDestination(artistId: artist.id, name: artist.name)` and show `coverUrl` as the avatar (Task 5).
- **Songs:** leave the recordings step as-is for now (song-credit identity is a later phase — see "Out of scope").

### Task 3 — Album page renders clickable per-artist chips  *(#2 core spec)*
`AlbumDetailView.swift` `compactHeader` (line 613). Replace the single artist `NavigationLink` (lines 624–630) with a
row of chips built from `get_release_group_credits(p_release_group_id: release.id)`:
- Fetch credits in the view's `load`/`.task` into `@State private var credits: [Credit] = []` where
  `struct Credit: Codable, Identifiable { let artistId: UUID; let creditedAs: String; let joinPhrase: String; let position: Int; var id: Int { position } }`
  (CodingKeys: `artist_id`, `credited_as`, `join_phrase`, `position`).
- Render each `credited_as` as `NavigationLink(value: ArtistDestination(artistId: c.artistId, name: c.creditedAs))`,
  with `c.joinPhrase` as plain `Text` between links. A wrapping layout is ideal (most credits are 1–3 names; long
  `feat.` lists exist — wrap or truncate gracefully).
- **Fallback:** if `credits` is empty (group not yet backfilled by Windows), keep the current single
  `ArtistDestination(name: release.displayArtist)` link so nothing regresses.

### Task 4 — Artist page resolves by id, with name fallback  *(#2/#3)*
`ArtistPageView.load()` (`SearchView.swift:1462`).
- If `artist.artistId != nil`: load releases via `get_artist_release_groups(p_artist_id: id)` — this is what makes a
  collab album show up here even when the artist isn't the primary credit.
- Else (`artistId == nil`): keep the existing `artist_display ILIKE name` query (legacy/Spotify entry points).
- Navigation title: prefer the canonical artist name (Task 5 fetch) over the raw credit string.
- Songs tab (`loadSongs`, line 1552) stays on the `recordings.artist_display ILIKE name` path for now.

### Task 5 — Artist avatars  *(#6)*
`artists.cover_url` exists (Windows is backfilling it — Work Item E). Wherever an artist is shown:
- Artist page header: fetch the artist row by `artist.artistId` (`select id, name, name_native, cover_url`), show
  `cover_url` as a circular avatar + use its `name` as the canonical title.
- Search artist rows + any artist chips: show `coverUrl` (already returned by `search_artists`), placeholder when nil.

---

## Out of scope (later phase, do NOT build now)
- **Song-level multi-artist credits** (a `recording_artists` join table). The songs tab + song search keep using
  `recordings.artist_display ILIKE` until that phase. Album-level credits (this doc) deliver the user's stated spec.

## Acceptance (what "done" looks like)
- Search "new jeans" → NewJeans appears; "sikk" and "Sik-K" → Sik-K appears.
- Search "kanye" or "ye" → **one** artist entry ("Ye"), not two.
- Open **4 the Youth** → "JUSTHIS" and "Paloalto" are two separate tappable links → each opens its own artist page,
  and the album is listed on **both** pages.
- Artist pages show an avatar where `cover_url` is populated.

> The RPCs/table are ⏳ until Windows pushes the migration. Build against the contracts above; `try?` keeps the app
> safe until they exist. Windows will note in SESSIONS.md when the migration is live.
