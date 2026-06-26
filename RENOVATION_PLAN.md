# DB Renovation — Master Plan (data pipeline)

Single source of truth for re-filling the renovated catalog schema: why, the architecture,
every resolved decision (**[REC]** = my recommendation), the build order. Hardened
2026-06-25 after a 3-LLM adversarial review (see §14 for what was accepted/rejected).

> **Status (2026-06-25):** schema migration ✅ applied; catalog truncated/empty.
> **Data-pipeline plan signed off + hardened.** Source = **MusicBrainz-primary** (§2–3);
> the earlier iTunes-primary scripts are **repurposed as append-only gap-fill**. Build per
> §12 (starts with the §6 migration). The §11 downstream track (app rewrite) is planned separately.
> Companion: [CATALOG_EXPANSION_PLAN.md](CATALOG_EXPANSION_PLAN.md), [SONGS_PLAN.md](SONGS_PLAN.md), [WEB_PARITY.md](WEB_PARITY.md).

---

## 1. Why the renovation exists
Old model = one flat `releases` table: artist as free-text (98% null `artist_id`), songs as
JSONB, ratings keyed to a specific edition, dedup by fuzzy string-match → artist
fragmentation ("드레스" vs "dress"), no album concept (split ratings + permanent dedup debt),
fragile song identity (track ratings broke on remaster track-shifts). The migration fixed the
**schema** (`artists` uuid → `artist_aliases`/`artist_external_ids`; `release_groups` →
`releases` editions; `recordings` + `release_tracks`). This plan = **how we fill it** correctly.
Pre-launch: only ~97 album + 20 track ratings (backed up in `backups/*.json`).

---

## 2. Source strategy + legal (decided; verified 2026-06-25)

| Source | Use | Legal status |
|---|---|---|
| **MusicBrainz** (API now / local mirror later) | **Primary** — identity (MBID), release-groups, releases, recordings (ISRC), aliases, genres | **CC0 core = public domain, commercial-OK.** Clean. |
| **Cover Art Archive** | Covers by MBID | Access sanctioned; art is label-copyright (universal) → **hotlink, never cache bytes** |
| **ListenBrainz** (MetaBrainz) | "Similar artists" discovery (replaces Last.fm) | **CC0** — clean |
| **iTunes Search API** | **Append-only gap-fill only** (artists/releases MB lacks) + cover hotlink there | Affiliate/promo terms; **no art caching**; persisted metadata = diligence-gray → minimize, tag provenance |
| **Jina v3** | Embeddings on our own metadata | Fine (we send our data); record model+timestamp |
| ~~Deezer~~ | — | ❌ **Out** — terms forbid commercial use + harvesting |
| ~~Last.fm~~ | — | ❌ **Out** — API is **non-commercial only** ("material breach" for commercial use). Replaced: genres→MB, similar→ListenBrainz, covers→CAA, prestige→deferred |

**Coverage reality (measured on MB):** strong on majors everywhere (aespa 12, BTS 24, Hyukoh 7,
YOASOBI 9, Radiohead 100s); **thin on Korean indie long-tail** (Se So Neon 1 vs iTunes' several);
ISRC density excellent where covered (aespa *Savage* 9/9). → drives the **completeness gap-fill** (§3).

---

## 3. Architecture — curation-driven, MB as databank (decided)
Catalog shape is driven by **our artist discovery**, not by copying an external dataset. Unit
of expansion = the **artist**. We persist **only** selected artists.

1. **Breadth driver = artist discovery** — Wikipedia categories → **ListenBrainz** similar →
   (later) charts → names → queue, **deduped** against existing artists.
2. **Per-artist source of truth = MusicBrainz** — resolve name → MBID, fetch release-groups +
   releases + recordings (ISRC) + aliases + genres.
3. **Gap-fill = iTunes, append-only, by COMPLETENESS not existence** — *the key fix.* After MB
   resolve, if the artist's MB discography is **materially incomplete** (heuristic §4.6), fetch
   the **missing releases** from iTunes at the *release* level, tagged `source='itunes'`,
   `source_status='gapfill_unverified'`. **Never overwrite MB fields; never merge identities.**
4. **Covers = CAA** by MBID (hotlink); iTunes cover only where we're already gap-filling.
5. **MB access = public API now** (single global **1 req/sec** limiter, proper User-Agent); a
   **local MB mirror** (CC0 dump) is a throughput optimization adopted if breadth demands it —
   a fast local copy of the databank, **not** a bulk copy into our catalog.

---

## 4. Resolved design details ([REC] = redline)

### 4.1 Artist identity = MBID; aliases
- **Identity = MBID** in `artist_external_ids(source='musicbrainz')` — never the name. Fixes
  same-name false-merge (two "Crush" = two MBIDs = two rows).
- **[REC] Save ALL distinct same-name artists** (each plausible MBID = its own row); region hint
  (KR for Korean-Wikipedia sources) only *orders*, never drops. `needs_review` only when no
  confident music-artist match.
- **[REC] Drop `artist_aliases.UNIQUE(alias)`** (MBID is identity now; UNIQUE blocks same-name
  artists). Enrich aliases: `alias`, `alias_norm`, `locale`, `script`, `primary_for_locale`,
  `source`. Search-ranking (exact-native > locale > area > internal-activity) lives in the **app track**.

### 4.2 MB → schema mapping
- **artist** → `artists`: `name`=MB primary; `name_native`=ko/ja/zh primary alias; `country`=area;
  `disambiguation`; `source_status`.
- **release-group** → `release_groups`: `title`, `native_title` (ko/ja/zh alias if any),
  `artist_display`, `first_release_date`, `genres` (MB, normalized §4.5), `source`.
  **Type [REC]:** secondary Soundtrack→`soundtrack`/Compilation→`compilation`/Live→`live`; else
  primary Album→`album`/EP→`ep`/Single→`single`; else `other`.
- **release (edition)** → `releases`: **[REC] one representative edition per RG for v1**, chosen by a
  **decision tree** (status=Official **and** earliest `first_release_date`; tie-break region
  **KR > JP > US > any**; the chosen edition supplies tracklist/cover/date). `is_canonical=true`,
  `region`, `source`. *(Ratings key on `release_group_id`, so the chosen edition never affects a
  rating — storing all editions is a post-v1 option only if edition-level display is needed.)*
- **recording** → `recordings`: **identity = `mb_recording_id` (MBID), UNIQUE** → find-or-create
  (one row per MB recording, linked to many releases via `release_tracks`). **ISRC is a signal,
  not identity** — stored nullable, **non-unique** (a recording may have several; ISRCs get reused
  across remasters). `source`.
- **medium/track** → `release_tracks`: `disc_number`=medium pos, `position`=track number.

### 4.3 Native / Korean titles
- `release_groups.native_title` + all variants as searchable aliases. MB's K-pop English-vs-Korean
  title convention is inconsistent → keep both + aliases; romanization variants (RR/MR/label) all
  stored as aliases.

### 4.4 Covers — hotlink, never cache
- Album art is label-copyright regardless of source → **store URL, hotlink CDN, never re-host bytes.**
- **[REC] Chain:** Cover Art Archive by MBID (with **backoff** — CAA/IA throttles informally) →
  iTunes art URL **only for gap-fill artists** (already calling iTunes) → else null (gap-fill later).

### 4.5 Enrichment (parallel, non-MB resources)
- **GENRES**: **MB genres/tags**, run through a **normalization map** (canonical vocabulary —
  "K-pop"/"k-pop"/"korean pop" → `k-pop`; reuse the old `GENRE_MAP`).
- **EMBEDDINGS**: Jina v3 (`vector(1024)`, cosine) on a **richer string** ("native_title + title +
  artist + genres + year + label") → `release_groups.embedding`; HNSW. **Cold-start search glue,
  not a taste graph** — don't oversell; superseded by rating-based signals later.
- **PRESTIGE**: **deferred.** No clean popularity source (Last.fm is out). Cold-start ordering uses
  recency + RG presence; replaced by **sillajuku's own ratings/engagement** as they accrue. Optional
  future: Apple/Melon per-region charts. (No `lastfm_listeners`.)
- **COVERS**: §4.4 lane.

### 4.6 Discovery, dedup, completeness, reconciliation
- **Discovery**: Wikipedia categories + **ListenBrainz** similar (CC0). Wikipedia/EN bias is known
  → Korean-native discovery sources are a noted enhancement. **Dedup before queueing**: skip names
  already resolving to an existing artist.
- **Completeness heuristic (gap-fill trigger)** [REC]: after MB resolve, flag an artist
  `incomplete` if MB RG count is suspiciously low (e.g. ≤2) **or** below a cheap iTunes
  discography-count probe by a margin → gap-fill the missing releases (append-only). Tune the
  threshold during the §12.3 coverage gate.
- **Reconciliation**: when FRESHNESS later finds an MB entry for a previously gap-filled
  (`gapfill_unverified`) artist, **migrate/merge to the MB entity** (don't duplicate); handle **MB
  redirects/merges** so re-resolution doesn't fork rows.

---

## 5. Orchestrator — one command, state-driven lanes (decided)
`npm run pipeline` — a supervisor running lanes concurrently. Each artist carries an
**ingest state**, and lanes only consume entities in the right state, so a crash never leaves a
downstream lane reading a half-built record.

```
ingest_state:  pending_resolve → resolved → discography_done → tracks_done
                 → enriched → qc_passed   (+ needs_review, failed)

DISCOVER   (Wikipedia/ListenBrainz)  queue low → add NEW artists (deduped)
RESOLVE    (MB, shared 1/s)          pending_resolve → artists/aliases/external_ids → resolved
ALBUMS     (MB, shared 1/s)          resolved → release_groups + representative release → discography_done
TRACKS     (MB, shared 1/s)          discography_done → recordings (MBID-dedup) + release_tracks → tracks_done
GAPFILL    (iTunes)                  incomplete artists → missing releases (append-only, source-tagged)
GENRES     (MB data)                 tracks_done → normalized genres
EMBEDDINGS (Jina)                    embedding IS NULL → vector
COVERS     (CAA + iTunes-gapfill)    null cover → hotlink URL
QC         (DB, hourly + on-drain)   §8 checks → log + safe-fix → qc_passed / needs_review
FRESHNESS  (MB, low prio, post-launch) next_check_at due → new releases; reconcile gap-fills; handle redirects
```
- **All MB lanes share ONE global 1 req/sec token bucket** (one fetcher instance) — not per-lane.
- **Leasing + retry**: each work item is claimed (`claimed_at` lease w/ expiry) so concurrent
  workers don't double-process; `attempt_count` + backoff; repeated failures → `failed`/dead-letter.
- **Per-item error isolation**: one bad artist is recorded + skipped, never kills a lane.

### Reliability / monitoring
- **`pipeline_lanes` heartbeat** (`last_active`, `items_done`, `errors`, `current_item`).
- **`npm run pipeline:status`** dashboard; rotating per-lane logs.
- **Auto-restart** (Windows Task Scheduler **or** pm2 — pick one; commit to one OS env). Safe
  because all state is in the DB.
- *(If the custom daemon proves flaky, BullMQ on our existing Upstash Redis is the fallback.)*

---

## 6. Schema additions (one migration, before lanes)
- `release_groups`: `embedding vector(1024)` + HNSW (`vector_cosine_ops`), `native_title text`,
  `source text`.
- `releases`: `source text`. `recordings`: `mb_recording_id text UNIQUE`, `source text`;
  **drop `UNIQUE(isrc)`** (keep `isrc` nullable, non-unique).
- `artists`: `ingest_state text` (default `pending_resolve`), `source_status text`
  (`mb_verified`/`gapfill_unverified`), `claimed_at timestamptz`, `attempt_count int`.
  (`needs_review` folds into `ingest_state`.)
- `artist_aliases`: **drop `UNIQUE(alias)`**; add `alias_norm`, `locale`, `script`,
  `primary_for_locale`, `source`; index `alias_norm`.
- `pipeline_lanes` table (heartbeat).
- **Indexes**: `artist_external_ids(source, external_id)`, `recordings(mb_recording_id)`,
  `recordings(isrc)`, `release_groups(primary_artist_id)`, `releases(release_group_id) WHERE is_canonical`,
  partial indexes on `artists(ingest_state)` for each lane's pending query.
- (`artist_external_ids.source` CHECK already allows `'musicbrainz'`.)

---

## 7. Rating re-link (defined stage — not "downstream")
Only real user data (97 album + 20 track ratings). **Must hit ~100%, manually if needed.**
- **Preserve match evidence** from `backups/*.json`: old title, old artist, old iTunes ID, old
  artwork URL, old release date.
- **Match order**: old iTunes ID → ISRC → normalized title+artist → **manual fallback list** for the
  rest. Output a mapping table `old_release → release_group_id` with confidence; review low-confidence.
- Run **after** the curated core is ingested; report success rate; no launch until 100% resolved.

---

## 8. QC (hourly + on-drain) — expanded
Auto-fix safe, flag risky, log everything:
- duplicate `release_groups` (same artist + edition-stripped title); duplicate `recordings`
  (same `mb_recording_id`/ISRC not unified); **RG with no `release_tracks`**; **resolved artist
  with no recordings**; track-count mismatch vs source; same-name artists same country (review);
  artists with no native/romanized alias; **dead cover URL (403/404)**; **gap-fill entity later
  found in MB** (reconcile); **rating mapping to >1 RG**; restricted-source fields leaking onto
  MB-only rows.

---

## 9. Launch scope & sustainability
- **[REC] Done = curated set complete**, measured by coverage, not a row count: seed +
  Wikipedia/ListenBrainz-discovered artists **resolved on MB**, with **representative release +
  tracks + genres + embedding + cover (or known-null)**, QC-clean, ratings re-linked 100%.
  - *Reference (not a gate):* the old recommendable set was ~110,728 albums/EPs but that counted
    edition dups/iTunes noise. MB-primary yields **smaller-but-cleaner**; judge by **release-groups
    per seed artist**, not against 110k. Revisit breadth only if per-artist coverage looks thin.
- **Sustainability (post-launch):** `next_check_at` re-poll (new releases) + periodic deduped
  discovery + gap-fill reconciliation + MB redirect handling; local mirror if breadth needs it.

---

## 10. Redo inventory (old DB → new schema)
| Old | New action | Where |
|---|---|---|
| genres (iTunes+Last.fm) | **MB genres**, normalized | GENRES |
| native names | MB aliases → `name_native`/`native_title` + `artist_aliases` | RESOLVE/ALBUMS |
| covers | Cover Art Archive (hotlink) | COVERS |
| tracklists (JSONB) | `recordings` (MBID-dedup) / `release_tracks` | TRACKS |
| embeddings + HNSW | on `release_groups` (vector 1024) | EMBEDDINGS + migration |
| prestige (Spotify/seed) | **deferred** → native ratings | — |
| `ratings_count` trigger | rebuild on `release_groups` | downstream |
| `recommendable_releases` view, `search_releases`, charts/Silla RPCs | rewrite vs `release_groups` | **downstream track** |

---

## 11. Downstream track → **[APP_REWRITE_PLAN.md](APP_REWRITE_PLAN.md)**
App data-layer rewrite (web ≈30 files + iOS 9 Swift files) + dropped RPC/view rebuild + the §7
rating re-link **execution** run **in parallel** with collection and are the real launch-blocker.
Fully inventoried + sequenced in **[APP_REWRITE_PLAN.md](APP_REWRITE_PLAN.md)**. "Perfect data
plan" ≠ "ready to launch."

---

## 12. Build order
1. **Migration** (§6).
2. **MB client + resolver + mapper** (MB-primary); recordings find-or-create by MBID; ListenBrainz discovery; iTunes repurposed → append-only gap-fill (no art caching).
3. **Coverage gate** — run RESOLVE/ALBUMS/TRACKS on the 276 seed; measure: confident-MBID %, RG/artist, ISRC %, CAA-cover %, completeness-flag rate. **Tune the gap-fill threshold here before scaling.**
4. **Orchestrator** — state machine + leasing + `pipeline_lanes` + `pipeline:status` + logs + auto-restart.
5. **Lanes** — DISCOVER, RESOLVE/ALBUMS/TRACKS, GAPFILL, GENRES, EMBEDDINGS, COVERS, QC.
6. **Rating re-link** (§7) once the core is in.
7. **(Later)** local MB mirror if needed; FRESHNESS; downstream app-rewrite track.

---

## 13. Resolved decisions
1. One representative edition per RG (precedence tree, KR-first) ✅
2. Covers: hotlink CAA → iTunes(gap-fill) → null; never cache ✅
3. Prestige deferred (no Last.fm); native ratings later ✅
4. Artist identity = MBID; save all same-name artists; drop `UNIQUE(alias)` ✅
5. Launch = curated coverage, not a row count ✅
6. iTunes = append-only gap-fill (verified at build) ✅
7. **Last.fm removed (non-commercial); genres→MB, similar→ListenBrainz** ✅
8. **Gap-fill on completeness, not existence** ✅
9. **Recording identity = MBID; ISRC = non-unique signal** ✅
10. **Per-artist ingest state machine + leasing/retry; shared 1/s MB limiter** ✅
11. **Provenance (`source`/`source_status`) + reconciliation of gap-fills** ✅
12. **Rating re-link = defined stage, ~100% target with manual fallback** ✅

---

## 14. Review log — accepted vs rejected (2026-06-25, 3-LLM adversarial review)
**Accepted:** Last.fm non-commercial (verified → removed); completeness gap-fill (MB-has-but-incomplete
silently underfilled Korean indie); ISRC-not-identity (→ MBID); ingest state machine + leasing
(crash-safety); provenance + reconciliation; rating re-link as a real stage; shared MB limiter;
genre normalization + richer alias model; expanded QC + indexes; edition precedence tree; CAA
backoff; richer embedding input; MB redirect handling.

**Rejected (reviewers lacked context):**
- "Representative edition → ratings vanish" — **false**: ratings key on `release_group_id`, not the
  edition; swapping it can't orphan a rating. Kept one-edition-v1 + precedence tree.
- "Exclude non-MB artists from launch" — contradicts the Korean-long-tail product goal; the answer
  is *expanded* gap-fill.
- "One atomic massive-transaction sync" — impractical on Supabase (statement timeouts; 1000-row wall).
- "Use Temporal/BullMQ instead of custom orchestrator" — state-machine + leasing buys ~the same
  safety without new infra; BullMQ-on-Upstash noted only as a fallback.
- "110k as a target" — reframed to per-artist coverage; explicitly **not** a gate.
