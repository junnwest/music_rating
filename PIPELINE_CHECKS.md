# Pipeline health checks

Periodic health checks for the MusicBrainz catalog pipeline.

> **If you are a Claude Code session, do this at session start:** read **Schedule** + the
> top row of **Check log** below. If today's date ≥ `next due` **and** the pipeline is
> running, then RUN the commands in **How to run**, interpret per **Reading the results**,
> report a short summary to the user, and **prepend a new dated row to the Check log** with
> the next due date. If it's not due yet, do nothing (don't nag). Always run the checks
> (regardless of due date) right after a pipeline restart, a migration, or a pipeline code
> change. Convert any relative dates to absolute. Don't auto-fix data — report and propose.

## Schedule (cadence)
- **Daily** while the launch 5k is draining — until `pending` ≈ 0 (est. **~2026-07-03 to 2026-07-08**).
- **Weekly** afterward (steady state: FRESHNESS re-polls + slow DISCOVER growth).
- **Always** after: a pipeline restart · a migration applied · a pipeline code change · the machine was off for hours.

## How to run (from `apps/web/`)
```
npm run pipeline:status   # liveness, throughput, ETA  (daily)
npm run pipeline:verify   # 7-check structural battery  (daily)
npm run mb:audit          # deeper data view: sample eyeball, skipped list, source purity, ISRC  (every ~3 days, or if verify flags)
```

## Reading the results — what's fine vs a real problem
**GOOD (no action):**
- `pipeline:verify` → **7/7, "structurally clean"**. The `N empty artist(s) to review` note is **benign** — features-only acts (e.g. SEHUN) legitimately have 0 core releases after the composition filter, plus a few known generic-name false-matches (kai/dean/gray class, 0 release_groups = no bad data).
- `pipeline:status` throughput: healthy is **≳ 25 artists/hr**. A reading taken right after a restart is **understated** (downtime sits in the 60-min window) — re-check before reacting.
- The `qc` **lane** heartbeat in `pipeline:status` can lag the live truth (it re-runs hourly and reflects the running process's code). **Trust `pipeline:verify` over a stale qc heartbeat.**

**REAL problems → tell the user / investigate:**
- `pipeline:status` shows `last 60m 0/hr` while `ingest` says `running` → **stalled** (machine asleep? MB unreachable? supervisor stuck).
- `pipeline:verify` **structural** fail — duplicate artists, canonical (>1 / 0 canonical), orphan releases, or unexpected `source` (NOT the empty-artists note).
- `pending` not decreasing across a full day.
- `mb:audit` sample shows artists with a country that contradicts the seed region (e.g. a Korean name as `[US]`/`[AU]`) → false-match (the iTunes-shadow / generic-name class).
- Throughput holding **≤ 20/hr** for multiple days → 5k won't finish in the 2-week window; revisit the local-MB-mirror option.

## Check log (newest first)
| Date | verify | rate (last 60m) | pending | notes / next due |
|------|--------|-----------------|---------|------------------|
| 2026-06-29 (late) | 6/7 (3 benign same-name dups) | n/a (prestige-prioritized) | ~1990 | **Prestige Western-ingest + padDate fix.** 726 modern Western prestige artists queued at priority → catalog **16k→~71k release_groups** (canon comp-heavy: Beatles 1,730 releases, etc.). Found+fixed `padDate` `??` partial-date crash (`"1994-??-11"` → aborted ingest for Mariah Carey/Luther Vandross/Damon Albarn) — committed `2928721`, verified live after restart (Luther re-ingested 71 RGs clean). Cleanliness audit: source-pure (70.6k MB/358 deezer/0 itunes/null), blocklist holding (0 VA leaks), 0 broken FKs; cleaned 1 orphan ("Salad Days"). verify's 3 dup-name flags benign (김광석 singer/drummer · S.E.S. group/jungle · Cream supergroup/Polish-DJ, each partner 0 RGs). `reconcile_prestige_scores` now **times out (57014)** under the ingest write-load — re-run after prestige queue drains. **Next due: 2026-06-30** |
| 2026-06-29 | 6/7 (same 김광석 false-positive) | post-restart (understated) | ~3369 | **"Various Artists" mega-match incident.** "Ray" mis-resolved to MB Various Artists (324k releases) → worker stuck ~71 min crawling + polluting (75 RGs/1143 recordings written). Fixed: **special-MBID blocklist** (`SPECIAL_MBIDS` in mb-ingest, filters resolver + guards ingest); VA footprint purged FK-safe w/ shared-recording check (all VA-exclusive). Pipeline restarted → blocklist + watchdog now live; drain resumed; "Ray"→needs_review. Watchdog wouldn't catch this (MB calls were flowing = "alive but slow") — distinct from a hang. **Next due: 2026-06-30** |
| 2026-06-28 (pm) | 6/7 (same 김광석 false-positive) | post-restart (understated) | 3520 | **Resolver fix verified live + a silent hang caught.** Overnight drain good (4919→~3522). Found the MB **ingest worker hung ~15 min** (frozen after `Dialogue → DIALOGUE+`, no error thrown — an untimed `await`; DISCOVER/EMBEDDINGS kept beating so not a sleep). Supervisor only restarts on *throw*, so a hang escapes it → **needs a heartbeat watchdog** (proposed). User restarted; draining resumed (pending ticking down, ingest beat fresh). Skip spike 52→909 is **benign**: 885 `no_match` (DISCOVER snowball churn) + only 9 from the new short-CJK guard. The 7 re-queued shadows resolved as designed: 리제→done(LeeZe), other 6→needs_review. **Next due: 2026-06-29** |
| 2026-06-28 (am) | 6/7 (integrity flag is a **false positive**) | 84/hr ✅ | 4919 | Throughput recovered hard: 84/hr (10m window ~258/hr) → ETA ~2.4d, comfortably inside the 2-wk window (local-mirror plan **not** needed). verify's lone fail = "1 duplicate artist name" = **김광석 ×2**, but they're two distinct MB artists (`singer` vs `drummer`, different MBIDs/disambiguation) — name-only check can't tell them apart; **benign, no merge**. mb:audit canonical integrity clean (>1 canonical=0, 0 canonical=0). report_block tables (`reports`/`blocked_users`) confirmed EXIST in prod (README migration table stale). **Next due: 2026-06-29** |
| 2026-06-27 | 7/7, structurally clean (5 empty, benign) | 20/hr | 5091 | Web orphan leak fixed at root (search-insert) + **deployed** (fd66fea) + 20 orphans cleaned — won't recur. Deezer fallback lane live (`DEEZER_FALLBACK=1`, idle). Rate ~20/hr → ETA ~10.6d (within the 2-wk window but **tight** — keep watching; if it holds ≤20/hr, stand up the local MB mirror). **Next due: 2026-06-28** |
| 2026-06-26 | 7/7, structurally clean (4 empty, benign) | 18/hr ⚠ | 5178 | iTunes-shadow cleanup done + job C disabled. Rate dipped (restart/cleanup downtime in window + prolific stretch) — re-check 2026-06-27; if ≤20/hr persists, consider local mirror. qc lane heartbeat stale (pre-fix code) — clears on next restart. |
