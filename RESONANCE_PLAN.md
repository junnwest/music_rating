# Resonance: plan and measurements

Source idea: `taste-map-prompt.md` → "Future direction" (four lenses; Resonance = "why does it hit *me* specifically?"). Written 2026-11-05 (overnight research track). Companion to `TASTE_MAP_PLAN.md`.

**Status (2026-11-05):** research only. Nothing built except a read-only measurement script. No migration, no UI.
- **Script:** `apps/web/scripts/analyze-resonance.ts` (read-only, service client, secrets from env). Run from `apps/web`:
  `npx tsx --env-file=.env.local scripts/analyze-resonance.ts [--users=zero,junnwest,one] [--k=7] [--top=10] [--min-pool=15]`
- **Headline finding:** with today's data, resonance as a ratings residual is **almost indistinguishable from "how much I like it"** (Spearman 0.99 with the standardized score). Ratings alone can't measure it yet. The first build has to be **cheap new signal at logging time**, not a model.
- **Next action:** Jun answers the open questions in §8, then Phase R1 (the "It's mine" tap + emotion quick-pick, private, opt-in).

---

## 1. What "resonance" means here

The prompt's framing: the gap between what a record generically evokes and how *I* respond to it. To be buildable it needs a definition that (a) is computable from data we have, (b) gets better as new signal arrives, and (c) can be checked against something the user says directly.

### Candidates

| # | Definition | Measurable now? | Problem |
|---|---|---|---|
| A | Raw score (or "favorites") | yes | That's liking, not resonance. It adds nothing to the existing Taste tab. |
| B | Score − crowd average (the existing **Taste Contradictions**) | yes, for 37% of ratings | Raw-point difference: a harsh rater "contradicts" everything. Ignores the user's own taste: loving the one rap album in a rock taste counts the same as loving the 20th rock album. |
| C | Score − what the user's own taste model predicts from sound | yes | Only meaningful if that model can predict anything. Measured below: it can't yet. |
| D | **z-score − E[z \| crowd, user's sound model]**, the expectation **gated by held-out skill** | yes | Today it collapses to ≈ A plus a small crowd correction (honest, see §3). Gets sharper automatically as data grows. |
| E | Self-report only ("this one is mine") | no (not collected) | The best label, but needs a UX change, and on its own it doesn't say *why*. |
| F | Personal emotion response − collective emotion profile | no | The prompt's long-run meaning (the Emotion lens gap). Needs emotion logging from many users first. |

### D1. Operational definition → **D now, validated by E, extended to F**

For user *u* and album *a*:

```
z(u,a)   = (score − mean_u) / max(sd_u, 0.3)                      # per-user standardization
S(u,a)   = kNN over u's OTHER rated albums by OTHER artists,        # "what my taste predicts from its sound"
           cosine on jina-v3 + genre co-occurrence centroids, shrunk toward 0
C(u,a)   = mean z of other raters of a                             # "what the crowd feels", z'd per rater
w_c      = n_c / (n_c + 2)                                          # crowd weight, shrunk for small n
g_u      = 1 if S has held-out skill for u (bootstrap 5% bound > 0), else 0
E(u,a)   = (g_u·S + w_c·C) / (1 + w_c)
R(u,a)   = z(u,a) − E(u,a)                                           # resonance
```

Rules baked into it:
1. **Standardize per user.** A 4.0 from a harsh rater and from a generous one are different events.
2. **Subtract only what can actually be predicted.** A model with no held-out skill subtracts noise, so the gate turns it off. Today the gate is off for every user (§3). As ratings grow or the sound representation improves (Phase 6 descriptors, audio), it turns on per user without a code change.
3. **Don't subtract the same-artist prior.** "I love every Yorushika album" is resonance with an artist, not an expectation to explain away. Album R aggregates to **artist R** (mean over the artist's albums) for the map. Within-artist deviation (one album hits harder than its siblings) is a separate, later view.
4. **Crowd is shrunk.** One other rater barely moves E.
5. **Validation target = self-report (E).** R is "real" only if it predicts the "It's mine" tap (§5) better than the raw score does. That's the eval gate for everything after Phase R1.
6. **Extension to F:** once emotion picks exist, add a second component `R_emo(u,a)` = how u's emotion picks for *a* differ from the collective emotion profile of *a* (which emotions I feel that others don't). R stays the intensity part, R_emo is the quality part. Both are residuals against the crowd, so the definition doesn't change shape.

Why not C or B alone: C has no predictive power yet (§3). B is noisy and blind to the user's own taste. D contains both and degrades gracefully.

---

## 2. What we can measure today

Live prod counts, 2026-11-05 (~30 profiles; 13 have any rating).

| Signal | Where | Count | Usable for resonance? |
|---|---|---|---|
| Album ratings (0.5–5, 0.1 steps) | `ratings.score` | 289 rows, 13 users, 218 albums | Yes, the core. zero 63, junnwest 40, one 27. |
| Rating timestamps | `ratings.created_at/updated_at` | all | Weakly. zero's 63 ratings were made on **6 distinct days** (one: 2): retrospective batch logging, not listening moments. |
| Re-rates | `rating_history` (trigger on score change) | 205 rows; 43 (user, album) pairs with ≥2 entries | Yes, as a **noise floor** (test-retest). Too few for "my opinion moved" analysis. |
| Review text / note on a rating | `ratings.review_text`, `ratings.note` | 25 ratings (zero 7) | Yes, later (NLP for emotion/why). Too few now. `reviews` table: 0 rows. |
| Comments on ratings | `rating_comments` | 7 | No. |
| Track ratings | `track_ratings` (keyed by `recording_id`) | 56 total, zero 2 | Not yet. |
| Instinct pairwise events | `pairwise_comparisons` (`winner_id`, `loser_id`), `track_pairwise_comparisons` | **0 rows** | No. Events *were* stored per comparison, but none exist. Instinct mode is removed in code; migration `20260810010000_remove_instinct_mode.sql` (drops both tables and `elo_*`) is **not applied in prod** yet. Don't plan on this data. |
| Listen Later | `saved_releases` | 1 | No. |
| Not interested (dislike without listening) | `not_interested` | 3 | No (yet). Useful later for boundaries. |
| Essentials (6 defining albums) | `pinned_albums` | 0 | Would be an identity-music label. Nobody has set any. |
| Daily question answers | `daily_questions` (30) / `daily_answers` (`release_id`, `note`) | 1 answer | An existing prompt surface that could carry resonance questions. |
| Spotify recently played | `profiles.spotify_recently_played` | 1 user (junnwest) | No. |
| Crowd baseline | other users' ratings | 39 albums with ≥2 raters; 103/275 pooled ratings have ≥1 other rater | Partly (§3). |
| Critic baseline | `release_groups.prestige_score` (from `external_scores`: Grammy, Mercury, KMA, Pitchfork, RS500…) | 68/218 rated albums | Tested: unrelated to users' scores (§3). |
| Sound representation | `release_groups.embedding` (jina-v3 over "title by artist. tags (year)", **text, not audio**), genre centroids | 214/218 and 200/218 rated albums | Yes, but they predict little (§3). |

**Missing entirely:** emotion, "this part" moments, life context (period, place, people), why-I-like-it, the it's-mine vs it's-good distinction, listening counts and repeat bursts (no scrobbles), and any audio-derived features.

---

## 3. Measured findings (2026-11-05)

From `analyze-resonance.ts`, k = 7 (k = 4 and 12 give the same conclusions). Skill = 1 − MSE/MSE(predict user mean), leave-one-out, in z units. ρ = Spearman.

### 3.1 Can a user's own taste predict their scores? Mostly no.

| User (n) | Same-artist prior | jina kNN | jina, other artists | genre kNN | genre, other artists | sound, other artists | 
|---|---|---|---|---|---|---|
| zero (63) | **0.45** / ρ 0.71 | 0.11 / 0.36 | −0.09 / 0.08 | 0.19 / 0.43 | 0.06 / 0.35 | 0.03 / 0.25 |
| junnwest (40) | 0.02 | 0.05 | 0.03 | −0.09 | −0.05 | 0.01 |
| one (27) | 0.08 | −0.02 | −0.08 | −0.19 | −0.22 | −0.14 |
| 7 users ≥15 ratings, pooled (275) | 0.14 | −0.03 | −0.12 | −0.01 | −0.06 | −0.06 |

zero, bootstrap 90% intervals: same-artist prior [0.35, 0.55]; sound from other artists [−0.18, 0.22]; jina from other artists [−0.37, 0.09].

- The only reliable predictor is **"how do I rate this artist's other albums"**, and only for zero, the one user with several albums per artist.
- The embedding signal for zero is the artist leaking through: jina skill drops from 0.11 to −0.09 once same-artist neighbors are excluded. That fits what jina actually embeds (title, artist, tags, year; see TASTE_MAP_PLAN's era finding).
- **Cross-artist "sound" prediction has no held-out skill for anyone.** So the D1 gate is off for every user today.

### 3.2 Crowd and critics

- Crowd: Pearson(z, crowd z) = **0.41** (n = 103 ratings with ≥1 other rater), **0.52** (n = 58 with ≥2). The crowd carries real expectation, but it exists for only about a third of ratings.
- Critics: Spearman(z, prestige_score) = **−0.01** (n = 88). Award and list prestige doesn't predict how these users rate. Don't use it as the "generic" baseline.
- Resonance twins are infeasible now: 33 user pairs share ≥1 rated album, 12 share ≥5, 3 share ≥10, the maximum is 15 (zero's best overlap is 14).

### 3.3 Noise floor

- Re-rated albums (43 pairs): the median within-album sd is 0.31 z. Median |last − first| is **0.50 z**, the 75th percentile 1.19 z. For zero (sd 0.48) that's about ±0.25 stars median.
- The residual sd under the full model is 0.93 z. So **|R| < ~0.5 is inside normal re-rate wobble**, and only |R| ≳ 1.2 clearly exceeds it. A UI that shows small resonance differences would be showing noise.

### 3.4 Do people act on residuals?

- Reviewed/noted ratings (n = 24): mean residual +0.41 vs −0.03 for the rest. But their raw z is +0.56 vs −0.05, so people write about records they **like**. The residual adds nothing beyond liking.
- Re-rated albums (n = 30): mean |residual| 0.58 vs 0.77. Re-rating isn't a resonance marker.

### 3.5 zero's resonance lists

**Recommended definition (D1, gate off, crowd only):** Spearman with raw z = **0.99**. Only 5 of 63 albums move by more than 0.3 z. Top positive: Coldplay *Parachutes* (4.5), Oasis *(What's the Story) Morning Glory?* (4.5), Coldplay *A Rush of Blood to the Head* (4.3), ヨルシカ *二人称* (4.5; crowd also high), ヨルシカ *だから僕は音楽を辞めた*, amazarashi *爆弾の作り方* and *Message Bottle*, E SENS *The Anecdote*, Train *Drops of Jupiter*, 김광석 *4집*. Top negative: 기리보이 *치명적인 앨범 Ⅲ* (2.4), Shawn Mendes *Wonder*, 기리보이 *Graduation*, Kid Milli *Maiden Voyage III*, Changmo *Boyhood*. **This is the favorites list.** The crowd adjustment is too thin to change it.

**Exploratory "pattern-break" list (full self model incl. same-artist and same-genre neighbors, NOT gated):** Spearman with raw z 0.90; Jaccard 0.54 with the raw top-10. Records it promotes above their raw rank:
- 짙은 *백야* (3.9, expected 3.27: its nearest neighbors are rated low)
- E SENS *The Anecdote* (4.3 inside a K-hip-hop neighborhood zero rates low: Giriboy, Kid Milli, Changmo)
- 김광석 *4집* (4.1)
- Avicii *TIM* (4.0)

These have **face validity**: they're the records that "matter beyond their genre", which is exactly what the prompt means. The top-10 is fairly stable across representations (Jaccard 0.82 vs self-only, 0.67 jina-only, 0.54 genre-only). **But** the genre and jina components behind these shifts have no held-out skill, so this list is anecdote, not measurement. Use it as the **design target**: a working resonance metric should surface records like E SENS here, and the R1 self-report will tell us whether it's right.

### 3.6 Verdict

1. At 63 ratings, resonance can't be separated from liking using ratings. The signal isn't noise; it's **not identifiable**: the "expected" term has nothing to subtract.
2. The crowd term is real (r ≈ 0.4–0.5) but covers too few ratings to matter until there are ~10× more users or overlap.
3. The fastest route to a measurable construct is **one new label** (the "It's mine" tap) plus **one new feature family** (emotion picks), not a better model.
4. Re-run the script at each phase gate. It's the baseline every later model must beat.

---

## 4. Design decisions

### D2. Grain → **album first; tracks and moments are optional children**
sillajuku is album-first, and the taste map's nodes are built from albums. Resonance is logged on the album rating. A "this part" mark is an optional child that points at a track (`recording_id`) and a time. Don't require track-level logging: 56 track ratings exist in total.

### D3. Logging budget → **zero required taps, one optional tap row, one optional follow-up**
The rating flow stays exactly as it is. Below the score, one optional row appears. Everything else lives behind "more" or comes as a later, skippable prompt. The cost of a resonance feature that slows down rating is higher than its value.

### D4. Emotion vocabulary → **GEMS-9, shown as 9 words, pick up to 3**
GEMS (Zentner et al. 2008) is built for *felt* music emotion, not perceived emotion, which is the right side of the resonance gap. The 9 factors: wonder, transcendence, tenderness, nostalgia, peacefulness, power, joyful activation, tension, sadness. Show plain words (ko/en/ja), no wheel, no sliders. Valence/arousal can be derived from the picks later; don't ask for it.

### D5. Storage → **one private event table, controlled vocab in TypeScript**
One additive table keeps one RLS policy, one export path and one "delete everything" path. Vocabularies live in `lib/resonance/vocab.ts` (like the taxonomy), so adding a moment kind isn't a migration.

### D6. Privacy → **off by default, private always, aggregate only with k ≥ 5**
- One opt-in switch ("Reflections") in settings. Off = no row is shown and none is written.
- Rows are owner-only (RLS). They never appear in feed, activity, notifications or public profiles. That also covers comment-style visibility levels: there is no "public" setting for these rows.
- Collective emotion profiles use only opted-in users' picks, shown only when ≥ 5 distinct users picked for that album.
- Export (JSON) and "delete all my reflections" from day one.
- Free text is never sent to an LLM unless a second opt-in is on. When it is, store only the extracted labels plus the user's own text, never model outputs about the person.
- No engagement use: resonance never ranks the feed or schedules notifications (the prompt's anti-manipulation rule).

### D7. Computation → **Node, on demand, cached per user**
Same rule as the taste system: the Micro DB stores inputs only. `lib/resonance/score.ts` computes R per user on request (≈ hundreds of rows, milliseconds) and caches in Redis keyed by the user's ratings/reflections hash. No triggers.

### D8. Eval gate → **R must beat the raw score at predicting the "It's mine" tap**
Metric: AUC of R vs AUC of raw z for predicting `mine`, over opted-in users, leave-one-user-out. Until R wins, the UI calls the view "Your standouts" (honest: it's liking) and doesn't say "resonance".

---

## 5. Logging UX proposals

All optional, all behind the D6 opt-in. Listed in build order.

| # | Proposal | Interaction | Feeds | Notes |
|---|---|---|---|---|
| 1 | **"It's mine" tap** | One toggle under the score: **Good record · It's mine**. Unset is the default. | The **validation label** for R (D8). Also separates identity music from quality, which is the prompt's "guilty pleasures vs identity" idea and fits VISION's "taste as identity". | The cheapest high-value label we can collect. Its gap to the score is resonance by definition: a 3.8 that's "mine" vs a 4.5 that's just "good". |
| 2 | **Emotion quick-pick** | The same row expands to 9 GEMS chips; pick ≤ 3. | Personal emotion fingerprint, the Emotion lens, collective emotion profiles, R_emo (D1 rule 6). | Chips, not a wheel. Prefill nothing (no anchoring on the crowd). |
| 3 | **"Why" follow-up after a high or "mine" rating** | Shown at most once per session, only if score ≥ user's 80th percentile or `mine`. "What got you?": chips **sound · voice · lyrics · a memory · a person · a time in my life · it's just me** + optional one line. | Explains R: sound-explained (Music lens can learn it) vs life-explained (only moments can). It's also the prompt's "Why I like it" interview, without an LLM in the loop. | An LLM follow-up question is Phase R4, and only if the chips plateau. |
| 4 | **Moment tags** | Under "more": period (year or life stage), place, with whom, activity, origin ("a friend", "an anime", "a show", "found it myself"). All chips plus optional short text. | Resonance timeline, taste origins (the family tree on the map), context recommendations later. | The origin chip is what powers "taste origins" for the map. |
| 5 | **"This part" mark** | On a track row: tap → time picker prefilled from the preview player if one is playing → kind (chills · lyric · drop · other) + optional lyric line. | Frisson/arousal research, moment-level nodes (TASTE_MAP_PLAN reserved generic `node_key` for this), later alignment with audio features. | Lowest volume, highest specificity. Build last. |
| 6 | **Near-miss / not for me** | On a rating ≤ the user's 20th percentile: optional chips "almost · not my sound · not my language · overhyped". `not_interested` already exists for unheard records. | Taste boundaries (aesthetic lens). Negative R becomes explainable. | Cheap, reuses proposal 3's UI. |

Reuse what exists: the **daily question** surface (`daily_questions`/`daily_answers`, 30 questions, 1 answer) can carry the occasional resonance prompt ("A record that got you through a hard month?"). Answers become moment rows plus an implicit `mine`.

### Data model sketch (additive; not a migration yet)

```sql
-- Owner-only RLS (select/insert/update/delete where auth.uid() = user_id). No public policy.
CREATE TABLE reflections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  release_group_id uuid NOT NULL REFERENCES release_groups(id) ON DELETE CASCADE,
  recording_id     uuid NULL REFERENCES recordings(id) ON DELETE CASCADE,  -- "this part" only
  kind             text NOT NULL CHECK (kind IN ('verdict','emotion','why','moment','mark','nearmiss')),
  code             text NOT NULL,      -- vocab code: 'mine'|'good', GEMS id, why facet, moment kind:value, mark kind
  t_ms             int  NULL,          -- "this part" offset
  text             text NULL CHECK (char_length(text) <= 280),
  source           text NOT NULL DEFAULT 'rating' CHECK (source IN ('rating','prompt','daily','import')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reflections (user_id, release_group_id);
CREATE UNIQUE INDEX reflections_one_verdict ON reflections (user_id, release_group_id) WHERE kind = 'verdict';

ALTER TABLE profiles ADD COLUMN reflections_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN reflections_aggregate boolean NOT NULL DEFAULT false;  -- may count toward k≥5 crowd profiles
ALTER TABLE profiles ADD COLUMN reflections_llm boolean NOT NULL DEFAULT false;        -- may send free text to an LLM
```

Collective emotion profiles are computed by a service-role script/route over opted-in rows and cached as `{release_group_id → GEMS distribution, n}` with n ≥ 5. Nothing per-user is exposed. Deleting a rating does **not** cascade to reflections automatically (a user may un-rate and keep the memory). The delete-all path handles both.

---

## 6. How it plugs into the taste map

The map engine and UI belong to the taste-map work (`lib/tasteMap/**`, `components/sj/tasteMap/**`, `/api/taste/map/**`). This plan only defines contracts. Whoever owns those files builds against them.

1. **Resonance lens v0, a color lens with no layout change.** It sits next to Sound/Score/Distortion. Node color = the artist's R (mean album R, weighted by album count, diverging scale), opacity = confidence (n albums, crowd n). Payload addition, optional like `mix`: `node.resonance?: { r: number; nAlbums: number; crowdN: number; mine: number }` (`mine` = share of the artist's albums marked "It's mine"). Until D8 passes, label it **Standouts**.
2. **"Where I diverge from the crowd."** On select, the inspector shows the artist's albums with `z`, crowd `C` (n) and R. On the map, a ring on nodes with |crowd residual| ≥ 1.2 z and n_c ≥ 2 (§3.3's noise floor). This replaces the raw-point Taste Contradictions logic with the z-scored, shrunk version. ⚠ Note: `app/api/contradictions/route.ts` still selects `ratings.release_id` / `releases(...)`, which the live `ratings` table no longer has (`release_group_id`). It likely returns nothing today. Not touched here; flagging it.
3. **Resonance layout lens (later).** A `taste_map_layouts` / `taste_map_metric` row with `lens = 'resonance'`, no schema change. Features per artist: GEMS distribution of the user's picks + why-facet shares + R. This is the prompt's "Bastille and Yorushika far apart in sound, adjacent in emotion" view. Only after R2 has data, and only for users with ≥ 30 emotion-tagged albums.
4. **Resonance twins.** Similarity between two users = cosine of their **crowd-residual** vectors (z − C) over co-rated albums, shrunk by overlap (`n/(n+10)`), plus (after R2) the overlap of their emotion picks on shared albums. That's "people who feel the same records the same way", not "people who rate the same". Infeasible until pairs share ≥ 10 albums: 3 pairs do today. Start as the friend overlay already sketched in TASTE_MAP_PLAN §5.
5. **Taste origins.** Origin moment tags (proposal 4) draw a faint "came from" edge on the map: friend → artist, anime → artist. A family tree of influence, as the prompt describes.
6. **Resonance timeline.** On a year axis, the artists with the highest R by the `period` moment (or rating date as a fallback, which is weak: §2 timestamps are batch logging).

---

## 7. Executable phases

Each phase ends with a re-run of `analyze-resonance.ts` (extended as needed) and a README/SESSIONS update.

### Phase R0: Measure (done, 2026-11-05)
- [x] `scripts/analyze-resonance.ts`: self-model skill, crowd agreement, noise floor, behavioral correlates, top lists, robustness.
- [x] Findings in §3. Verdict: not identifiable from ratings alone.

### Phase R1: The label (1–2 sessions, web + iOS)
- [ ] Migration: `reflections` + the three profile flags (§5). Owner-only RLS. Apply via `db-exec.ts`.
- [ ] Settings: "Reflections" opt-in with a one-paragraph explanation, export JSON, delete all.
- [ ] Rating sheet: **Good record · It's mine** toggle (web first; iOS needs the Mac).
- [ ] Emotion quick-pick (GEMS-9, ≤ 3) in the same expandable row.
- [ ] `lib/resonance/vocab.ts` (codes + ko/en/ja labels) and `lib/resonance/score.ts` (D1, pure, unit-tested on a fixture of zero's ratings).
- [ ] Jun backfills "It's mine" on his 63 albums (≈ 2 minutes). That's the first eval set.
- **Exit / gate:** ≥ 3 opted-in users with ≥ 30 verdicts. Compute D8 (AUC of R vs raw z for `mine`). Record it here.

### Phase R2: Why and emotion, collective (1–2 sessions)
- [ ] "What got you?" follow-up (proposal 3) and near-miss chips (proposal 6).
- [ ] Collective emotion profile job (k ≥ 5, opted-in only) and R_emo.
- [ ] Album page: "How it makes people feel" (only when n ≥ 5), plus "you felt X, most felt Y" for the owner only.
- [ ] Extend the analysis script: does `why = memory/person/time` explain positive R that sound doesn't? (That's the prompt's "explain the residual with life context".)
- **Gate:** R_emo or why-facets improve D8 AUC over R alone. If not, keep collecting and stop building.

### Phase R3: Map integration (1 session, coordinated with the taste-map owner)
- [ ] Payload `node.resonance` (§6.1) and the Standouts/Resonance color lens.
- [ ] Diverge-from-crowd inspector + rings (§6.2) with the 1.2 z threshold.
- [ ] Fix-or-retire decision for `/api/contradictions` (Jun's call).
- **Gate:** Jun's sign-off on whether the lens tells him something the Score lens doesn't.

### Phase R4: Moments, origins, twins (research, each gated)
- [ ] Moment tags + origin edges (§6.5); "this part" marks on tracks.
- [ ] Resonance twins when ≥ 20 user pairs share ≥ 10 albums.
- [ ] Resonance layout lens (§6.3) when ≥ 30 emotion-tagged albums per user.
- [ ] LLM "why" interview, only if chip answers plateau, behind `reflections_llm`.
- [ ] Sound gate re-test after TASTE_MAP_PLAN Phase 6 descriptors / audio: does cross-artist S gain held-out skill?

---

## 8. Risks and open questions

**Risks**
1. **Construct risk:** "It's mine" may just track the score (r > 0.9). Then the resonance label adds nothing and the honest product is "Standouts". The D8 gate catches this. Mitigation: the copy should make clear that "mine" ≠ "best" ("not the best, the most *you*").
2. **Volume:** ~30 users. Collective emotion maps need k ≥ 5 per album. With 39 albums at ≥ 2 raters, few albums will qualify within months. Personal features (verdict, why, emotion fingerprint) must stand alone.
3. **Logging friction** lowers rating volume. The row stays optional and collapsed after the first use if ignored 5 times.
4. **Sensitive data:** emotion and life context are sensitive personal data. D6 is non-negotiable. Treat a leak of reflections like a leak of DMs.
5. **Retrospective logging:** ratings are batch-entered (zero: 63 ratings over 6 days), so "moment" timestamps must be asked, not inferred from `created_at`.
6. **Representation:** jina vectors embed text metadata, not sound. Any "sound predicts nothing" conclusion is really "metadata predicts nothing". Re-test after descriptors/audio.

**Open questions for Jun**
1. Is **"Good record · It's mine"** the right wording and the right first label? Alternatives: a heart, "Essentials candidate", or reusing `pinned_albums` (0 rows today) as the identity set.
2. Opt-in granularity: one switch for everything (recommended), or separate switches for emotions and moments?
3. Should verdicts and emotion picks ever be visible to followers (e.g., "felt: nostalgia" on a rating card), or private forever? This plan assumes private forever.
4. Instinct is gone in code, but its tables and `elo_*` columns are still in prod (removal migration not applied) and hold 0 events. Apply the removal, or keep the tables for a future "A or B?" active-learning prompt (TASTE_MAP_PLAN Phase 7.1)?
5. `/api/contradictions` appears broken against the current schema. Fix it with the z-scored version from §6.2, or retire it in favor of the map view?
6. GEMS-9 or a smaller custom set (for example 6 words that read naturally in Korean)? Korean and Japanese labels need Jun's ear.
7. Is "taste origins" (a friend / an anime / a life period) something Jun would actually fill in for old records, or only for new ones?
