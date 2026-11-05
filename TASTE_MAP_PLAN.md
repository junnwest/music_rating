# Taste Map 3D: plan and brainstorm

Source idea: `taste-map-prompt.md` (Jun, 2026-11). Written 2026-11-03.

**Status (2026-11-05):** access gate (allowlist junnwest/zero/one; 50 rated albums for others), ghost nodes, interactive 2D refocus, rebuilt 3D — see README START HERE. Earlier status (2026-11-03, evening): Phase 0 and Phase 1 are built; Phase 2 is built except Jun's visual sign-off.
- **Engine:** `apps/web/lib/tasteMap/` holds `types.ts` (the contract), `load.ts`, `eras.ts`, `features.ts`, `layout.ts`, `forceLayout.ts` and `metric.ts`. Tests: 47 passing.
- **Migration:** `20261103000000_taste_map.sql` is ✅ applied.
- **Similar artists:** `backfill:artist-similar` ✅ ran for the 116 rated artists (Last.fm + ListenBrainz).
- **Route and viewer:** `GET /api/taste/map` and an unlinked `/taste/map` viewer. `?mock=1` shows a fixed mock map; `?refresh=1` forces a re-solve.
- **2026-11-03 night (autonomous, uncommitted):** Phase 3 built (drag/pin in 2D + 3D, browser Re-arrange, autosave, `PUT pins|layout`, export/import). Phase 4 server routes built (groups, eras, metric, place); Phase 4 UI built (groups, eras, metric panel, Add artist ghost). Write-route contract: `lib/tasteMap/apiTypes.ts`. A saved layout is stored as `version = 2` ("user-arranged") and is never re-solved by UMAP. Migration `20261104000000_taste_map_pin_soft_z.sql` is written, **not applied**. See README START HERE.
- **2026-11-04:** migration `20261104000000` ✅ applied. Every Phase 3/4 route passed against prod on zero's account (state restored to empty afterwards). Committed and deployed: live, **unlinked**, at `sillajuku.com/taste/map`. Still unbuilt from Phase 4: glow by predicted affinity, automatic metric re-fit after each Re-arrange.
- **Not built:** the iOS view.
- **Inspecting any user's map:** `/taste/map?fixture=<url>` (dev only) renders a payload from `scripts/dump-taste-map-layout.ts --out`.
- **Jun's account is `zero`** (29 nodes, 9 seeded groups; `0_0` was a wrong guess). Two islands at every era weight, East Asian vs Western.
- ✅ **Era weight is 0.5** (`DEFAULT_BLOCK_WEIGHTS.era`, picked 2026-11-03 from 2D renders at 1 / 0.5 / 0.25). Jun may revisit the other options. Halving scene inside the era block (`ERA_SCENE_SHARE` 0.3) didn't merge the islands.
- **Open, review later: the East Asian / Western islands.** Accepted for now, but the design should stay flexible. They come from language-qualified tag dims (rock by a Japanese act is only J-Rock) and the listener graph, not scene. Jun's preferred direction is a hybrid: model how genres and subgenres evolve across scenes (J-Rock partly shares Rock's lineage, city pop vs its revival) and keep the language axis. One candidate is giving each qualified tag dim a partial language-neutral share via the taxonomy DAG.
- **Open: era splitting has no signal on real data.** Coldplay shows no 2008|2011 boundary: its tags barely change, and the jina vectors embed "title by artist. tags (year)", which is not sound. Its best cut scores 0.08 / 0.16 against gates of 0.35 / 0.2. Any gate loose enough to split it splits ~21 consistent artists first. Thresholds are unchanged. The target is pinned as an `it.fails` test on `__fixtures__/map-input-zero-eras.json`. Routes to a real split: the manual era override (Phase 4 UI), better per-album tags, or a per-album sound signal (Phase 6 descriptors).

The prompt describes a standalone personal tool (Vite, FastAPI, DuckDB, localStorage). Its own open question, "is sillajuku my own project?", has a yes answer, and that changes the plan. Most of the data layer the prompt asks for already exists here. The work is a **new view and a personal-correction layer** on top of the catalog and taste system, plus an **offline ML lab** for the research parts.

---

## 1. Already built vs. needed

| Prompt asks for | Already in sillajuku | Gap |
|---|---|---|
| MusicBrainz IDs as canonical keys, local DB | MB-keyed catalog (113k artists, 839k release groups) in Supabase | none |
| Tags per artist (Last.fm, MB) | `artists.genre_evidence` (MB + Last.fm + Wikidata + iTunes, backfilled), `release_genres`, 304-node taxonomy DAG + language axis | a TF-IDF **feature vector** over taxonomy nodes, built from data we already have |
| Multilingual text embeddings | **jina-embeddings-v3, 1024-d**, on 402k release groups (`releases.embedding`) | per-artist / per-era pooling |
| Similar-artist graph | Last.fm `artist.getSimilar` works (used in `scripts/discover-global.ts`); `tag.getSimilar` is dead | cache similar artists per artist; add ListenBrainz similar-artists (keyed by MBID) |
| Genre geometry | `lib/taste/genre-embeddings.json` (PPMI + SVD over catalog co-occurrence) | none |
| Distinct taste "worlds" | `lib/taste/worlds.ts`: taxonomy × language worlds (J-Rock, Korean Hip-Hop, Rock…) | use them as the **seed groups** |
| Explicit ratings | `ratings` + Elo display score, album-level (Taste is albums only since 2026-10-11) | none; artist and era nodes are aggregated from albums |
| Listening history | `profiles.spotify_artists` / `spotify_recently_played` | Last.fm scrobble import (optional, later) |
| Map UI | `components/sj/TasteGraph.tsx` (cover-mosaic treemap) | the 3D/2D spatial view: **new** |
| Pins, groups, eras, learned metric | none | **new** |

**Constraints this plan follows:**
- Supabase is a Micro instance, so all vector math stays in Node (standing rule in the taste-system memory). The DB stores user inputs and cached outputs only.
- Web is Next 14 + **React 18**, so it uses `@react-three/fiber@8` + `@react-three/drei@9`. fiber v9 needs React 19.
- iOS is SwiftUI and can't reuse three.js. The server must return **solved positions**, so iOS only renders (2D Canvas first, SceneKit later). iOS work needs the Mac.
- `/api/taste/profile` has `maxDuration = 15`. Layout solves must be cached and incremental, not recomputed on every request.
- PostgREST clamps `.limit()` to 1000. Page every bulk read with a stable ORDER BY.

---

## 2. Design decisions (brainstorm → recommendation)

### D1. What is a node? → **an artist-era, built from albums**
sillajuku is album-first, and that solves the Coldplay problem without extra work. Each album already has a feature vector (taxonomy tags + jina embedding + year). An artist node is the mass-weighted mean of its albums. An era is a **chronologically contiguous segment** of the artist's catalog albums:
- **Auto-split:** run change-point detection over the release-year-ordered album vectors (all catalog albums, not only rated ones). Split when 2 segments cut within-artist variance by more than a threshold *and* the segments are far apart in the base space. Coldplay should split around 2011 on its own.
- The user can override by merging eras or moving the split year. Overrides are stored; the detector is only the first draft.
- Trail: a faint polyline through an artist's era nodes in chronological order.

### D2. Semantic zoom: three levels in one space
- **Far:** worlds and groups as soft nebulae (density blobs) with one label each.
- **Mid:** artist/era labels, billboarded, sized by the user's mass, colored by average score (`spectrumColor`).
- **Near:** the rated **album covers** orbit their artist node. sillajuku is visually cover-centric, and the treemap already proves covers work.

### D3. Base space → **personal UMAP, initialized from a global anchor**
- **Global anchor (offline, monthly):** a 3D layout of all catalog artists with enough data, built with the same artifact pattern as `build-genre-embeddings`. This gives stability (the map doesn't reshuffle on refresh), comparable maps between users (needed later for social features), and a backdrop for blind spots / fog of war.
- **Personal layout:** `umap-js` (cosine, fixed seed) over only the user's nodes (~50–500), **initialized from the global coordinates**. It runs in Node in about 1–2s at this size and is cached per user.
- **New-artist placement:** kNN barycentre. Average the k nearest placed nodes' positions in the learned metric, weighted by similarity. This is explainable ("placed here because it's near X, Y, Z") and needs no UMAP transform.

### D4. Re-arrange with pins → **constrained force layout, not re-running UMAP**
`d3-force-3d`, run in the browser:
- anchor force toward the UMAP position (strength decays as the user corrects more);
- link force over the kNN graph in the learned metric;
- pinned nodes fixed (`fx/fy/fz`);
- attraction to group centroids, weighted by membership (Bastille 0.6 / 0.4);
- collision on label size.

It animates for free (the simulation ticks are the transition). Solved positions are saved to the server so iOS and other devices render the same map.

### D5. 2D toggle → **project the canonical 3D layout, don't solve twice**
2D = the 3D layout projected onto its top-2 principal plane (stable, not tied to the camera), then a short 2D collision-only force pass. A drag in 2D pins (x, y) and leaves z soft. One source of truth, so positions stay consistent between modes.

### D6. Metric learning → **diagonal weights from triplets, block weights first**
- Features are blocks: `[taxonomy TF-IDF (interpretable) | jina pooled (1024→PCA 64) | similarity-graph (SVD 32) | era/scene]`, each block L2-normalized.
- v1 learns **block weights** (4 numbers: "for you, sound description matters 2× more than genre tags") plus **diagonal weights on the taxonomy block only**, where each dimension has a name.
- Training signal: after each re-arrange, sample triplets from the pinned/grouped layout. (A, B) are within radius r on the map and (A, C) are beyond R. Add group co-membership as positives. Loss: hinge `m + d_w(A,B) − d_w(A,C)` plus `λ‖w − 1‖²`, with projected gradient so w ≥ 0. Hundreds of triplets × ~350 dims solve in milliseconds in Node.
- **Eval, visible in the UI:** leave-one-pin-out. Predict each pinned node's position from the others by kNN barycentre and compare the error with w = 1 and w = learned. If learned doesn't win, the system keeps w = 1 and says so.
- Taxonomy dims are genres, not descriptors like "anthemic". The "anthemic chorus" kind of weight only appears after Phase 6 adds the LLM descriptor vocabulary. Until then, expect learned weights like "language matters more to you than era".

### D7. Groups and soft membership → **seeded from worlds, then a mixture**
- Seed groups = the user's taxonomy × language worlds (J-Rock ≈ "Yorushika world", Korean Hip-Hop, Rock/Britpop). The user renames, merges and creates groups.
- Membership = softmax over cosine to group prototypes in the learned metric. A manual weight overrides the softmax for that node.
- Rendering: 2D uses `d3-contour` density per group. 3D uses additive-blended sprite billboards per member, which reads as a nebula and is cheap. Skip marching cubes.
- Phase 5's mixture model replaces the seed prototypes with discovered modes. Groups the user has named are kept.

### D8. Explanations are exact, not SHAP
With weighted cosine over concatenated normalized blocks, the similarity between two nodes splits exactly into per-dimension terms `w_k·a_k·b_k`. "Why here?" shows:
- top 3 neighbors;
- for each neighbor, the top contributing taxonomy dims by name, plus each block's share ("listeners overlap 40%, genre 35%, description 25%").

This is cheap and needs no model. Save SHAP/IG for the Phase 5 taste model.

### D9. Where things run
| Work | Where |
|---|---|
| Feature build per node, UMAP, triplet fit, auto-place, era detection | Node, `lib/tasteMap/*`, cached in Redis + DB |
| Force re-arrange, rendering, drag | Browser |
| Render only (positions from the server) | iOS |
| Global anchor layout, similar-artist backfill | `scripts/` (offline) |
| LoRA, critic LLM, audio, GNN, sparse autoencoder | **`lab/` Python, offline, never deployed.** Writes small artifacts back (weight vectors, projections, labels) |

---

## 3. Data model (one migration, additive)

Store **user inputs and cached solves only**. Features are derived on demand.

```sql
-- node_key: 'a:<artist_uuid>' or 'e:<artist_uuid>:<first_rg_uuid>' (era starts at that album)
taste_map_layouts   (user_id pk, positions jsonb, dims int, version int, solved_at, input_hash text)
taste_map_pins      (user_id, node_key, x real, y real, z real, pinned_at)       pk(user_id,node_key)
taste_map_groups    (id uuid pk, user_id, name, color, seed_world text null, created_at)
taste_map_members   (group_id, node_key, weight real, manual bool)               pk(group_id,node_key)
taste_map_eras      (user_id, artist_id, split_rg_ids uuid[], manual bool)       pk(user_id,artist_id)
taste_map_metric    (user_id pk, block_w jsonb, dim_w jsonb, eval jsonb, n_triplets int, fitted_at)
artist_similar      (artist_id, source text, similar jsonb, fetched_at)          pk(artist_id,source)  -- lastfm | listenbrainz
```

RLS: owner read/write on all `taste_map_*` tables. `artist_similar` is service-role write, public read. A `visibility` column on `taste_map_layouts` is reserved for the read-only share link (stretch goal).

**Schema hooks for the Future section, added now so nothing needs migrating later:** `node_key` is generic (it can hold a track or "moment" key later), `taste_map_metric` is versioned per **lens** (`lens text default 'sound'`), and positions jsonb is keyed by lens.

---

## 4. Executable phases

Each phase ships end to end and runnable, then updates README/SESSIONS. Effort is in working sessions.

### Phase 0: Spike and data check (1 session)
- [ ] `scripts/dump-taste-map-nodes.ts --user=junnwest`: build artist nodes from rated albums and print node count, feature coverage (% with taxonomy tags / jina vector / similar-artist data), and Coldplay-style era-split candidates.
- [ ] Throwaway UMAP → `scratch/positions.json` → plain three.js HTML page, to look at it before building anything.
- **Exit:** you look at the throwaway map and say whether the worlds separate. If not, fix features first (likely the 23% of albums with no genre tags).

### Phase 1: Data layer (1–2 sessions) ≈ prompt milestone 1
- [ ] Migration `2026110X000000_taste_map.sql` (section 3).
- [ ] `scripts/backfill-artist-similar.ts`: Last.fm `artist.getSimilar` + ListenBrainz similar-artists for **rated artists first**, resumable, rate-limited (pattern: `backfill:artist-genres`). Key comes from `LASTFM_API_KEY` (already in `.env.example`).
- [ ] `lib/tasteMap/features.ts`: per-node block vectors (TF-IDF over taxonomy closure via `NODE_BY_ID`, language-qualified; pooled jina; similarity-graph SVD; era/scene from `albumVector.ts`). Unit tests with a golden fixture (5SOS/Walk the Moon close, Yorushika far from Oasis).
- [ ] `lib/tasteMap/eras.ts`: change-point split + tests (Coldplay fixture).
- [ ] `scripts/build-taste-anchor.ts` → `lib/tasteMap/anchor.json` (global 3D, catalog artists with ≥N albums). Check size; quantize to int16 if large.

### Phase 2: Viewer, read-only (2 sessions) ≈ milestone 2
- [ ] `GET /api/taste/map`: nodes + positions + groups (seeded from worlds) + per-node neighbors. Cache `tastemap:v1:<user>:<input_hash>`.
- [ ] `app/(main)/taste/map/page.tsx` + `components/sj/tasteMap/Scene3D.tsx` (dynamic import, `ssr:false`): orbit controls, drei `<Billboard><Text>` labels, LOD for semantic zoom, hover card.
- [ ] `Map2D.tsx`: canvas render of the PCA plane, d3-zoom, label collision.
- [ ] Entry point: an "Open map" button on the existing TasteGraph. **The treemap stays.**
- [ ] Deps: `three`, `@react-three/fiber@8`, `@react-three/drei@9`, `d3-force-3d`, `umap-js`, `d3-contour`. Pin exact versions.

### Phase 3: Drag, pin, re-arrange, save (2 sessions) ≈ milestones 3 + 7
- [ ] Drag in 2D and 3D (drag on a camera-facing plane), pin toggle, "Re-arrange" runs the D4 force solve with animation.
- [ ] `PUT /api/taste/map/pins`, `PUT /api/taste/map/layout`. Debounced autosave.
- [ ] Export/import JSON (pins, groups, eras, metric) for backup.
- [ ] **iOS (Mac):** `TasteMapView` 2D Canvas, read-only, from `/api/taste/map`.

### Phase 4: Groups, eras, personal metric, auto-place (2–3 sessions) ≈ milestones 4, 5, 6
- [ ] Group CRUD, blob rendering, membership slider in the node panel.
- [ ] Era split/merge UI and trails.
- [ ] `lib/tasteMap/metric.ts`: triplet sampler + diagonal fit + leave-one-pin-out eval. Re-fit after each Re-arrange. A small "Your map weights…" panel shows the top weights and eval vs baseline.
- [ ] "Add artist": search (reuse the search RPC) → ghost node at the kNN barycentre → accept or drag.
- [ ] "Why here?" panel (D8).
- [ ] Glow by predicted affinity: kNN-smoothed score over rated neighbors until Phase 5 exists.

### Phase 5: Taste model baseline + eval page (2 sessions) ≈ milestone 10, part 1
- [ ] `lab/` (Python, `uv`, offline): export the user's features + ratings to Parquet → ridge on TF-IDF, then ridge on + jina → k-fold RMSE / Spearman / NDCG@10. Results go to `lab/runs/*.json`.
- [ ] Mixture of modes: GMM (BIC-selected k) on learned-metric features → proposed groups. The UI shows them next to the user's own groups.
- [ ] `/taste/map/eval`: a small dashboard (baseline vs model vs kNN, calibration plot).
- [ ] **Pairwise data already exists:** Instinct mode (pairwise comparison / Elo, `/api/rate/compare`, `lib/elo`) collects "A or B?" judgments. Check whether each comparison event is stored or only the resulting Elo. If events are stored, that's free Bradley–Terry training data. The Phase 7 active-learning prompt should **reuse the Instinct compare UI and endpoint**, choosing the pair by uncertainty instead of at random.

### Phase 6: Descriptor vocabulary (2 sessions) ≈ milestone 9
- [ ] An LLM extracts a controlled vocabulary (mood, energy, vocal style, texture, "anthemic", "math-y guitars") per **artist-era** from tags + our own catalog text, with confidence scores. Only features are stored, not source text. Use a current Claude model; cache by input hash.
- [ ] Add as a 5th, interpretable block. Metric learning now gives "anthemic matters 2.3× to you".
- [ ] Zero-shot "my own words" axes: embed a user phrase ("rainy-night J-rock") with jina and score every node by cosine.

### Phase 7+: research track, each item gated by eval ≈ milestones 11–13
Order by expected value per effort. Each item is **kept only if it beats the frozen baseline on held-out data**:
1. Active "A or B?" with uncertainty sampling (bootstrap ensemble of the ridge, which is cheap).
2. Bridge picks and blind spots: catalog nodes in the global anchor between two of the user's modes, or adjacent to one, that the user hasn't rated.
3. Temporal drift: time-weighted modes from `ratings.created_at`, and a map time-lapse.
4. Sparse/interpretable axes (NMF on the descriptor block first; a sparse autoencoder only if NMF fails), auto-labeled by an LLM.
5. **LoRA:** honestly, it's unlikely to help with a few hundred labels. The learned linear projection on frozen jina is the baseline to beat. For the "taste critic", the baseline is **Claude with retrieval over the user's own ratings and notes (few-shot)**. Fine-tune (mlx-lm on the MacBook Air, r = 4–8) only if that baseline fails on held-out pairwise accuracy.
6. Audio (CLAP/MERT on previews) and graph embeddings (node2vec): last, and only where previews are licensed for that use.

---

## 5. More ideas (brainstorm, not scheduled)

- **The map as the recommender's UI.** "Because you love Korean Hip-Hop" rows become "Explore this region". Tapping empty space nearby lists unrated catalog albums at that spot. `recommendations.ts` already scores by world, and this gives it a spatial front end.
- **Friend overlay.** Both maps sit in the same global anchor, so a friend's nodes can show as ghost dots on yours. Overlap regions are "resonance twins" v0.
- **Fog of war** over the global anchor: regions light up as you rate. It turns discovery into a game and suits a logging app.
- **Analogy queries:** "the Yorushika of K-hiphop" = nearest neighbor of `v(Yorushika) − v(J-Rock world) + v(Korean Hip-Hop world)`. It's one line of vector math once the blocks exist.
- **Travel path:** shortest path through the kNN graph between two artists becomes a Mix (Mixes already exist).
- **Lens switch (Future §4 lenses):** the same nodes re-solved with a different metric (sound / emotion / aesthetic) and an animated morph between them. The `lens` column above makes this a data change, not a schema change.
- **Taste DNA card:** a share image of the 2D map + top groups, reusing the existing share-sheet plumbing.

## 6. Risks and open questions

1. **Sparse data for most users.** The map needs about 20+ rated artists to look meaningful. Gate it like the Taste unlock (25 ratings), and fill the space with the global anchor backdrop.
2. **Untagged albums** (~23% of release groups) get only jina + similar-artist blocks. Phase 0 measures how much that hurts.
3. **UMAP instability:** the fixed seed, global init and the `input_hash` cache handle it. Re-solve only when inputs change.
4. **Bundle size:** three.js adds about 150 KB gzip. It's isolated to `/taste/map` through dynamic import.
5. **Decide:** personal-only first (Jun's map), or for every user from day one? Recommendation: build for all users and ship behind a feature flag visible only to Jun until Phase 4.
6. **Decide:** should the iOS map be 2D read-only for a long time? Recommendation: yes. 3D drag on a phone is poor UX anyway.

## 7. Next action
See README START HERE (2026-11-05). Candidates: Jun's review of ghosts / refocus / 3D; Phase 4 leftovers (affinity glow, auto metric re-fit; `metric.ts` still uses the pre-evidence similarity); Phase 5 taste model; RESONANCE_PLAN R1.

## 8. Visualization pass (2026-11-04)

Goal: make the space legible and *felt*. Color should encode the vector space itself (not the average score), the map should borrow from cartography and network theory, and distance doesn't have to be to scale. Look: the stage is a 3Blue1Brown-style dark canvas that explores like a star chart; everything around it stays sillajuku.

### Slice 1 — built (uncommitted)
- **Sound lens, the default** (`lib/tasteMap/palette.ts` server-side, `color.ts` client-side). Each map gets its own palette of up to 8 defining tags. Plain families and scene roots are excluded, near-synonyms are merged, and hues are ordered around the wheel by classical MDS so that tags that co-occur get neighboring hues. Node color = OKLab Σ share·(cos h, sin h): hue = which sounds, chroma = purity (opposing tags cancel to gray). Lightness = depth along the plane normal in 2D. The Score lens is still available as a toggle, with a crossfade between lenses.
- **Star-chart 2D** (`Map2D.tsx`, `fields.ts`): a graticule; a kernel-regression color field with opacity = density; isodensity contours; dashed group outlines; MST constellation lines; glowing stars; neighbor links drawn outward on select; and a compass of per-tag least-squares gradients (a fitted biplot).
- **Fullscreen** (`F`), the **Sound mix** bar in the inspector, and the 3D view on the same lens colors. Payload: optional `palette` + node `mix`, Redis key `tastemap:v2`.

Palette addendum (2026-11-04 night): **family rollups** (palette.ts step 3b). A plain family whose descendants are otherwise unassigned takes the weakest pick's slot when its orphan energy is larger (Electronic on zero). This is the data-driven stopgap; whether broad families should get hues as a rule is still open.

### Slice 2 — next
1. ✅ **Honest map** (built 2026-11-04, `honesty.ts`): per-node kNN recall@5 on the current view, the Distortion lens, fuzzy halos, torn/intruder marks on select, inspector + legend. zero: 0.72 (2D) / 0.76 (3D).
2. ⏸ **2D-native layout** (shelved 2026-11-04): measured with (1) on zero. 2D spring links: ≤ 0.72 (no gain). A 2-component UMAP warm-started from the plane: 0.74 at best (≈1 neighbor over 29 nodes). The ceiling is 3D UMAP's 0.76. Revisit only if a bigger map shows a real 2D-vs-3D gap. Any refine must keep D5 (move in-plane, lift via `fromPlane`).
3. ✅ **Countries** (built 2026-11-04, `regions.ts`): Louvain (γ=2) + connected-piece split (the Leiden guarantee) on the symmetrized kNN graph → density-clipped territories (min(K_c − max other, D − τ) contoured at 0), named by the dominant palette tag along each country's long axis, sized by area. Names are straight and rotated, not yet curved. Seeding groups from countries is not done yet.
4. ✅ **Bridges** (built 2026-11-04): Brandes betweenness ≥ 0.12 with a neighbor in another country → diamonds + an inspector line; one bundled arc per country pair, bent through the bridge. Hubness guard: a node in ≥60% of all kNN lists keeps only mutual edges.
5. ✅ **True-distance rings** (built 2026-11-05 as part of selection refocus, `focus.ts`): Distance / Vector / Depth refocus modes around the selected star, log-scaled similarity rings; 3D has the same rings as a Similarity orbit.
6. ✅ **Semantic zoom** to album covers, cursor fisheye, depth parallax, proximity cards, overlap removal (built 2026-11-05, `lens2d.ts`).
7. ✅ **"What's here?"** on empty space: the smoothed tag mix + nearest artists (built 2026-11-05); unrated catalog albums nearby via `/api/taste/map/nearby` (see SESSIONS).

### Slice 3 — schematic 2D (built 2026-11-04 afternoon)
**Schematic / To scale** toggle on the 2D stage. Schematic is the default. `schematic.ts` treats countries as VSEPR domains around a "YOU" nucleus: they repel, bigger ones take wider angles, and linked ones sit side by side. Members fill orbital shells (capital, then 6k) around each country's center, spaced evenly and turned toward the countries they link to. Stars morph between the views. The density layers belong to the true plane and fade out. Drag is off in the schematic. zero: honest map 0.69 schematic vs 0.75 true. Open: octilinear bonds, drag in the schematic, what to do with many one-member countries.

**Revised 2026-11-04 evening: hyperbole, not a diagram.** No countries go into the layout. Stars get VSEPR seats (bearings around YOU evened out, radius rank evened into a disc), then relax under Coulomb repulsion, kNN bonds and a loose seat pull. Every density layer (field, contours, territories, group outlines) is recomputed on the schematic positions, so overlaps and crossovers emerge, and the two sets crossfade. To scale: `closeGaps` slides UMAP's disconnected islands in, on the in-island similarity ruler, with a strait kept.

### Later
More lenses (Era, Frontier, predicted affinity once the Phase 5 model exists), a minimap, keyboard hops between neighbors, the iOS view decoding `palette`/`mix`, and a time-lapse of the map by year.
