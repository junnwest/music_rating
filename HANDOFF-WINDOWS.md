# Windows Handoff — Pick Up Here

> **Previous handoff (Korean native-title backfill + phonetic search) is done** — both shipped and verified live 2026-07-03. See `SESSIONS.md` (2026-07-03, Windows entry) for the full trace. This doc replaces it with a new task.

## New task: pre-launch bot population (Mac/Windows split, 2026-07-05)

**Why:** the app is nearly empty. Empty charts/feeds/leaderboards make a bad first impression for real users, which means fewer real users, which means the app stays empty — classic cold-start problem. The fix: seed a population of bot accounts that each replicate a *believable* real listener's taste (not just random ratings), before launch.

**Split:** this is 100% backend/data work, so it's Windows's. Mac is working the other half of today's two-track session (an Instagram-story share card — unrelated, no shared files, no need to coordinate). Nothing here depends on iOS.

**⚠️ Important — the existing bot infra is stale, not usable as-is:** `scripts/create-bot-user.ts` and `scripts/bot-actions.ts` (single `silla_bot` test account) predate the schema renovation. `bot-actions.ts`'s `rate()` still writes `ratings.release_id` — that column doesn't back the current schema (`ratings.release_group_id` does, per `20260624000001` and everything built since). Treat these as reference/prior-art for the auth-user-creation pattern only, not something to extend directly.

---

### 1. Schema: add a bot flag first

Before creating any accounts, add `profiles.is_bot boolean not null default false` (new migration). Cheap now, and keeps every option open later — hiding bots from `get_suggested_users`, excluding them from leaderboards once enough real users exist, bulk-deleting them post-launch, etc. Don't skip this to save a step; retrofitting an is-bot flag onto rows you can no longer distinguish from real users is much worse.

### 2. Persona design — build on the existing genre taxonomy, don't invent a new one

`lib/genre-categories.ts` already defines the product's canonical genre vocabulary: **26 categories** tagged by `origin` (`korean` / `japanese` / `western` / `global`) — k-pop, korean-indie, korean-rb, k-rap, korean-ballad, korean-folk, j-pop, j-rock, city-pop, indie-rock, indie-pop, alternative, post-rock, shoegaze, math-rock, hip-hop, rb-soul, funk, jazz, folk, classical, classic-rock, metal, punk, electronic, ambient, pop, country, bossa-nova, afrobeat. This is also literally what the onboarding genre picker offers real users (`onboardingGenre` field), so bot "taste" should be expressible in the same vocabulary — it'll make bots and real users show up consistently in the same genre-standings/charts machinery.

Build ~12–20 named archetypes, each a weighted distribution over these categories plus:
- a **prestige affinity** (does this persona gravitate to `release_groups.prestige_score`-heavy canon, or ignore it entirely — a Melon-chart K-pop stan and an RS500 completionist should look different)
- a **rating-harshness curve** (mean + spread — not everyone rates 8–10; a "critic" persona should have real range including some 3s and 4s)
- a short **review voice** description (only needed if you do task 5 below)

Starting proposal, **not a final decision** — sanity-check against actual catalog composition first (how many release_groups actually carry each genre tag — `check-genre-coverage.ts` is close but queries the old `releases` table; you may need a `release_groups.genres` version of that count):

- Skew toward the positioning ("sillajuku is for serious listeners") → over-index hip-hop/R&B, indie-rock/alternative, and K-hiphop/K-indie relative to mainstream K-pop.
- But the real userbase is Korea-first (see `VISION.md` / the app's Korean-first i18n investment) — don't make the bot population so far from actual Korean listening habits that the catalog feels imported. K-pop and Korean-ballad personas should be present in real numbers, just not dominant.
- This tension is a product call, not something to resolve by picking a number in isolation — flag your proposed split back before running anything at volume, same as you'd flag a data-sourcing dead end.

### 3. Account creation script

Rewrite `create-bot-user.ts` into something parametric: takes a persona list (name, archetype, count), generates N `auth.users` + `profiles` rows per persona via `admin.createUser` (service role, same pattern as today), with:
- believable usernames/display names per persona flavor (not `bot_001`)
- `is_bot = true`
- staggered `created_at` on the profile (bots shouldn't all have the exact same signup timestamp — pick random dates across a plausible pre-launch window)

### 4. Rating generation script

For each bot: sample albums weighted by the persona's genre distribution × prestige affinity from `release_groups` (join `genres` + `prestige_score`, already populated for ~294k rows), assign a score from the persona's harshness curve (not just genre match — actual variance), and insert into `ratings` with an **explicit backdated `created_at`** spread across weeks, not a single-instant bulk insert — a script bypassing RLS via service role can set `created_at` directly on insert, unlike the app itself. Make it resumable/checkpointed like the existing backfill scripts (`backfill-genres-rg.ts` etc. are the established pattern in this repo) so a partial run can pick back up.

**Sizing — tie volume to what each surface actually needs, don't guess a round number:**
- `get_charts_trending` / `get_charts_most_rated` (global + genre-personalized) — need enough per-genre rating volume that no genre row looks sparse
- `get_user_genre_standings` (Taste page) — needs per-user rating counts high enough to clear whatever unlock thresholds exist (see the 2026-07-04 Taste-unlock fix in `SESSIONS.md` for the counting logic)
- Explore feed's weighted-relevance algo (README: following boost, artist-taste match, log-scaled likes/comments, prestige, recency) — needs enough posts + likes/comments for the feed to not look like 5 bots talking to each other
- `get_silla_leaderboard` — driven by `prestige_score` (external critic sources), **not** user ratings, so it's already populated independent of bots; don't over-invest bot volume here
- `get_suggested_users` — ordered by rating count, so bot accounts will dominate it until real users have ratings too; consider whether `is_bot` should filter this out later (see item 1)

### 5. Social graph (follows)

Bots should follow each other clustered by taste-affinity (hip-hop personas follow other hip-hop personas more than K-pop personas), not a uniform random graph — a real social graph has structure. Avoid every bot converging on the same handful of accounts (looks synthetic). Same backdating/pacing principle as ratings.

### 6. Reviews — optional, flag before building

Ratings alone may be enough to solve "the app feels empty." Adding review text requires either a curated template bank per persona voice (cheap, but repetitive at volume) or generating varied text some other way (more natural, more cost/complexity). Don't build this until the ratings/follows core is done and it's clear whether reviews are actually needed for the launch bar — check back in rather than defaulting to the fancier option.

### Verification

Once a batch runs, spot-check the same way past backfills were verified in this project — pull a few bot profiles live and confirm rating distributions actually vary by persona (not all identical), timestamps are actually spread out (not one burst), and a couple of the product surfaces above (charts, explore feed, taste page) look populated and plausible, not just non-empty.

### Open decisions to flag back before going to volume (don't silently decide and run)

- Final persona list + proportions (this doc's list is a starting proposal)
- Total bot count and ratings-per-bot
- Whether bots get reviews (item 6)
- How long bots stick around / get diluted once real users arrive — affects whether `is_bot` needs to actively filter anything now vs. just existing for later
