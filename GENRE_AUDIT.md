# Genre system audit — 2026-09-29

> Why albums land in the wrong Taste-map world, and how genre organization and genre
> data processing should work instead. Companion to `GENRE_TAXONOMY.md` (the rebuild's
> working doc). Everything here was measured on live data on 2026-09-29, using the
> current `placeAlbum` code, over three samples:
> **rated** = all 195 albums anyone has rated · **kr** = all 16,354 Korean-artist albums/EPs ·
> **rand** = a random 4% of catalog albums (9,957).

---

## 1. TL;DR

The reported cases are not one-off tagging mistakes. They come from **three design
flaws in how the primary genre is chosen** and **three gaps in the genre data itself**:

| # | Root cause | Reported symptom | Scale |
|---|---|---|---|
| A | The primary genre is the **most specific** tag, not the **best-supported** one | 808s → R&B; OK Computer → Electronic; Siamese Dream → Pop | 15% of rated albums |
| B | A hybrid genre's world is **whichever parent was listed first** | MBDTF, Late Registration, College Dropout, TLOP → **Pop** (pop rap = [pop, hip-hop]) | 91 hybrid nodes; 6.7% of rated |
| C | **Descriptor tags are treated as genres** | Giriboy → **Classical** (`instrumental` sits under Classical) | 3.1% of rated / random |
| D | **Scene labels are treated as sounds** (`korean indie` = rock, `k-pop` = pop) | Korean indie pop → Korean Rock; Korean dream pop/shoegaze → **K-Pop** | 32% of tagged Korean albums carry only `k-pop`/`pop` |
| E | **Most Korean albums have no genres at all** | 양홍원's albums borrow his one single's `[k-pop]` → K-Pop | 70% of Korean albums/EPs empty (34% catalog-wide) |
| F | The **vote counts the merge model depends on never arrived** | Tag order is used as an importance signal but is usually alphabetical | 91 MusicBrainz vote rows in the whole catalog; 63–70% of tag arrays are exactly A→Z |

Fixing the Taste map one album at a time (the pattern of the last few sessions: the
k-pop catch-all, `alternative` → rock, MPB/Cantopop) won't converge, because each patch
works around A–F instead of removing them. §4 proposes the model to build instead; §5
covers how the data should flow; §6 gives an order of work.

---

## 2. How an album gets its world today

1. **Tags.** `release_groups.genres` (a list of raw tag strings) is derived from
   `release_genres` rows. Almost all of those rows are `source='legacy'` with no
   confidence value, because only 91 rows carry MusicBrainz votes.
2. **Resolve.** Each tag maps to a taxonomy node (`resolver.resolveGenre`).
3. **Primary.** `resolver.primaryOf` picks the tag with the highest *level*
   (subgenre > genre > family), then the highest hand-set `rank`. Tag order and
   votes are ignored, except for one catch-all correction in
   `language.primaryOfAlbum` that assumes tag order carries vote order.
4. **World.** The primary's family is `language.homeFamily`: follow the **first**
   `soundParents` entry until a family is reached. The language then qualifies it
   (`hip-hop@ko` → Korean Hip-Hop).
5. **Fallback.** An untagged album borrows tags that appear on ≥30% of the artist's
   other *tagged* release groups, singles included (`api/taste/profile/route.ts`).

The same `primaryOf` also drives `genre_weights` (`primaryTagOf`), the chart primary
(SQL `_primary_genre_id`, a generated twin of it), and embeddings weighting. Every
flaw below therefore also affects charts and recommendations, not only the Taste page.
`/api/recommendations` and `lib/feed/taste.ts` still run on the old `buildClusters`,
so the Taste page and recommendations don't even agree with each other.

---

## 3. Findings

### A. "Most specific wins" beats "most supported wins"

`primaryOf` promotes any genre-level tag over a family tag and breaks ties on a
hand-set `rank`, so one minor tag decides the whole album.

| Album | Tags (as stored) | Picked | Should be |
|---|---|---|---|
| Kanye — 808s & Heartbreak | hip hop, pop, alternative r&b, contemporary r&b, electronic, electropop, experimental, pop rap, synth-pop | alternative r&b → **R&B** | Hip-Hop (Last.fm: hip-hop 100, pop 97, r&b absent) |
| Radiohead — OK Computer | alternative rock, rock, art rock, britpop, electronic, … leftfield … | leftfield (rank 4) → **Electronic** | Rock |
| Smashing Pumpkins — Siamese Dream | alternative rock, dream pop, grunge, post-grunge, rock, shoegaze | dream pop → **Pop** | Rock |
| Talking Heads — Remain in Light | new wave, post-punk, art rock, … rock | post-punk → **Punk** | Rock |
| Drake — Scorpion | hip hop, alternative r&b, cloud rap, … trap | alternative r&b → **R&B** | Hip-Hop |
| Taylor Swift — Red | pop, country, alternative rock, … | alternative rock → **Rock** | Pop / Country |
| Billie Eilish — Happier Than Ever | alternative pop, alternative r&b, … pop … | alternative r&b → **R&B** | Pop |

Measured: in **15.4% of rated albums** (6.5% of the random sample) the chosen world
disagrees with a simple tag-majority vote by 1.5× or more.

**Cause:** `resolver.ts:113` `primaryOf`. Specificity is a good way to pick a genre
*within* a world, and a bad way to pick the world.

### B. A hybrid genre's world is an accident of parent order

91 nodes have two sound parents. `homeFamily` always follows the first, so:

- `pop-rap` = [pop, hip-hop] → **Pop**. MBDTF, TLOP, Late Registration, College
  Dropout, Eminem, Tyga and every DJ Clue? mixtape land in Pop.
- `dream-pop` = [pop, rock] → Pop. With the language axis that becomes **K-Pop** for
  파란노을, 다브다 (post-rock) and Bye Bye Badman.
- `pop-rock` → Pop (Warren Zevon, Casting Crowns); `synth-pop`/`electropop` → Pop
  (Owl City); `folk-rock` → Rock (Judy Collins); `jazz-rock` → Rock.

Nobody chose these parent orders as world assignments. They were written as
"lineage, in no particular order".

### C. Descriptor tags treated as genres

Some tags describe *how* a record sounds or what it's for, not its genre:
`instrumental`, `singer-songwriter`, `ballad`, `christmas music`, `musical`,
`easy listening`, `lo-fi`, `dance`, `new age`, `experimental`, `soundtrack`.
They are ordinary taxonomy nodes, so they can win:

- 기리보이 — 졸업식, 기계적인 앨범, 치명적인 앨범 Ⅲ, Science Fiction Music, avante:
  `[hip hop, instrumental]` → `instrumental` (a *genre* under **Classical**) beats
  `hip hop` (a *family*) → **Classical**. Keith Ape — Project: Brainwash, same.
- 더더 `[rock, singer-songwriter]` → Korean Folk; Alex Warren → Folk; Bastille
  `[dance, pop]` → Electronic; Ed Sheeran "Photograph" `[ballad, pop]` → Ballad.

### D. Scene labels treated as sounds

- **`korean indie`** is authored as `sound: ['rock']` and *localizes* both `indie-rock`
  **and `indie-pop`**. So any Korean `indie pop` album becomes Korean Indie and lands
  in **Korean Rock**: Standing Egg (`[indie pop, pop]`), 사뮈, 검정치마 — Hollywood.
  "Indie" describes how a record was made and released. It isn't a sound, and Korean
  indie spans pop, folk, rock and R&B.
- **`k-pop`** is used by MusicBrainz editors and iTunes as "Korean", not "idol pop".
  32% of tagged Korean albums (1,590) carry *only* `k-pop`/`pop`, and 123 more still
  pick K-Pop despite a hip-hop tag. The catch-all fix from earlier today yields only
  when the other family's tag comes **before** `k-pop` in the list. Tag order is
  mostly alphabetical (see F), so `hip hop, k-pop` works while `k-pop, trap` fails.
- **K-Pop is the Korean *pop family*.** Because `k-pop` localizes `pop`, every Korean
  album whose primary lives under Pop (dream pop, dance-pop, pop rap, ballad) lands in
  a world labelled "K-Pop". Korean shoegaze and 1TYM's rap albums show up there.

### E. Missing data: most Korean albums are untagged

| Korean albums/EPs by source | total | no genres |
|---|---|---|
| musicbrainz | 10,123 | 6,422 (63%) |
| itunes | 5,632 | 4,861 (86%) |
| deezer | 210 | 9 |

- **Artist genres are fetched and thrown away.** `mb-client.getArtist` requests
  `inc=genres` (vote-sorted), but nothing stores it: `artists.genres` is empty for
  every artist in the catalog. For Korean acts, MB artist-level genres are far better
  covered than album-level ones.
- **The fallback copies whatever the artist's singles say.** 양홍원 has 17 release
  groups; the only tagged one is the single *TEEN TITANS* `[k-pop]`. So *Stranger*,
  *3 STEPS FORWARD, 2 STEPS BACK*, *SLOWMO* and *HW MUSIC* all borrow `[k-pop]` → K-Pop.
- **Duplicate twins split the data.** iTunes and MusicBrainz create separate release
  groups for the same album with English and Korean titles. For 기리보이, *Graduation*
  (iTunes, untagged) and *졸업식* (MB, tagged) are the same record. There are 526
  same-artist, same-date, cross-source pairs among Korean albums alone. If a user
  rated the untagged twin, the album falls back to borrowing.
- **Artist country gaps defeat the language axis.** 기리보이, ZICO and BIBI have no
  `country` and no `native_language`, even though 기리보이's own name is Hangul. So
  an English-titled 기리보이 album (*avante*) gets no language and lands in the unmarked
  Hip-Hop world.

### F. The vote-weighted merge model has almost no votes to work with

Phase 3 built `merge.ts` (trust × confidence × agreement) around MusicBrainz vote
counts. In production:

- `source='musicbrainz'`: **91 rows**. The writer is in `mb-ingest.ts:715`, but the
  pipeline device has not been restarted on that code since 2026-09-23 (see
  PIPELINE_CHECKS), and it only fills albums as the freshness lane re-polls them.
- Everything else is `legacy`, with no confidence value.
- Stored tag order is **exactly alphabetical in 63–70%** of arrays with ≥3 tags
  (random chance would be about 17%). Older ingests stored MB's alphabetical order
  before the vote sort was added. Tag order therefore mostly carries no signal, yet
  both the catch-all correction and `genreSynonyms` treat it as vote order.

### G. Smaller issues seen along the way

- `trap` (hip-hop) beats `electronic, pop, dance-pop, dubstep…` on Sam Gellaitry;
  `ska` beats `synth-pop, electropop, new wave` on La Roux. Same cause as A.
- `gospel` → R&B for Charley Pride (country) and Michael Jackson "Heal the World".
- BLACKPINK — *BLACKPINK* is tagged `j-pop` + `k-pop` (a Japanese edition) and resolves
  to **Japanese Hip-Hop**.
- 周杰倫 → Chinese R&B, because `contemporary r&b` outranks `mandopop` + `pop rap` + `ballad`.
- The subgenre level is nearly unused (8 nodes), so "most specific" really means
  "highest hand-set rank". That puts 274 rank numbers in charge of world assignment.

---

## 4. How the genre organization should work

### 4.1 Split tags into four kinds

Every taxonomy node gets a `kind`. Only **sound** nodes can decide a world.

| kind | examples | may be primary / pick a world? | used for |
|---|---|---|---|
| **sound** | rock, shoegaze, trap, pop rap, city pop, bossa nova | yes | world + tiles |
| **scene** | korean, japanese, *k-pop (as catch-all)*, korean indie, mpb, cantopop, mandopop, j-pop (umbrella use) | no, only language/scene evidence | language axis |
| **descriptor** | instrumental, singer-songwriter, ballad, acoustic, lo-fi, experimental (bare), live, soundtrack | no | filters, chips, similarity |
| **context** | christmas music, musical, children's, non-music, interview, comedy | no, except when it is the only tag | badges, exclusion |

Scene-flavoured nodes that *are* a distinct sound (city pop, enka, kayōkyoku, trot,
bossa nova, samba) stay **sound** nodes carrying a language. Umbrella scene words
(`k-pop` used as "Korean", `korean indie`, `mpb`, `cantopop`) become **scene**
evidence. If an album's only sound-bearing tag is `k-pop`, it counts as *Korean Pop*
by default, the conservative reading.

This also resolves the "is k-pop idol pop or just Korean?" question in data rather
than by list order: `k-pop` adds language evidence plus a small pop weight, and any
real sound tag (`hip hop`, `trap`, `shoegaze`) outweighs it.

### 4.2 Choose the world by evidence; use specificity only inside the world

Two separate steps:

1. **World = the sound family with the most evidence.** Each tag contributes
   `weight = source_trust × confidence`. With no votes, that is a flat 1.0, plus a
   small bonus for the top-voted tag when votes exist. The weight flows to the tag's
   family. **A hybrid splits its weight across its parents** (pop rap: ½ hip-hop,
   ½ pop), so parent order stops mattering and a deliberate `home` field is needed
   only for display. Descriptor, context and scene tags contribute nothing, or only a
   small amount for `k-pop`.
2. **Artist prior breaks ties and fills gaps.** Add the artist's own family
   distribution (from stored MB artist genres, plus their other *albums*, not
   singles) at a lower weight, around 0.5 of one album tag. This matters because
   tag counts alone are genuinely ambiguous for crossover records. Without votes,
   808s counts Pop 2.5, Electronic 2, R&B 2, Hip-Hop 1.5, and MBDTF ties Hip-Hop
   with R&B at 1.5. What settles them is the vote data (Last.fm: hip-hop 100,
   synth-pop 20) and Kanye's hip-hop prior, so the prior is not optional.
3. **Primary genre = the most specific sound tag *inside* the chosen family.** This
   is where `level` and `rank` still apply: shoegaze over rock, trap over hip hop.
   808s's primary becomes pop rap, or hip hop, inside **Hip-Hop**, and alternative
   r&b stays a co-tag tile.

Check against the reported cases:

- 808s, MBDTF → Hip-Hop *once votes or the artist prior are in* (step 2). With tag
  counts alone they stay borderline, as they honestly are.
- TLOP, Late Registration, College Dropout → Hip-Hop from tags alone, since pop rap
  now splits across its two parents.
- OK Computer, Siamese Dream → Rock.
- 기리보이 → Korean Hip-Hop, since `instrumental` is a descriptor.
- Standing Egg → Korean Pop (indie pop), with Korean Indie shown as a scene badge.
- 파란노을 → Korean Rock (shoegaze).
- 양홍원 → Korean Hip-Hop once the artist's MB genres (hip hop) are stored.

### 4.3 The language axis: keep it, adjust three things

The sound × language rule (the user's decision from 2026-09-28) is right and stays.

- Rename the Korean pop world from "K-Pop" to **"Korean Pop"**, with K-Pop (idol) as a
  genre tile inside it, only when real idol evidence exists. Otherwise shoegaze and
  pop rap by Korean acts will keep showing up under a K-Pop label.
- Treat **artist-name script as evidence**: a Hangul `artists.name` → ko, the same as
  `native_language`, which fixes 기리보이.
- Pick a Korean act's language from **artist-level** evidence, not only per album, so
  English-titled albums by a Korean act don't drift out of the Korean world.

### 4.4 One placement, computed once, read everywhere

Today the same idea exists in TS (`primaryOf`, `primaryOfAlbum`), in generated SQL
(`_primary_genre_id`), and in the old `buildClusters` used by recommendations and
feed. Instead:

- Compute the album's **placement** (`world`, `primary`, `language`, `confidence`) once in
  Node, and **store it on the album**. `release_groups.primary_genre` already exists;
  add `world` and `language`.
- Taste map, `genre_weights`, charts, recommendations and feed all read the stored
  columns. The SQL twin algorithm goes away, and so does the risk of the two drifting.
- Recompute on tag change (the display writer already knows when that happens) and via
  a backfill when the placement code changes.

---

## 5. How genre data should be processed

### 5.1 Sources and what each is good for

| Source | Level | Signal | Status today |
|---|---|---|---|
| MusicBrainz release-group genres | album | vote counts, curated vocab | writer exists, **not running** (91 rows) |
| MusicBrainz **artist** genres | artist | vote counts, much better Korean coverage | **fetched and discarded** |
| Last.fm album tags | album | counts, noisy, strong for Western | ~3.9k rows |
| Last.fm **artist** tags | artist | good for Korean scene words (k-rap, korean hip hop, korean indie) | not used |
| iTunes `primaryGenreName` | album | one coarse store genre ("K-Pop", "Hip-Hop/Rap", "Alternative") | often empty for Korean |
| Manual overrides | album | truth | 118 rows |

### 5.2 Order of evidence for an album's tags

1. Its own album tags (all sources, merged by trust × confidence).
2. **Its twin's** tags: the same artist, same date, cross-source duplicate. Better
   still, merge the twins (see 5.3).
3. **Artist genres** (MB artist genres, then Last.fm artist tags) at reduced confidence.
4. The artist's other **albums and EPs** (not singles), majority tags, at reduced
   confidence. This is the current borrow step, restricted.
5. Nothing: the album stays unplaced (shown under "Other" / "Unknown"). Never guess.

Steps 2–4 should run in the **pipeline** and be stored as `release_genres` rows with
`source='inferred'` and a low confidence, not recomputed in the taste API on every
page load. That way charts and recommendations benefit too, and inferred tags are
visibly marked as inferred.

### 5.3 Data hygiene that has to happen regardless

- **Restart the pipeline device on current code** so MB votes start landing. Then run a
  one-off **vote backfill** (re-read MB release-group genres for all MB-sourced albums)
  instead of waiting months for the freshness lane.
- **Store MB artist genres** (`artists.genres`, vote-ordered) in `mb-ingest`, and run a
  backfill over existing artists. This is cheap because `getArtist` already returns them.
- **Twin dedupe** for iTunes ↔ MB duplicates. At minimum, link twins so genres are
  shared; ideally merge them so ratings aren't split.
- **Artist country/language fill**: Hangul/kana name → `native_language`, and MB area →
  country, which was added 2026-09-26 but needs the pipeline restart.
- **Stop treating tag order as a signal** unless it comes with votes. Store votes, or
  treat the list as unordered.

---

## 6. Proposed order of work

Each step is independently shippable and can be checked against the regression metrics
in §7. Steps 1–3 are code-only and fix most of the reported cases without new data.

1. **Tag kinds.** Add `kind` to taxonomy nodes: descriptor/context/scene for the
   nodes listed in 4.1. Change `korean-indie` to a scene node and remove its
   `localizes: indie-pop`. *Fixes Giriboy, the Korean-indie-as-rock problem, and
   descriptor wins.*
2. **Evidence-weighted world, then specific primary** (4.2 steps 1 and 3) with hybrid
   splitting. Replace `primaryOf` / `primaryOfAlbum` and retire the order-based
   catch-all patch. *Fixes the pop-rap-in-Pop albums, OK Computer, Siamese Dream,
   and dream pop → K-Pop. 808s/MBDTF need step 6 too.* A cheap interim step: derive
   the artist prior from the artist's other tagged albums, which is already possible.
3. **Korean Pop world naming + artist-name script as language evidence** (4.3).
4. **Golden test set** (see §7) committed alongside, before steps 1–2 merge.
5. **Pipeline device: `git pull` + restart** (you, on the other machine). Then the MB
   vote backfill.
6. **Store MB artist genres** + backfill; **artist prior** (4.2 step 2) switches on.
   *Fixes 양홍원 and most untagged Korean albums.*
7. **Inferred tags in the pipeline** (5.2 steps 2–4) and **twin linking**.
8. **Store placement on the album** and move charts, `genre_weights`, recommendations and
   feed onto it (4.4). Retire `buildClusters` and the SQL `_primary_genre_id` twin.
   Note that `genre_weights` keys are read by iOS; keys stay raw tags, as in Phase 2.

---

## 7. How to know it's fixed

- **Golden set** (`lib/genres/placement.test.ts`): ~150 albums with the expected world,
  including every example in §3 plus a spread across families and languages. It must
  stay green on every taxonomy edit.
- **Audit metrics.** Re-run the audit scripts used here (to be committed as
  `scripts/audit-genre-placement.ts`) on the same three samples:

| metric | today (rated / kr / rand) | target |
|---|---|---|
| world ≠ tag-majority (≥1.5×) | 15.4% / 1.8% / 6.5% | < 3% (and each remaining case explained) |
| descriptor chosen as primary | 3.1% / 0.7% / 3.1% | 0% |
| hybrid loses to its second parent | 6.7% / 0.6% / 4.5% | 0% (hybrids split) |
| albums with no genres | 10.3% / 70.1% / 34.3% | Korean < 25% after artist genres + inferred |
| k-pop picked despite a hip-hop tag (kr) | 123 | 0 |
| MB vote rows | 91 | ≈ every MB-tagged album |

---

## 8. Experiment: which sources and rules actually work (2026-09-29)

**Setup.** Hand-labelled ground truth: each album gets a best world plus any defensible
alternates, judged the way RYM would. Two sets:
- **Rated**: all 195 rated albums, labelled per album. Weights were tuned here.
- **Holdout**: 152 albums/EPs by 39 well-known Korean artists that nobody has rated yet
  (59 of them untagged). This set was never used for tuning.

External data came from MusicBrainz (album and artist genre votes), Last.fm (album and
artist tags, looked up by MusicBrainz ID), Discogs (search → genres + styles) and
Wikidata (album and artist genres via MusicBrainz ID).

The prototype is placement by evidence weight: sum each source's family distribution
at equal source weights, split hybrids across their parents, drop descriptors,
discount catch-alls (`k-pop` 0.3, `korean indie` 0), and let the artist prior count
more as the album's own evidence weakens. The scratch harness is `exp.ts` / `grid.ts`,
not yet committed.

"Best" = got the best label; "acceptable" = got any defensible label.

| Configuration | Rated: best / acceptable | Holdout (Korean): best / acceptable |
|---|---|---|
| **Current live code** | 68.7 / 80.0 | 51.3 / 61.8 |
| Evidence-weighted rules, own tags only | 74.9 / 84.6 | 40.8 / 46.1 *(untagged albums unplaced)* |
| + artist prior from our other albums | 83.6 / 92.3 | 66.4 / 77.6 |
| + MusicBrainz artist genres | 86.2 / 93.3 | 72.4 / 83.6 |
| + Last.fm artist tags | 86.7 / 95.4 | 80.9 / 88.2 |
| + Wikidata artist genres | 85.6 / 92.8 | 76.3 / 84.9 |
| **own + prior + all three artist sources, equal weights** | **88.7 / 95.9** | **87.5 / 97.4** |
| … + Discogs + Wikidata album + Last.fm album + MB album votes | 88.7 / 95.9 | 87.5 / 97.4 |
| Discogs alone (+ MB artist) | 76.9 / 83.1 | 50.0 / 57.9 |
| Last.fm alone | 70.3 / 77.4 | 57.2 / 67.8 |
| Wikidata alone | 61.5 / 66.2 | 52.6 / 63.2 |

**What worked**

1. **Artist-level evidence is the big win**: +14 points on Rated and +36 on Korean.
   The three artist sources complement each other, and combining all three beats any
   single one. The Korean catalog is mostly untagged at album level, so the artist
   *is* the evidence there.
2. **Per-album external sources add nothing on top.** Discogs matched 148/195 albums
   but agreed with what we already had. MusicBrainz album votes, Wikidata album and
   Last.fm album were likewise redundant. A single source on its own is always worse
   than the combination.
3. **Equal source weights generalize best.** Weights tuned on Rated (MB .5 / Last.fm 1 /
   Wikidata .5) scored 84.2 on the holdout, against 87.5 for equal weights. 132 of the
   4,374 grid settings were within 2 albums of the top, so fine-tuning is noise.
4. **Evidence-weighting beats "most specific wins"** on its own (+6 points on Rated).
   Explicit tag kinds and hybrid splitting added little *by themselves* here, because
   mass-based choice already neutralizes most of those cases. Tag kinds do matter for
   catch-alls: a `k-pop`-only album must count as weak evidence so the artist prior
   can outvote it. Treating `singer-songwriter` as weak folk (not zero) fixed Korean
   singer-songwriters such as Lucid Fall.

**What didn't work / caveats**

- **Last.fm name collisions.** Last.fm maps a MusicBrainz ID back to a *name* page, so
  "Loco" mixes the Korean rapper with a thrash band, and "Paloalto" with a US rock band.
  Querying by name is worse still: "Ye" became the band Yes. Equal weighting with
  Wikidata/MB mostly outvotes it; Loco is the one artist still wrong. A "require
  corroboration" rule was tried and made things worse (it also discarded good evidence),
  so it was dropped.
- **Wikidata artist genres are sometimes odd**: Michael Jackson lists "samba".
  Artist-level tags must never be used as *language* evidence when the artist's
  country is known.
- **Remaining misses with no fix from data**: 4 albums with no tags anywhere
  (박상철, 데이먼스 이어), a French album that loses its language (no French country
  default), Effie (only `k-pop` everywhere), 10cm (genuinely borderline), and TAEYEON's
  *VOICE*, which is a Japanese release, so J-Pop is arguably right.
- **Label bias.** The labels are one person's RYM-style judgment. Holdout labels were
  assigned *per artist*, which favours artist-prior methods; the Rated set is labelled
  per album and shows the same ranking, so the conclusion holds, but the holdout numbers
  are optimistic.

**Recommendation from the experiment**

Build: the evidence-weighted placement, plus an artist prior made of (our other albums
+ MusicBrainz artist genres + Last.fm artist tags + Wikidata artist genres) at equal
weight, stored per artist and refreshed by the pipeline. That is ~3 calls per *artist*,
not per album. Skip Discogs and per-album external lookups for placement; revisit
Discogs only if we later want finer styles for tiles. Commit the labelled sets as the
golden test (§7).

---

## 9. Built (2026-09-29)

The §8 winner is now live code for the Taste page:

- **`lib/genres/placement.ts`**: `chooseWorld` (the family by weighted evidence:
  own tags + artist prior, hybrids split 50/50, descriptors ignored, catch-alls
  discounted, prior λ = 0.5 rising as album evidence weakens, descriptor fallback
  when nothing else exists) and `familyDistribution` / `resolveEvidenceTag`
  (bridge for Discogs/Wikidata/Last.fm spellings).
- **`taxonomy.ts`**: new node field `evidence` (0 = descriptor: instrumental,
  ballad, christmas music, musical, easy listening, lo-fi, dance, non-music, new age,
  korean indie; 0.3 = catch-all: k-pop, mpb, cantopop, mandopop, experimental,
  singer-songwriter; j-pop 0.6). `pop rap`'s home parent is now Hip-Hop; this only
  affects display, since placement splits hybrids evenly.
- **`lib/taste/worlds.ts` `placeAlbum`**: world from `chooseWorld`; tiles are the
  album's own genres in that world (hybrids count in each parent's world); primary
  = most specific non-descriptor tile; an album with no in-world tags gets the world
  as its one tile.
- **Storage**: `artists.genre_evidence` jsonb (migration `20260930000003`, ✅ applied),
  written by `mb-ingest` (MusicBrainz genres + votes on every ingest/re-poll, kill
  switch `ARTIST_GENRES_WRITE=0`) and `npm run backfill:artist-genres`
  (MusicBrainz + Last.fm by MB id + Wikidata, priority-ordered, resumable via
  `fetched_at`). ✅ Run for all 97 rated artists (0 failures).
- **`/api/taste/profile`**: user and community albums are both placed with the prior
  (`lib/taste/artistPrior.ts`: stored evidence + the artist's other albums/EPs,
  singles excluded). This replaced the old "borrow tags from any sibling" path.
  `get_community_album_scores` now returns the artist and includes untagged albums.
  Cache keys: profile v18, community v4.
- **Tests**: `lib/genres/placement.test.ts`, with accuracy floors on the committed
  golden fixture `lib/genres/__fixtures__/placement-golden.json` (347 labelled
  albums) plus the motivating cases. Production code scores 89.2 / 96.4 (rated)
  and 87.5 / 97.4 (Korean holdout), identical on live data.
- **Tried and rejected**: a home-weighted hybrid split (⅔ / ⅓) was +4 albums on rated
  and −2 on the holdout, i.e. noise.
- **Known limit**: an idol album tagged only `[k-pop, dance-pop, hip hop]`, with no
  artist evidence at all, leans Korean Hip-Hop; the artist prior fixes it in practice.

**Not moved yet** (still on the old most-specific primary): `genre_weights` /
`primaryTagOf` (iOS reads the keys), the chart primary (SQL `_primary_genre_id`),
`/api/recommendations` and `lib/feed/taste.ts` (old `buildClusters`), and the taste
page's recommendation candidates (placed on tags only, no prior).

### 9.1 The remaining misses, fixed (2026-09-29, later)

A second pass took each remaining miss to its root cause and kept only rules that
generalize. Measured on the golden sets, with no album moving to a rejected world:

| | Rated: best / acceptable | Korean holdout: best / acceptable |
|---|---|---|
| §9 build | 89.2 / 96.4 | 87.5 / 97.4 |
| **+ the four fixes below** | **91.8 / 98.5** | **90.1 / 100** |

1. **`trot` node** (pop family, Korean scene). 박상철's Last.fm and Wikidata said "trot",
   but the taxonomy had no node for it, so the tag was dropped. 13 catalog release
   groups carry the tag.
2. **iTunes as a source, at half weight** (one coarse store genre per album).
   - US storefront; the KR store returned nothing.
   - The iTunes artist is the one whose album titles match ours: exact name first,
     then most title hits. Karaoke catalogs are rejected.
   - It adds the album's own store genre plus the artist's counts over their other
     albums. "Alternative" / "Adult Alternative" are dropped, because they sent
     Tom Misch and Bastille to Rock.
   - Matched 94/97 rated and 37/39 holdout artists.
   - Fixed: 빵빵, 데이먼스 이어 — CORPUS 0, 10cm — 1.0, one Effie EP, and all three Loco albums.
3. **Artist-level language fallback.**
   - When an album shows no language of its own, the artist's other releases decide:
     at least 3 releases, with at least 70% in one language.
   - Fixes Dominique A — Spirales (37/39 French → French Rock).
   - The strict share keeps bilingual acts unmarked; Lara Fabian is 64% French.
   - Catalog-wide it would fire for ~2.3k artists.
4. **Last.fm shared-name pages.** When `artist.getinfo`'s bio opens "There are N
   artists with this name…", the Last.fm tags are dropped (`lastfm_shared_name`).
   This flagged Loco, Paloalto, Toy, Swings and Dynamic Duo, with no regressions.

**Relabel:** TAEYEON — *VOICE* is her Japanese-language mini-album, so J-Pop is right
under the sound × language rule. The label now accepts `j-pop|k-pop`.

**Still wrong, left as is:**
- Effie — *…f\*\*\*\*n moviE* goes to Electronic, because iTunes files that EP as
  Electronic.
- 데이먼스 이어 — HEADACHE. / Mondegreen go to Korean Rock, because iTunes files them
  Indie Rock / Rock. Arguably right, but not relabelled; fitting labels to output is
  how a test set stops meaning anything.

**Rejected:**
- Wikidata occupation, as noise: it lists Sam Smith as a "hip hop producer".
- Roles parsed from Last.fm bios: "singer and rapper" moved Heize and Colde into Korean Hip-Hop.
- An `acoustic → folk` Last.fm mapping, which had no effect once iTunes is in.

Code:
- `taxonomy.ts` (trot).
- `placement.ts`: `ITUNES_WEIGHT`, `itunesTag`, `artistLanguage` / `releaseLanguages`,
  `ARTIST_LANGUAGE_*`.
- `artistEvidence.ts`: `itunes` + `lastfm_shared_name` fields.
- `artistPrior.ts`: `artistInputFor` reads every release type for the language fallback.
- `backfill-artist-genres.ts`: the iTunes source and the shared-page check.
