# Catalog gap scan — brainstorm

How to find, systematically and repeatedly, **which albums and which artists are missing** from
the catalog — and *why* each one is missing, so every gap routes to a fix.

Status: **brainstorm** (nothing built yet beyond the one-off scan below). Started 2026-09-25.

---

## 0. Baseline — first scan (2026-09-25)

One-off read-only scan: every `external_scores` entry (the curated award/critic lists) checked
against `release_groups`. 3,319 rows → 2,680 unique albums.

| Result | Albums |
|---|---|
| Linked by MBID | 2,284 (85%) |
| In catalog, not linked (title drift / no MBID on our row) | 126 |
| **Album missing, artist found** | 176 |
| **Album missing, artist not found** | 94 |

- 198 of the 270 missing are from **Korean lists** (Rhythmer, KHA, KMA, IZM, Weiv, KR masterpiece
  100). Western lists are near-complete (RS500 −14, Grammy rap/BRIT −0).
- Only 53 of the 270 carry an MBID → `seed:missing-from-external` can only reach those. The other
  217 (mostly KR) need the iTunes/Deezer route or manual lookup.
- 12 are Various-Artists soundtracks — blocked by design (`SPECIAL_MBIDS`), so "out of scope",
  not a gap.
- **Lesson:** loose substring artist matching produced false "artist found" hits (Yoon Young-bae →
  Neil Young, Gonggonggu → Gong, Kim Ho-joong → Kim!). The real scanner needs a stricter gate (§3).

Examples: 동물원 1집/2집, 大瀧詠一 *A Long Vacation*, Black Skirt *201*, Jaedal (3 albums) — artist
missing. Grateful Dead *American Beauty*, Nirvana *MTV Unplugged*, Metallica *72 Seasons*,
Jerd *Bomm* (on 3 lists), 실리카겔 *실리카겔* — artist present, album missing.

---

## 1. What "missing" actually means

A single "not found" hides several different problems. Each needs a different fix, so the scan
must classify, not just count.

| Class | Meaning | Fix route |
|---|---|---|
| `linked` | Found by an external ID (MBID / iTunes / Deezer id) | — |
| `present-unlinked` | Found by title+artist, but our row lacks the ID or the title drifts | link backfill (`backfill:rg-credits`), alias/title fix — **not** ingest |
| `filtered` | Artist ingested, album exists upstream but our type filter dropped it (live, compilation, soundtrack, single-as-album) | policy decision, per type |
| `artist-incomplete` | Artist row exists, discography has holes | re-queue artist / freshness |
| `artist-empty` | Artist row exists with 0 release groups (the ~15.7k MB-empty class) | `resolve-empty-artists` / `resolve-thin-artists` |
| `artist-missing` | No artist row at all | queue by MBID, else iTunes/Deezer seed |
| `queued-stuck` | Artist is in `artist_ingestion_queue` but `pending` / `failed` / `skipped` / `needs_review` | drain / unstick — no new seeding needed |
| `upstream-absent` | Not on MusicBrainz *and* not on iTunes/Deezer | manual, or accept |
| `out-of-scope` | Various Artists, bootlegs, etc. | ignore (record why) |

**Key idea: join every miss to `artist_ingestion_queue`.** A missing artist that's already queued
is a throughput problem, not a discovery problem. That single join probably re-labels a big chunk
of "missing".

---

## 2. Reference universes (ground truth to compare against)

Each source answers a different question and has a different bias. Use several.

### Albums
1. **Curated canon lists** (`external_scores`, 25 lists today). Best signal of *important* gaps.
   Biased toward acclaim. Candidates to add: Pitchfork Best New Music, AOTY/RYM yearly tops,
   Billboard 200 year-end, Oricon yearly, Japan Record Awards, Circle/Gaon yearly album chart,
   Melon Music Awards, Polaris / Choice (CA/FR) prizes.
   - ⚠ Adding a list to `external_scores` **changes prestige scores**. Reference-only lists should
     live elsewhere (a `coverage_reference` table or `scripts/data/*.ts`) so scanning ≠ scoring.
2. **Per-artist platform discographies** — for each catalog artist, pull iTunes/Deezer albums+EPs
   and diff. Finds `artist-incomplete` at scale. `verify-coverage.ts` does this for a 60-artist
   test set; `check-artist-completeness.ts` is the old iTunes-era version. Generalize to a
   sampled/tiered sweep of the whole catalog.
3. **MusicBrainz release-group counts** for artists we hold an MBID for: MB count (by type) vs our
   count. Cheap (one browse per artist) and isolates *ingest* holes from *upstream* holes.
4. **"What's out now" feeds** — Apple Music top-albums RSS per country (free JSON), Deezer charts,
   Melon/Bugs/Genie album charts, `discover-mb-newreleases` window. Catches recency gaps.
5. **Wikipedia year pages** — "List of 2024 albums", "2024 in South Korean music",
   "2024 in Japanese music" list releases month-by-month. Good for KR/JP where MB is thin.

### Artists
1. **Popularity charts** — Last.fm global + geo top artists (`discover-popularity` already uses
   them), ListenBrainz sitewide top artists, Deezer/Apple artist charts.
2. **Our own credit graph** — featured/credited names with no artist row (`discover-credit-graph`
   for `feat.`; extend to producers/composers where MB has relationships).
3. **Label rosters** — MB label browse for key labels (KR: Mirrorball, Beatball, Pastel, Magic
   Strawberry, AOMG, H1GHR, Ambition Musik; JP: Maybe, P-Vine...). High-signal for indie scenes.
4. **Wikipedia categories** — "South Korean hip hop musicians", "Japanese rock music groups", etc.
   (the original seed method; re-run as a diff, not a seed).
5. **Artists of missing albums** — every §2 album miss implies an artist check.

### Demand (the most direct signal)
- **Zero-result searches** — log search queries that return nothing (or nothing the user clicks).
  Needs a small logging table + privacy review. Ranks gaps by what real users want.
- **Import match failures** — Spotify/Apple connect: albums/artists from users' libraries that
  didn't resolve. `verify-coverage.ts` simulates this; real failures are better.

### Unbiased recall estimate
Lists and charts all skew toward the famous. To get an honest "we have X% of what exists":
**randomly sample** N release groups from a universe (e.g. MB release groups by country × decade,
type = album) and check them. ~400 samples per stratum gives ±5%. This is the number to track over
time.

---

## 3. Matching — do it in tiers, and be strict about artists

1. **ID match**: MBID, iTunes collection id, Deezer album id (whatever the reference carries).
2. **Normalized title + artist**: fold curly quotes/apostrophes, strip edition suffixes
   (Deluxe/Remaster/Anniversary/"- EP"/"The 3rd Mini Album"), compare romanized **and** native
   titles, handle symbol titles (★, ★★★★★) and K-pop hanja prefixes ("LOVE YOURSELF 轉 'Tear'").
3. **Artist-scoped loose match**: only inside the resolved artist's own discography.

Artist gate (fixing today's false positives):
- Exact normalized match on name / native name / alias — **no bare substring** matching.
- If substring is needed (collabs like "B-Free & Hukky Shibaseki"), split on `&`, `x`, `,`, `feat.`
  and require an exact match on one component.
- Minimum length guard (≥4 normalized chars) for any fuzzy path.
- Tie-break by country/area when the reference carries it (KR list → prefer KR artist).

Always emit *why* it matched (`id` / `title` / `artist-scoped`) so the report can be audited.

---

## 4. Shape of the tool

One scanner, pluggable references:

```
npm run catalog:gaps -- --ref=lists            # external_scores + reference lists
npm run catalog:gaps -- --ref=mb-counts --sample=2000
npm run catalog:gaps -- --ref=itunes-disc --tier=top
npm run catalog:gaps -- --ref=charts --country=KR,JP,US
npm run catalog:gaps -- --ref=random --strata=country,decade --n=400
```

- **Read-only by default.** `--queue` feeds `artist_ingestion_queue` (MBID first; iTunes/Deezer
  seed when no MBID), reusing the existing seed scripts' upsert + backdate logic.
- **Output:** CSV/JSON per run + a summary table. Optionally persist to a `coverage_scans` table
  (`run_id, ref, key, class, reason, seen_at`) so we can chart recall per source over time and
  see gaps close.
- **Priority score** per gap: number of lists × list tier + popularity (listeners) + demand hits.
  The queue gets the top of this list first.
- **Load:** light SELECTs in chunks (`.in(...)` of ~150 IDs, not full-table paging). Still avoid
  running alongside `pipeline:verify` — the known ingest write-load contention.
- **Cadence:** lists + charts weekly, next to the `PIPELINE_CHECKS.md` run; random-sample recall
  monthly; MB-count / platform-discography sweeps in slices (they cost API time).

---

## 5. Phased plan

1. **Formalize today's scan** → `catalog:gaps --ref=lists` with the strict artist gate and the
   queue-status join. Re-run and compare to the §0 baseline.
2. **Fix the cheap wins it exposes:** link the 126 `present-unlinked`; queue the 53 MBID-bearing
   misses; route the ~217 no-MBID KR misses through iTunes/Deezer lookup.
3. **Add `mb-counts`** → measures ingest completeness for owned artists (separates our bugs from
   MB's holes).
4. **Add charts + Wikipedia year pages** for recency and KR/JP depth.
5. **Random-sample recall** → the headline coverage number, tracked monthly.
6. **Demand logging** (zero-result search, import failures) — needs a schema + privacy decision.

---

## 6. Open questions

- Where do reference-only lists live so they don't affect prestige? (new table vs data files)
- Policy on live albums, soundtracks, compilations: in or out? Decides whether `filtered` is a gap.
- Is iTunes/Deezer an acceptable source for the no-MBID KR albums, given MB-primary ingest? (The
  `recency` / `reconcile` lanes suggest yes, with later MB reconciliation.)
- Search-miss logging: store raw queries, or hashed/normalized only?
- How much MB API time per week can the scan take without slowing ingest (~1 req/s shared)?
