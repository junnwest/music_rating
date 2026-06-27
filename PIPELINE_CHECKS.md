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
| 2026-06-26 | 7/7, structurally clean (4 empty, benign) | 18/hr ⚠ | 5178 | iTunes-shadow cleanup done + job C disabled. Rate dipped (restart/cleanup downtime in window + prolific stretch) — **re-check 2026-06-27**; if ≤20/hr persists, consider local mirror. qc lane heartbeat stale (pre-fix code) — clears on next restart. **Next due: 2026-06-27** |
