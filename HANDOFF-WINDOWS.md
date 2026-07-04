# Windows Handoff — Pick Up Here

## What was done this session (Mac)

### Native-name pipeline: root cause fixed + data corrected
- `scripts/mb-ingest.ts`'s `pickNative()` was grabbing *any* CJK alias when none was flagged primary — sometimes surfacing an artist's birth/legal name instead of their stage name (e.g. E SENS → wrongly "강민호"). Fixed going forward.
- New `scripts/fix-bad-native-names.ts` corrected existing bad rows — 626 corrections applied to production, hardened through 3 rounds against real false-positive classes (see `SESSIONS.md` 2026-07-03 for the full trace).

### Native-name display wired across the whole iOS app
- Home/Profile first, then extended to Search, Rankings/Charts, Mix Library, Taste, Notifications.
- New migrations `20260703000004`/`20260703000005` (applied) add `native_title`/`artist_native` to every relevant RPC, rebuild `get_user_genre_standings` (was dropped in the schema renovation, never recreated), and fix a real `anon`-role timeout in the song-chart RPCs.

### Small terminology fix
- Album release-type label changed 앨범 → 정규 (iOS badge + web search filter) — 앨범 is a generic loanword, 정규/미니/싱글 is the actual three-way split Korean K-pop platforms use. EP intentionally stays "EP".

Everything above is committed and pushed to `main` (`0da5e69`, `548cca0`).

---

## What's next — split between Mac and Windows

Four items were on the table; split by which machine is naturally suited to each so both can move in parallel instead of one waiting on the other.

**Windows (this doc — pick up here):** the two open-ended data-sourcing problems below.
**Mac (in progress concurrently):** `get_charts_most_rated` intermittent 500, and a decision on the orphaned `ActivityView` screen. Not blocking anything below.

### 1. Korean release title backfill (research + implement)

`release_groups.native_title` is effectively 100% empty for Korean releases — Korean users never see the actual Korean-language album title, only the Latin/romanized one. Already tried and failed: iTunes and MusicBrainz don't carry K-pop Korean titles as a distinct field.

Needs fresh research into a real source, e.g.:
- Melon (melon.com) — Korea's dominant streaming platform, definitely has native titles, no public API but may be scrapable
- Genie / Bugs — similar, Korean-market platforms
- Naver Music / Naver's music search results
- Check if any of these have an unofficial/reverse-engineerable API before resorting to scraping (check ToS implications either way — flag if scraping looks like the only option, don't just proceed)

Once a source is found: a backfill script following the existing pattern (`scripts/backfill-native-names.ts` is the prior art for the artist-name equivalent — resumable, checkpointed, rate-limited) writing to `release_groups.native_title`.

### 2. Korean phonetic search backfill

Search doesn't understand Korean phonetic spellings of non-Korean artists — e.g. "드레이크" doesn't find Drake. The search code itself already works correctly (confirmed this session); it's purely a data gap — no Korean transliteration is stored for non-Korean artists at all.

Needs:
- A way to generate/source the standard Korean phonetic rendering per artist (there's often one "correct" convention, e.g. via Korean Wikipedia interlanguage links, or a transliteration library/heuristic — worth checking what Korean Wikipedia already has before building a transliteration algorithm from scratch)
- Decide where this lives: reuse `artists.name_native` (currently reserved for genuinely-native artists' real names) or a new column/table specifically for phonetic search aliases — recommend a **separate** column (e.g. `artists.name_phonetic_ko`) rather than overloading `name_native`, since this session's whole native-name correction effort was specifically about `name_native` meaning "this artist's actual native-script identity," not "a searchable phonetic rendering." Conflating the two would reintroduce the exact class of ambiguity that was just cleaned up.
- Wire the new column into `search_artists`/`search_release_groups` (both already normalize + match `name_native` — same pattern, new column)

### Verification for both

Once either backfill runs, spot-check a few known cases live (same approach used throughout this session):
```bash
cd apps/web
npx tsx --env-file=.env.local -e "
import { getDB } from './scripts/itunes-ingest-core';
const db = getDB();
// check a few known artists/releases after backfill
"
```
And update `SESSIONS.md` / `README.md`'s Known Issues per the project's doc-currency convention — both data gaps are currently documented there as open.
