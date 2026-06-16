# Catalog expansion plan

Strategic plan to fill the coverage gaps surfaced on 2026-06-14 and grow the
catalog **deliberately**, keeping the resulting composition appropriate for a
Korean-rooted, globally-credible music platform.

> Run everything from `apps/web/`. All scripts are read-light, resumable, and
> hit only free APIs (Wikipedia, iTunes, Last.fm) — no Spotify, no quota risk.
> Disk headroom: ~6.4 GB free of 8 GB (Pro). Expansion below adds an estimated
> 1–2 GB, well within budget.

---

## 1. Why the catalog is lopsided today

The original seed ([build-artist-queue.ts](apps/web/scripts/build-artist-queue.ts)) was **19 Korea-only Wikipedia categories**. All non-Korean coverage arrived *accidentally* via uncontrolled Last.fm "similar artist" fan-out ([discover-lastfm-similar.ts](apps/web/scripts/discover-lastfm-similar.ts)), which snowballed into Western electronic/hip-hop while neighbouring Asian markets that aren't tightly linked in Last.fm's graph (Japan, China, SE Asia) were starved.

Measured 2026-06-14 (`npm run analyze:coverage`), all 348,539 releases incl. singles:

- **66% singles** (dead weight — excluded from recs/leaderboards).
- Genre tokens dominated by `electronic` (67.6k) and `hip-hop` (60.2k); `k-pop` 19.9k.
- `ja` native 0.1% (215 rows), `zh` 0.04% (127). SE Asia ~97 rows, South Asia ~745.
- 85% of releases are from 2010s+; pre-2000 canon is shallow.

---

## 2. Target composition (recommendable set = Albums + EPs)

Judge composition on the **recommendable set**, not raw rows (singles distort
everything). Measure with `npm run analyze:coverage:albums`.

### By origin / region

| Region | Target share | Rationale |
|--------|-------------|-----------|
| Korea | **~28%** | Core identity — must stay the deepest single region |
| Western (US/UK/EU) | **~30%** | The global canon users actually rate; needs *historical depth*, not more 2020s pop |
| Japan | **~15%** | #2 global market, audience-adjacent (anime, city pop, J-rock) |
| Greater China (CN/TW/HK) | **~7%** | Major adjacent market |
| SE Asia (TH/VN/ID/PH/MY) | **~5%** | Overlaps K-pop's regional fanbase |
| South Asia (IN/PK) | **~4%** | Very large potential audience |
| Latin | **~5%** | Already well covered — hold, don't grow |
| Africa | **~3%** | Fast-growing globally |
| Other / world | **~3%** | France, Germany, Brazil, Caribbean, etc. |

### Guardrails

- **No single genre token > ~25%** of the recommendable set. Electronic/hip-hop
  are already at the ceiling — do **not** run the legacy blanket `queue:discover`
  again; it is what caused the imbalance. Use `queue:discover:global` instead.
- **Pre-2000 ≥ ~20% of the Western slice** — the historical canon is the gap,
  not contemporary Western pop. The Western seed is deliberately *small and
  canonical* (Hall-of-Fame + classic label rosters), not "all American rock".
- **Singles**: all expansion ingests run with `--skip-singles`, so new data is
  album/EP-focused and the album:single ratio improves over time.

These percentages are **steering targets, not hard quotas** — the pipeline can't
meter iTunes output per-artist. The lever is *which artists we seed* + *scoping
discovery*. Hence the measure → seed → ingest → re-measure loop below.

---

## 3. Run order

### Step 0 — Baseline measurement
```bash
npm run analyze:coverage:albums      # composition of the recommendable set
```
Save the output; this is your before-picture.

### Step 1 — Finish the in-flight tracklist backfill (from the prior task)
```bash
npm run backfill:tracklists          # resumable; safe to run alongside nothing else that writes releases
```

### Step 2 — Seed the missing cultures (Wikipedia → queue)
```bash
npm run queue:build:global:dry       # preview per-region counts, no writes
npm run queue:build:global           # upsert all regions into the queue
```
Region-tagged sources (`wikipedia_japan`, `wikipedia_greater_china`, …). To seed
one region at a time: `... build-global-queue.ts --region=japan`.

### Step 3 — Ingest the seed (iTunes, albums/EPs only, with tracklists)
```bash
npm run queue:ingest:albums          # = ingest --skip-singles --with-tracks
```
Resumable. Drains all `pending` queue rows. Long-running — run in batches with
`-- --limit=500` if you want to checkpoint.

### Step 4 — Controlled discovery (stay inside each culture)
```bash
npm run queue:discover:global:dry    # preview
npm run queue:discover:global        # fan out ONLY from global-seed artists
```
Then re-ingest the newly discovered artists:
```bash
npm run queue:ingest:albums
```
Repeat Step 4 (discover → ingest) until the queue stabilises. Per-region:
`... discover-global.ts --region=greater_china`.

### Step 5 — Enrich the new rows
```bash
npm run backfill:genres              # iTunes genre (Tier 1)
npm run backfill:genres:lastfm       # Last.fm genre (Tier 2)
npm run enrich:genres:lastfm         # merge extra tags
npm run backfill:native              # native names (artists + releases)
npm run backfill:covers              # any missing cover art
npm run backfill:tracklists          # tracklists for anything that slipped through
npm run backfill:embeddings          # semantic search vectors (do this LAST)
```

### Step 6 — Re-measure and iterate
```bash
npm run analyze:coverage:albums
```
Compare against the targets in §2. If a region is still short, re-run Steps 2–5
for that `--region`. If electronic/hip-hop creep back up, stop discovery.

### Step 7 — Rebuild the HNSW index (only after a large embeddings backfill)
In the Supabase SQL editor (see README "Rebuild HNSW index").

---

## 4. New / changed scripts

| Script | Purpose |
|--------|---------|
| [build-global-queue.ts](apps/web/scripts/build-global-queue.ts) | Region-grouped Wikipedia seed (Japan, Greater China, SE Asia, South Asia, Western canon, Africa, Europe/world). Generalised native-name detection (ko/ja/zh/th/hi/ar). |
| [discover-global.ts](apps/web/scripts/discover-global.ts) | Last.fm discovery **scoped to global-seed artists only** (MAX_SIMILAR=10) so growth stays inside each culture. |
| [analyze-coverage.ts](apps/web/scripts/analyze-coverage.ts) | Coverage report; `--albums-only` for the recommendable set. |
| [catalog-status.ts](apps/web/scripts/catalog-status.ts) | Live dashboard (`npm run catalog:status`): queue by status/region + releases added, artists, releases by type, releases by language/region/genre. Fast (count-only). Run during/after each step to track progress. |
| [measure-storage.ts](apps/web/scripts/measure-storage.ts) | Storage footprint estimate. |
| ingest-itunes-queue.ts | New flags: `--skip-singles` (composition) + `--with-tracks` (tracklists at ingest). |

**Deliberately not used:** the legacy `npm run queue:discover` (blanket Last.fm
fan-out) — superseded by `queue:discover:global` for all future growth.

### Execution log

| Date | Step | Result |
|------|------|--------|
| 2026-06-14 | `queue:build:global` (1st) | Only 1,106 — Wikipedia throttled categories mid-run |
| 2026-06-15 | `queue:build:global` (re-run) | **5,898 seed artists** (japan 2,048, western_canon 1,702, europe_world 611, south_asia 596, china 392, sea 300, africa 249) |
| 2026-06-15 | `queue:discover:global` | ~39k queued (attempted); queue peaked ~30,751 pending. One controlled pass. |
| 2026-06-15 | `queue:ingest:albums` (batches) | ~14.4k new albums/EPs (8,512 + 5,927). Skip ratio rose 1.5:1 → 4:1 → **saturating** |
| — | Enrichment + re-measure | Pending |

Stop discovery (saturated). Finish draining the queue, run the Step-5 backfills,
then `analyze:coverage:albums` + `catalog:status` to diff against §5.

---

## 5. Expected resulting shape (capture this — compare against actual later)

These are the numbers to check `analyze:coverage:albums` against once the jobs
finish. They are **projections / targets**, not guarantees — record the actual
output and diff it.

### 5a. Step-0 baseline — recommendable set (captured 2026-06-14, the "before")

`analyze:coverage:albums` over **110,728** Albums + EPs:

- **Release type:** Album 77,355 (69.9%) · EP 33,373 (30.1%)
- **Decade:** pre-2000 ~19.2% · 2000s 15.5% · 2010s 31.3% · 2020s 33.5%
  → historical depth is **already decent** (~19% pre-2000), not the worst gap.
- **Top genre tokens (% of recommendable):** electronic 15.4% · hip-hop 12.3% ·
  rock 10.8% · alternative 7.8% · pop 7.6% · k-pop 5.9% · r&b 4.2% · classical
  3.6% · jazz 2.8% · j-pop 2.5%.
  → In the *recommendable* set electronic/hip-hop are **15%/12%, not over the
  25% ceiling** — the 25% in the all-releases view was singles. Genre mix is
  healthier than it first looked.
- **Culture coverage (recommendable):** SE Asian **4** · Spanish 6 · Arabic 15 ·
  South Asia 63 · German 87 · African 122 · Brazilian 164 · French 288 ·
  Chinese/Mandopop 393 · Latin 1,729 · Jazz 3,302 · Classical 4,436.
  → The Asian-neighbour gaps are **even starker** here: SE Asia is 4 albums,
  China 393, India 63. Japan (j-pop ~2,823) is the only non-Korean Asian scene
  with real depth.
- **Korea:** k-pop 6,553 + korean-hip-hop 584 + trot 834 + ko-native 4,133 (and
  some untagged indie/ballad/OST). Realistic Korean origin ≈ **8–11%** of the
  recommendable set. **Korea is already a minority** — see §7.

### 5b. Projected catalog size

| Metric | Now (2026-06-14) | After all jobs (projected) |
|--------|------------------|----------------------------|
| Total releases | 348,539 | ~410k – 500k |
| Albums + EPs (recommendable) | 110,728 | ~170k – 260k |
| Singles | 231,534 (66%) | unchanged (~231k) — expansion runs `--skip-singles` |
| Releases with tracklist | 7,048 | ~120k – 240k (backfill + `--with-tracks`) |
| Releases with embedding | 118,672 | grows with new albums/EPs |

The singles share **falls** from 66% toward ~45–55% purely because new growth is
album/EP-only — without us deleting anything.

### 5c. Ideal region mix — recommendable set (the headline target)

Direction is measured against the §5a baseline.

| Region | Target share | Baseline (≈) | Direction |
|--------|-------------|--------------|-----------|
| Western (US/UK/EU) | ~30% | ~45–55% | Let *relative* share fall as Asia grows; keep pre-2000 depth |
| Japan | ~15% | ~3–4% | **Big increase** |
| Korea | ~12% | ~8–11% | Hold — no forced increase (global positioning) |
| Greater China (CN/TW/HK) | ~8% | ~0.4% | **Big increase** |
| SE Asia (TH/VN/ID/PH/MY) | ~6% | ~0.0% (4 albums) | **From zero** |
| South Asia (IN/PK) | ~5% | ~0.1% | **Large increase** |
| Latin | ~5% | ~1.6% | Increase |
| Africa | ~4% | ~0.1% | Increase |
| Other / world | ~5% | ~1% | Increase |

> **Positioning note (2026-06-14):** the platform's end goal is a *global* music
> community, so Korean dominance is explicitly **not** a requirement. Korea's
> target is held at ~12% (roughly its current level) — keep the Korean catalog
> reasonably complete for the launch audience, but do not force it to be the
> largest region. The deliberate Asian + canonical-Western expansion is the
> priority; the catalog should look globally representative, not Korea-centric.

### 5d. Ideal genre mix — recommendable set

The recommendable set is already balanced (§5a): electronic 15%, hip-hop 12% —
**below** the 25% ceiling. Goal is to **broaden around them**, not add more.

| Genre family | Target share | Baseline (≈) | Note |
|--------------|-------------|--------------|------|
| Pop (incl. K/J/C-pop) | ~25% | ~16% | Spread across regions, not Western-only |
| Rock / alternative / indie | ~20% | ~19% | Already on target; includes J-rock, K-rock |
| Hip-hop / rap / R&B | ~17% | ~17% | On target — **do not grow** |
| Electronic / dance | ~13% | ~15% | Slightly high — **do not grow** (no blanket discover) |
| Jazz / classical / instrumental | ~8% | ~7% | On target |
| Folk / singer-songwriter / country | ~8% | ~4% | Increase via Western canon |
| Soul / funk | ~5% | ~1.3% | Increase via Western canon |
| Metal / punk | ~3% | ~1.5% | Slight increase |
| World / regional (afro/latin/etc.) | ~2% | ~2% | On target |

---

## 6. Storage budget vs the 8 GB disk

Disk breakdown (2026-06-14, Supabase Pro, `bside`):

| Component | Size |
|-----------|------|
| Database | 0.90 GB |
| WAL (write-ahead log) | 0.56 GB |
| System | 0.16 GB |
| **Used** | **~1.62 GB** |
| Available | 6.21 GB |
| **Disk total** | **8 GB** |

Empirical density: 348,539 releases ≈ 0.90 GB database → **~2.7 KB/release**
all-in (this average is light because 66% are singles with no tracklist/embedding).

Projected additions:

| Job | Δ database (est.) |
|-----|-------------------|
| Tracklist backfill (existing ~115.6k non-singles) | +~0.3 GB |
| Expansion: ~60k–150k new albums/EPs (row + tracklist + embedding + indexes, ~8–10 KB each) | +~0.5–1.5 GB |
| **Projected database after all jobs** | **~1.7–2.7 GB** |
| + WAL (spikes during bulk writes, then checkpoints down) | ~0.5–1.5 GB transient |
| + System | ~0.16 GB |
| **Projected total disk used** | **~2.4–4.0 GB** |

**Verdict: comfortably within 8 GB.** Even the worst case (~4 GB) leaves ~4 GB
free, and the disk auto-scales if exceeded. The only thing to expect is **WAL
growing during bulk ingestion** — that's normal; it reclaims after checkpoints.
Do not be alarmed by a transient WAL spike mid-run.

---

## 7. Pre-launch fit analysis — does current + scripts match the ideal?

**Yes — storage, genre balance, and (given the global goal) region mix all line
up.** The §5a baseline confirmed:

1. **Korea at ~8–11% is fine.** The platform's end goal is a *global* community,
   so Korean dominance is explicitly not required. The global expansion will lower
   Korea's *relative* share as Japan/China/SEA grow — and that's the intended,
   globally-representative direction. A Korean depth pass is **optional**: only run
   it if you decide the Korean catalog isn't complete enough for the launch
   audience (`npm run queue:build` → `npm run queue:ingest:albums`). It is **not**
   a blocker for the expansion.

2. **Genre mix is already healthy — leave electronic/hip-hop alone.** In the
   recommendable set they're 15%/12%, under the 25% ceiling (the scary 25% was a
   singles artifact). Do **not** run the legacy blanket `queue:discover`; it would
   re-inflate them. The under-weighted families are folk/soul/funk — the light
   Western-canon seed targets exactly those.

3. **Historical depth is fine (~19% pre-2000)** — better than expected, so the
   Western-canon pass can stay small/canonical as designed.

Plus the standing guidance:

- **Don't over-loop discovery.** Pre-launch, obscure long-tail artists add little
  and each `discover → ingest` loop risks re-bloating + re-drifting. Plan:
  **seed + Korean depth pass + 1–2 controlled discover passes, then measure and
  stop.** Balance beats raw count before launch.
- **Singles (66%) are a composition liability, not a storage one.** `--skip-singles`
  stops the pile growing; an actual prune is optional (separate task) since disk
  is ample.

**Bottom line for pre-launch:** the scripts match the goal — run Steps 0–6, skip
the blanket discover, and stop once §5c region shares are within a few points. The
8 GB disk is not a constraint. A Korean depth pass is optional, not required:
the target is a globally-representative catalog, not a Korea-dominant one.
