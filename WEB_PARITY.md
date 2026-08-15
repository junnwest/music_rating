# Web Parity Checklist

## Current parity queue (2026-07-16 — iOS→web items from the rated-state/rating-UX session)

Done that day: Split column (album page), Quick Add page + `/search` banner, `FlowerRatingRow`
component, "Add to a list"→"Add to a Mix" wording, English-mode Hangul-name fix (web-only so far).
Still open, roughly in priority order:

1. **`ManualRateModal` slider → draggable flowers.** iOS's manual rating modals (album + track) now
   use the 5-flower drag control with the numeric readout kept for 0.1 steps. Web's modal still uses
   `<input type=range>`. `components/sj/FlowerRatingRow.tsx` already exists (supports `step` +
   `onLiveChange`) — small swap inside `ManualRateModal.tsx`.
2. **Album/song page rated state as a post card with ⋯ menu.** iOS renders the user's own rating as
   the regular post card under "Your Rating" with a top-right menu (Share / Edit / Add to Mix /
   Edit Comment / Delete; songs omit Share+Mix). Web album page still shows `InlineRatingEditor` +
   an autosaving comment textarea.
3. **Dedicated Edit Comment modal.** iOS added `CommentEditSheet` (header + editor + Save, no mix
   row). Web's `PostRatingOptions` is still the combined comment+mix sheet. Ties into item 2.
4. **Profile post-card header consistency.** iOS profile/song/post-detail cards now carry the
   FeedCard-style header (avatar + @handle + verified + time). Web's profile card layout has NOT
   been audited against its FeedCard — check and align.
5. **Reverse-parity (web→iOS): English-mode Hangul names.** Web now gates native names on UI
   language; iOS still prefers Hangul unconditionally (`Release.swift` displayTitle/displayArtist)
   and shows it inconsistently (only on surfaces that join `name_native`). Awaiting user decision.
6. **iOS ko strings for Quick Add** ("Quick Add", "Setting up?", banner copy, mode-gate alert,
   empty state) are missing in `Localizable.xcstrings`; web's `sj.quickAdd.*` ko copy can be reused.

> **✅ SUPERSEDED (2026-07-06):** the web reconstruction session rebuilt `apps/web` against the *current*
> iOS app and schema, which covers (and in places supersedes) everything below — §1 OAuth-only login ✅,
> §2 onboarding ✅ (current iOS steps: name → username → rating mode → notifications; the Google-only
> genre step described below no longer exists on iOS either), §3 essentials removal ✅, §4 both rating
> modes incl. per-track Instinct ✅ (note: post-renovation the keys are `release_group_id`/`recording_id`,
> not the `release_id` shown in the SQL sketch below), §5 login redesign ✅, §7 i18n ✅ (as the `sj.*`
> namespace). §6 (Spotify/Apple data sync surfacing discovery rows on web) is the one remaining open item.
> Kept for historical context — details below reflect 2026-06-17, before the DB renovation.
>
> **✅ RESOLVED (2026-08-15):** the 2026-08-13 correction below is no longer current. Re-did the web
> removal against today's codebase — stripped the remaining Instinct/`rating_mode`/`elo_score`
> references from the 5 files that had reverted to upstream during the 2026-08-13 `git pull` conflict
> (`AlbumRateButton.tsx`, `search/page.tsx`, `quick-add/page.tsx`, `album/[id]/page.tsx`,
> `ProfileRatedList.tsx`) — the rest of the original 2026-08-11 removal was already sitting correctly
> stripped in the working tree, just uncommitted. **iOS and web now agree: Instinct mode is gone from
> both.** `tsc --noEmit` + `next lint` + full `next build` clean; `xcodebuild` clean. The DB migration
> (`20260810010000_remove_instinct_mode.sql`) is still ⏳ **not yet applied** — deliberately, per this
> project's convention that destructive/schema-changing migrations are user-applied, not automatic.
> The REMOVED note directly below is accurate again.
>
> **REMOVED (2026-08-11, re-verified 2026-08-15):** Instinct mode (§4's pairwise-comparison rating
> path) was deleted entirely — iOS, web (code), and pending DB cleanup (`rating_mode`,
> `elo_score`/`elo_games`, the `pairwise_comparisons` tables — migration written, not yet applied).
> Only Manual (direct-score) rating remains. §4 below is historical record of a feature that no
> longer exists in any form.
>
> <details><summary>2026-08-13 correction (superseded by the above, kept for the record)</summary>
>
> the "REMOVED (2026-08-11)" claim below was wrong for web. That session's removal (iOS + web + DB)
> was built but **never committed or pushed** — confirmed 2026-08-13 while resolving a `git pull`
> conflict: origin/main still had `lib/elo.ts`, `InstinctModal`, `rating_mode` throughout, and
> substantial *new* web work (`RatingsStore`, drag-to-delete, the taste-page rebuild) had since been
> built directly on top of the Instinct-still-present codebase. The iOS-side removal was still
> sitting uncommitted in the local working tree, so iOS and web disagreed on whether Instinct mode
> existed.
>
> </details>

Changes designed and built in the iOS (Swift) app during the 2026-06-17 session that must be mirrored on the web (`apps/web`) in a follow-up session.

> **Rule:** all user-facing features must behave identically on web and mobile. Use this file as the task list when starting the web parity session.

---

## 1. Authentication — remove email/password login

**What changed on iOS:**
- The login screen shows only OAuth buttons: Spotify (recommended), Apple, Google.
- Email/password sign-up and sign-in are gone entirely.

**Web changes required:**
- Remove the email/password fields and the login/signup tab switcher from `AuthForm.tsx` (or the equivalent auth page).
- Remove the `/api/auth/resolve-username` endpoint (username→email lookup) if it is only used by the password login flow.
- Keep Google and Spotify OAuth buttons. Add Apple OAuth button (Sign in with Apple via Supabase).
- Update the login page layout: logo + tagline at top, then the three OAuth buttons (Spotify first with "Recommended" label, then Apple, then Google).
- Remove the password reset flow (`/reset-password`, forgot-password mode in `AuthForm`) — not needed if there are no passwords.

---

## 2. Onboarding — simplified + new steps

**What changed on iOS:**
The onboarding is a multi-step flow. Steps vary by login provider:

### All providers (steps 1–2):
1. **Profile setup** — Display Name + Username only. Bio, country, streaming platform, and genre pills removed.
2. **Rating mode** — pick Manual or Instinct (see §4).

### Google login only (inserted between steps 1 and 2):
- **Music preferences** — genre pill picker (same DB-frequency-sorted pills as the old genre step). Shown because Google OAuth provides no music data to infer taste from.

### All providers (step 3):
3. **Notifications** — "Allow notifications" permission prompt (functional on iOS; web shows a browser notification permission request or a styled placeholder if browser doesn't support it).

**Web changes required:**
- Rewrite `apps/web/app/(main)/onboarding/page.tsx` to match this step structure.
- Remove `StepAlbums` (Essentials picker) entirely.
- Remove the streaming platform step (`StepStreaming`) entirely.
- Remove the country dropdown from `StepIdentity`; keep only display name + username.
- Keep the genre pill picker but move it to a Google-only conditional step.
- Add `StepRatingMode` (Manual vs Instinct picker — see §4).
- Add `StepNotifications` (browser notification permission request).
- `handleFinish` must write `rating_mode` to `profiles` in addition to the existing fields.

---

## 3. Essentials — remove from entire app

**What changed on iOS:**
Feature removed entirely. Not shown in onboarding, not shown on profiles.

**Web changes required:**
- Remove the Essentials strip from profile pages (`ProfilePanel.tsx` or equivalent).
- Remove "Add to Essentials" from the album page Add button dropdown (`AlbumActions.tsx`).
- Remove `StepAlbums` from onboarding (already covered in §2).
- The `pinned_albums` DB table can stay (no migration needed — just stop reading/writing it).
- Remove any `pinned_albums` queries from profile page server components.

---

## 4. Rating mode — Manual vs Instinct

**What changed on iOS:**
Two rating modes. User picks during onboarding. Can change in Settings.

### Manual mode
- Standard half-star rating (0.5–5.0) by default.
- **Optional 0.1 precision** (decided 2026-06-17): a Settings toggle switches Manual input from the half-star widget to a **slider** that captures 0.1 steps (0.0–5.0). Half-star stays the default. `ratings.score` is already `numeric(3,1)` so no schema change is needed for the value; only the user's chosen granularity needs storing.

### Instinct mode (algorithm decided 2026-06-17 — Beli/Podiums model)
- **No star input on album pages.** Album page shows the user's current derived score (0.0–5.0, 0.1 steps) and rank, no interactive widget.
- **Gut-check bucket first.** When adding a new album the user picks one of **three** buckets — **bad / neutral / good** (three, not five, to suit a 5-point scale). The bucket is a **soft seed**, not a hard band: it only sets the album's starting Elo (`seedElo` in `lib/elo.ts`: bad 1400 / neutral 1500 / good 1600) so the first comparisons start near its likely spot.
- **Pairwise comparison session** — one album is the one being rated, the other is a previously-rated album. "Which do you prefer?" nudges both albums' Elo (`updateElo`). The number of questions scales with how many albums the user has rated, **capped at 3**. Per-album flow mirrors Podiums: bucket → (optional) add to a collection / comment → comparisons → done.
- **One global ranked list per user.** Elo is only the ordering engine; there are **no sealed tiers**, so an album can cross former bucket lines freely (a "bad"-seeded album that keeps winning rises above "neutral" ones — no contradiction to resolve).
- **Displayed score = rank position, interpolated.** `scoreFromRank` / `deriveInstinctScores` map an album's position in the single ranked list to 0.0–5.0 (top ≈ 5.0, bottom ≈ 0.0). Fully relative, like Beli.
- **Scores hidden until the user has rated at least 5 albums** (`INSTINCT_REVEAL_THRESHOLD` in `lib/elo.ts` — the bucket gut-check carries the first few).
- Both modes output a visible score on album pages and profile.
- **Switching modes keeps scores** (no reset). Manual `score` and Instinct `elo_score`/`elo_games` are stored independently, so toggling back and forth is non-destructive.

**DB changes required (new migration):**
```sql
-- Add rating_mode to profiles
ALTER TABLE profiles ADD COLUMN rating_mode text NOT NULL DEFAULT 'manual'
  CHECK (rating_mode IN ('manual', 'instinct'));

-- Add elo_score to ratings for instinct users
ALTER TABLE ratings ADD COLUMN elo_score numeric;
ALTER TABLE ratings ADD COLUMN elo_games integer NOT NULL DEFAULT 0;

-- Pairwise comparison log
CREATE TABLE pairwise_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  winner_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  loser_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pairwise_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own comparisons"
  ON pairwise_comparisons FOR ALL USING (auth.uid() = user_id);
```

**Web changes required:**
- Add `rating_mode` read to the user profile fetch (already in Supabase `profiles` select).
- Album page: if `rating_mode === 'instinct'`, hide the `StarRating` widget and show derived score + rank only.
- Add a "Rate" entry point somewhere in the main nav (sidebar or dedicated page) that launches the pairwise comparison session for Instinct users.
- Pairwise comparison session page (`/rate` or `/compare`): fetch two uncompared albums from user's rated set, display covers side by side, handle pick → POST to `/api/rate/compare` → update Elo scores → show next pair.
- Settings → Preferences: add rating mode toggle (no reset — scores are kept). Also add the Manual **0.1-precision** toggle (half-star ↔ slider).
- `/api/rate/compare` endpoint: receives `{ winnerId, loserId }`, updates Elo scores for both releases in `ratings`, logs to `pairwise_comparisons`.

---

## 5. Login page redesign

**What changed on iOS:**
- Full-screen layout: logo (flower mark) + tagline centered, then OAuth buttons stacked vertically.
- Spotify button is first, has a "Recommended" label/badge, green background.
- Apple button is second, black background.
- Google button is third, white with border.
- No email fields, no mode switcher tabs.

**Web changes required:**
- Redesign `app/(auth)/login/page.tsx` (or wherever the auth page lives) to match this layout.
- Three stacked full-width OAuth buttons, Spotify on top with "Recommended" badge.
- Remove email/password form entirely.

---

## 6. Spotify + Apple data sync (taste seeding)

**What changed on iOS:**
- After Spotify login: pull `user-top-artists` (medium + long term) via Spotify API → match against sillajuku catalog → used to surface relevant albums.
- After Apple login: pull heavy rotation + library albums via MusicKit → match against catalog.
- Both skip the genre preferences step in onboarding.
- Data is re-synced periodically (on app open), not just once.

**Web changes required:**
- Spotify: after OAuth callback, fetch top artists with `user-top-read` scope and store or use to personalize the homepage recommendation feed. The `spotify_connections` table already stores the token — add a sync step in the onboarding finish handler.
- Apple: MusicKit JS (web SDK) can be integrated for web; lower priority than iOS since Apple Music users are more naturally on iPhone. Treat Apple web login like Google for now (show genre step) unless MusicKit JS is added.
- Add `user-top-read` and `user-read-recently-played` to the Spotify OAuth scopes requested during sign-in (currently only profile scopes are requested).

---

## 7. i18n strings to add

New strings added on iOS that need corresponding entries in `apps/web/lib/i18n/en.ts` and `ko.ts`:

- `onboarding.ratingModeTitle` — "How do you want to rate music?"
- `onboarding.ratingModeManual` — "Manual"
- `onboarding.ratingModeManualDesc` — "Assign a star rating to each album you listen to."
- `onboarding.ratingModeInstinct` — "Instinct"
- `onboarding.ratingModeInstinctDesc` — "Pick between two albums. Your rankings build themselves."
- `onboarding.notificationsTitle` — "Stay in the loop"
- `onboarding.notificationsDesc` — "Get notified when friends rate albums, follow you, or comment."
- `onboarding.allowNotifications` — "Allow Notifications"
- `onboarding.skipForNow` — "Skip for now"
- `settings.ratingMode` — "Rating Mode"
- `settings.ratingModeNote` — "Your scores are kept when you switch modes."
- `settings.manualPrecision` — "Half-star or 0.1 precision"
- `onboarding.bucketBad` / `onboarding.bucketNeutral` / `onboarding.bucketGood` — "Bad" / "Neutral" / "Good" (Instinct gut-check)
- `rate.whichPrefer` — "Which do you prefer?"
- `album.instinctScore` — "Instinct Score"
- `album.noRatingInstinct` — "Rate this album in a comparison session"

---

## Notes

- The `pinned_albums` table is not dropped — just unused. Add a migration to drop it when confirmed no user data exists.
- KakaoTalk login remains "coming soon" on both platforms.
- The pairwise comparison Elo algorithm should live in a shared utility (`packages/shared/` or `apps/web/lib/elo.ts`) so both platforms use identical math.
- Apple Sign in with Apple via Supabase already works on web — no new Supabase config needed for the auth button itself.
