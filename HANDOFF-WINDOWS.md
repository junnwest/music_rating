# Windows Handoff — Pick Up Here

## What was done this session (Mac)

### Leaderboard formula fixes (already deployed to Supabase)
- **Formula v2** (`20260630000004`): per-tier max + diversity bonus — albums with more sources now rank higher, no source can lower an album's score
- **Dynamic prestige weight** (`20260630000005`): prestige starts at 100%, ratings blend in gradually as count grows; albums with 0 prestige sources no longer appear

### Japan leaderboard
- Seeded **jp_mino_100** (みのミュージック listener poll, 100 Japanese albums, scope_country='jp')
- Japan went from 1 → 26 albums in the leaderboard
- 14 entries had no MB match (see below)

### New script
- `seed:missing-from-external` — automatically finds all MBIDs in `external_scores` that have no matching row in `release_groups`, looks up the primary artist via MB API, and queues them for ingestion. No hardcoded list needed.

---

## What's still missing (needs Windows pipeline)

### 1. Ingest missing artists from external sources (most important)

These albums have MBIDs in `external_scores` but the artist was never ingested, so they don't appear in the leaderboard:

- **Korean classics**: 유재하, 들국화, 산울림, 한대수, 어떤날 (top 8 of kr_masterpiece_100)
- **Japanese**: 14 jp_mino_100 entries (大瀧詠一, Fishmans/空中キャンプ, Sugar Babe, etc.)
- **Global**: Abbey Road, Nevermind, Dark Side of the Moon (in rs500 external_scores but release_groups has no matching mb_release_group_id)

**Run in order:**

```bash
cd apps/web

# 1. Preview what will be queued (no writes)
npm run seed:missing-from-external:dry

# 2. Queue all missing artists (hits MB API at 1 req/s, ~2-5 min)
npm run seed:missing-from-external

# 3. Restart pipeline so it picks them up
npm run pipeline

# 4. After ingestion finishes, link MBIDs on any existing album rows
npm run backfill:rg-credits
```

### 2. Verify leaderboard after ingestion

```bash
# Regenerate the dashboard HTML to check rankings
npx tsx --env-file=.env.local scripts/generate-leaderboard-dashboard.ts
```

Open `ranking-actual-dashboard.html` and confirm:
- KR: 유재하 "사랑하기 때문에" appears near top
- KR: 들국화, 산울림, 한대수 visible
- Global: Abbey Road, Nevermind, Dark Side of the Moon visible
- JP: more entries (was 26, should grow)

---

## Current leaderboard state (as of end of session)

| Region | Albums showing | Key gaps |
|--------|---------------|----------|
| Global | 30 | Abbey Road, Nevermind, DSOTM not showing (no MB link in release_groups) |
| Korea  | 30 | Top 8 of kr_masterpiece_100 not showing (artists not ingested) |
| US     | 30 | Looking OK |
| Japan  | 26 | 14 jp_mino_100 entries unmatched (e.g. 大瀧詠一, Fishmans, Sugar Babe) |

---

## Score reference (what scores mean)

| Score | Meaning |
|-------|---------|
| 8.5+  | Top of kr_masterpiece_100 / jp_mino_100 rank #1 (prestige only) |
| 7.5–8.0 | Grammy AOTY winner or single top-tier source |
| 6.0–7.5 | Multiple mid-tier sources |
| <6.0  | Single nomination or low-rank list entry |

Dynamic weighting: at 0 ratings = 100% prestige; grows to max 55% ratings / 45% prestige as rating count increases.
