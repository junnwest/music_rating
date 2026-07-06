# Pre-Launch Bot Population — Plan Summary for Independent Review

> **⚠️ STATUS (2026-07-05, updated):** Three independent model reviews came back — all praised the
> `external_scores` critical-vs-commercial split and the Bayesian ranking; corrections adopted (Grammy
> = weak-institutional not commercial; Artist Halo to fix thin Korean coverage; commercial as a cap
> not a hard penalty). Those honest pieces were **built** (`critic_affiliation` view, `get_critics_picks`
> RPC, source classification, link backfill). **However, the reviews also leaned into optimizing bot
> *undetectability* / fake reviews, and the core plan — accounts indistinguishable from real users —
> is astrotur/ fake social proof.** The assistant declined to build the *disguised* version and
> offered a *disclosed* one (labeled seed profiles). **Decision on the bots is pending** (delete /
> relabel-disclosed / critic-surface-only). This doc is preserved as the point-in-time briefing that
> was sent to the reviewers. See `SESSIONS.md` 2026-07-05 (Windows) + `HANDOFF-WINDOWS.md` status banner.

> **Purpose of this document.** We are building a population of ~150 bot accounts to seed a
> music-rating app before launch (cold-start problem). This is a briefing for an *independent*
> reviewer (another Claude instance) to **do its own research and critically evaluate the plan** —
> especially the taste model. It is self-contained; you do not need prior context. Please push back
> hard, verify claims, and propose better approaches. Concrete data figures are given so you can
> sanity-check them.

---

## 1. Product context & the goal

**The app ("Sillajuku"):** a Korea-first, globally-scoped music **album-rating** social app (like a
Letterboxd/RateYourMusic for music). Users rate albums 1.0–5.0 (decimal), write optional reviews,
follow other users, build tier-lists. Surfaces include a global **feed** (recent rating activity),
**charts** (top-rated / most-rated / trending, global and per-genre), a **Taste** page (genre DNA),
and a prestige **leaderboard**.

**The target audience — critical to everything below:** users with a **minor / anti-commercial
music taste** — serious, discerning, "underground" listeners. **NOT** mainstream-pop consumers.
Concretely: mainstream idol K-pop and Top-40 pop should be a *minor* presence, while indie,
underground hip-hop, city-pop, shoegaze/post-rock, jazz, etc. should dominate — **while still being
Korea-first** (the userbase is Korean). Crucial nuance the product owner emphasized: *"I'm not
saying all K-pop should be suppressed — there are K-pop albums that music lovers actually rate
highly."* So the axis is **critical acclaim / discerning taste**, NOT "idol vs indie" as a blunt
genre split.

**The cold-start problem:** empty charts/feeds/leaderboards make a bad first impression → fewer real
users → app stays empty. Fix: seed believable bots whose ratings look like a real community of the
target audience, *before* launch.

---

## 2. Data model & relevant schema

- **`ratings`** `(id, user_id, release_group_id, score float [1–5, decimal], status ['Listened'
  makes it count], review_text, created_at, elo_score, elo_games)`. Album ratings key on
  `release_group_id`. Service-role inserts can set `created_at` directly (backdating), unlike the app.
- **`release_groups`** (~295k rows): the rated album entity. `prestige_score` float 0–1 (a *blended*
  external-critic score, see §4), `genres text[]`, `first_release_date`, `cover_url`,
  `primary_artist_id`, `mb_release_group_id` (MusicBrainz ID), `release_group_type`
  (album/ep/single/compilation/…), `native_title`.
- **`artists`** (~34k): `native_language` (`ko`/`ja`/null), `country`, `name` (usually Latin),
  `name_native` (native-script name), `name_phonetic_ko` (Korean phonetic spelling for search).
- **`external_scores`** (3,319 rows): per-album critic/award entries. Columns: `source` (named list,
  see §4), `raw_score`, `normalized_score` (0–1), `score_type`, `source_tier` (1/2/3), `year`,
  `scope_country`, `mb_release_group_id` (links to `release_groups.mb_release_group_id`).
  `prestige_score` is derived from these.
- **`profiles`** `(id, username, display_name, country, created_at, is_bot [added], rating_mode
  ['manual' or 'instinct'], …)`.
- **`follows`** `(follower_id, following_id, created_at)`.

**Ranking machinery (already exists):**
- **Silla leaderboard** = `0.55·ratingScore + 0.45·rankScore`. `ratingScore` is Bayesian-damped
  (prior μ=2.75, m=3) AND *per-user calibrated* (a user's absolute generosity is normalized out;
  only their relative ordering carries signal). `rankScore` = tier-lists + seed votes. **Robust** to
  bot noise. Bots only add ratings (not tier-lists).
- **Charts** (`get_charts_*`): were raw `AVG`/`COUNT`. We changed `top_rated` to a **Bayesian average
  (C=8, μ=2.75) with `HAVING count>=3`** so 1–2 ratings can't top a chart. `most_rated` = COUNT.
  `trending` = ratings in last 7 days.

**Constraints:** Supabase **Micro** compute (small daily Disk-IO burst budget; heavy scans/writes can
exhaust it). Migrations applied by a human via the SQL editor. No scraping of streaming platforms
(Melon/Bugs/Genie/Vibe all `Disallow: /` in robots.txt). Two-device git workflow.

---

## 3. Persona design (as built)

15 personas, **Korea-first** split (~48% Korean / ~15% Japanese / ~37% Western of 150 bots),
rebalanced toward indie/underground:

- **Korean (72):** kpop-stan **6** (the only "mainstream" persona), kindie-head 22, khiphop-head
  (underground) 18, krnb-head 12, kcritic 14.
- **Japanese (22):** city-pop/J-cult 10, jrock-head 12.
- **Western (56):** hiphop-head (backpack) 12, indie-alt/shoegaze 18, jazz/classical 8,
  electronic/experimental 8, rock-canon 6, rnb-soul 4.

Each persona has: a content bucket (`ko`/`ja` by artist origin, or `western` by genre tags), a
`mainstream` flag (only kpop-stan), a prestige affinity, and a **harshness curve** `{mean, sd}` for
score distribution (stans rate high & narrow; critics lower & wider).

**Content bucketing rationale:** MusicBrainz genre tags are ~absent for Korean albums (k-pop tag on
0.8% of albums; korean-indie/rb/rap ≈0%), and 51% of the catalog is untagged. So Korean/Japanese
content is bucketed by **primary artist `native_language`** (reliable), Western by genre tags
(well-populated for Western).

**Identity generation:** display names are **native script** for KR/JP bots (Hangul 민서 / Kana ゆき),
Western romanized; @handles are Latin/aesthetic and *usually unrelated to the name* (e.g. @goldenhour36
→ "민서") — mirroring how real users pick handles. Signups backdated 3–75 days; ratings backdated
signup→now with a mild recency bias (~36% land in the last 7 days so the feed/trending look alive).

---

## 4. Key data findings (research already done)

**(a) Catalog is Western-dominant by volume.** ~92% of album/EPs are non-Korean/Japanese. Korean
album/EPs ≈ 2.2k, Japanese ≈ 5.5k. The rest (~90k+) Western/global. (Korea-first is achieved via the
*persona split*, not the catalog.)

**(b) Systematic `native_language` mis-tags — FIXED.** An old Wikipedia-langlink backfill wrote the
Korean/Japanese **phonetic** rendering of *non-native* artists into `name_native` and set
`native_language='ko'/'ja'`. So Taylor Swift (US) was `native_language='ko'`, name_native
"테일러 스위프트"; Rolling Stones (GB) was `ja`. **261 fixed** using the `country` signal
(native_language='ko' but country≠KR ⇒ mis-tag; the Korean phonetic was moved to `name_phonetic_ko`).
This also improves the real app's native-name display & search. (ko artists: 333→294, ja: 394→172.)

**(c) THE BIG ONE — `external_scores` cleanly separates *critical* from *commercial*.**
`prestige_score` blends both, which is why concentrating on it surfaced mainstream mega-canon
(Beatles, Ariana) and idols. The named sources split as:

- **Critical (serious-listener taste):** `rs500`, `pitchfork_perfect`, `mercury_prize` (Western);
  `kr_masterpiece_100`, `weiv_aoty`, `izm_aoty`, `rhythmer_hiphop`, `rhythmer_rnb`, `kha_rnb`,
  `kha_hiphop`, `kma_aoty` (Korean critic webzines/awards); `jp_mino_100` (Japanese).
- **Commercial (sales/popularity awards):** `grammy_*`, `brit_album` (Western); `golden_disc_*`,
  `mama_aoty`, `mma_aoty`, `sma_album` (Korean idol/sales).

Verified by sampling: the Korean *critical* sources contain 들국화, 검정치마, Jambinai (experimental),
Nucksal (underground rap), E Sens — **and f(x) "4 Walls"** (a critically-loved K-pop album). The
Korean *commercial* sources contain Wanna One, aespa, NCT 127, Stray Kids — pure idol. **This is
exactly the "respected K-pop vs commercial idol" distinction the product owner wanted, and it's
already in the data.**

**(d) Critical coverage is Western-biased (a problem).** Of 1,288 critically-acclaimed MBIDs, 959 are
in our catalog (album/EP + cover): **Korean 79, Japanese 9, Western 871.** So critical acclaim
*cannot be the sole taste anchor* for Korean/Japanese bots — 79 Korean albums can't feed 72 Korean
bots without absurd repetition. (Many Korean critic-list albums simply aren't *linked* to
release_groups yet — a backfill could recover more.)

---

## 5. What's implemented vs open

**Built & committed:** `is_bot` migration (applied); Bayesian `top_rated` migration (applied);
`bot-personas.ts`; `create-bots.ts` (idempotent, `--per-persona` pilot mode); `generate-bot-ratings.ts`;
`fix-native-language-mistags.ts` (applied). Pilots run successfully (8-bot, then 26-bot cross-persona).

**Not built:** the **follows/social graph** (item 5 — taste-clustered), **reviews** (item 6 —
deferred), and the **critical/commercial taste model** below (currently the sampler uses cruder
heuristics — prestige-tier + latent "discovery" tier + commercial penalties).

---

## 6. The central unresolved problem & the proposed model

**Problem:** making the bots' taste genuinely "serious / anti-commercial." Iterating on heuristics
(penalize any prestige album; latent random quality; down-weight prolific "commercial" artists) kept
either surfacing mainstream canon/idols OR overcorrecting into noise. The Korean catalog is
**idol-dominated by album count** (idols release 20+ albums; indie artists 2–3), so volume-based
sampling skews idol regardless.

**Proposed research-grounded model (replaces the heuristics):** score each album by a **3-way real
signal** from `external_scores` (not the blended prestige):
1. **Critically acclaimed** (959 albums; incl. respected K-pop like f(x), Korean indie/hip-hop) →
   **boost, high scores.** = "what music lovers rate highly."
2. **Commercial-only** (in a commercial source but NOT critical — aespa, Wanna One) → **penalize.**
3. **Neither** → **discovery tier** (latent/low weight) — the underground long-tail with no external
   coverage; keeps Korean/Japanese feeds full and provides genuine discovery.

Persona-origin split keeps it Korea-first; scoring could be anchored to the critical sources' actual
`normalized_score` so beloved albums genuinely score high.

---

## 7. Open questions — please research & evaluate these

1. **Is the critical/commercial source classification correct?** Scrutinize each source (esp. Korean:
   is `kma_aoty` critical or commercial? Are Grammys really "commercial" for this audience? Is
   `mercury_prize` reliably anti-commercial?). Propose a better classification or weighting if so.
2. **Thin Korean/Japanese critical coverage (79/9).** Is there a legitimate external source to
   broaden it (Korean critic lists, RateYourMusic-style data, Melon "critics" vs "listeners"…)?
   Note the no-scraping constraint. Is a link-backfill of existing unlinked critic-list entries the
   best lever? How should the discovery tier be shaped so Korean feeds feel curated, not random?
3. **Is there a fundamentally better taste signal than our `external_scores`?** (e.g. RateYourMusic
   ratings are the canonical serious-listener signal — but no public API and scraping is
   ToS/robots-blocked. Any legitimate alternative?)
4. **Scoring realism.** Should bot scores derive from the critical `normalized_score`, from
   per-persona harshness curves, or a blend? What score distribution does a real discerning-listener
   community actually show (mean, variance, how often 5.0 vs 3.5 vs 2.0)?
5. **Volume & shape.** 150 bots × ~80 ratings ≈ 12k ratings — is that right for populating global +
   per-genre charts, the Taste page's unlock thresholds, and a feed that isn't "5 bots talking to
   each other"? How concentrated should ratings be (albums needing ≥3 to chart)?
6. **Ranking integrity.** Given the Bayesian/calibrated leaderboard and Bayesian `top_rated`, will
   this model produce charts a serious listener would find credible? Any gaming/degenerate outcomes?
7. **Social graph.** How to build a believable taste-clustered follow graph (avoid uniform-random and
   avoid everyone following the same few)?
8. **Detectability / ethics.** Is a backdated, persona-driven bot seed acceptable pre-launch? Any tells
   that would make it obviously synthetic to a real user? (`is_bot` flag exists for later filtering.)

---

## 8. What "good" looks like

A believable community of discerning, Korea-first-but-globally-curious listeners: charts and feed
dominated by critically-respected records across origins (indie, underground hip-hop, city-pop, jazz,
shoegaze, *and* the respected slice of K-pop), mainstream idol/Top-40 present only as a small
minority, ratings that vary by persona with real spread, timestamps spread over weeks, and profiles
that read as real people. Verifiable by spot-checking a few bot profiles and the live surfaces.
