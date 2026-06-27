/**
 * Re-link the pre-renovation rating backups onto the new MB catalog (RENOVATION_PLAN §7).
 *
 * The old catalog was truncated, so the backed-up `release_id` is gone. We match each
 * backup by its embedded `_release.{title, artist}` → the new `release_groups` row, then:
 *   • album ratings  → `ratings.release_group_id`   (UNIQUE user_id, release_group_id)
 *   • track ratings  → `track_ratings.recording_id` (via the group's canonical release
 *                       tracklist; UNIQUE user_id, recording_id)
 *
 * IDEMPOTENT + RE-RUNNABLE: matching is by content and writes are upserts on the unique
 * keys, so re-running after more of the catalog has ingested only fills in newly-matchable
 * ratings — it never duplicates. (Run it now for what's ingested, again after the pipeline
 * finishes draining.)
 *
 *   npx tsx --env-file=.env.local scripts/relink-ratings.ts            # dry-run (report only)
 *   npx tsx --env-file=.env.local scripts/relink-ratings.ts --write    # upsert matches
 *
 * Backups live at repo-root `backups/*_win.json` (gitignored).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDB, normalizeStr } from './itunes-ingest-core';

const WRITE = process.argv.includes('--write');
const ROOT = resolve(__dirname, '../../..'); // apps/web/scripts → repo root
const ALBUMS = resolve(ROOT, 'backups/ratings_pre_renovation_20260624_win.json');
const TRACKS = resolve(ROOT, 'backups/track_ratings_pre_renovation_20260624_win.json');

interface BackupRelease { title: string; artist: string }
interface AlbumRating { id: string; user_id: string; score: number | null; status: string | null; note: string | null; created_at: string; updated_at: string; elo_score: number | null; elo_games: number | null; _release: BackupRelease }
interface TrackRating { id: string; user_id: string; track_position: number; track_title: string; score: number | null; created_at: string; elo_score: number | null; elo_games: number | null; _release: BackupRelease }

// Drop edition qualifiers + " - EP/Single/Album" suffixes so a Spotify title collapses
// onto the clean MB group title ("Album (Deluxe)" / "FEELM - EP" → "Album" / "FEELM").
function stripEdition(t: string): string {
  return t
    .replace(/\s*[([][^)\]]*(deluxe|edition|version|remaster|anniversary|mono|expanded|special|repackage)[^)\]]*[)\]]\s*$/i, '')
    .replace(/\s*-\s*(the\s+\d+(st|nd|rd|th)\s+(full\s+|mini\s+)?album|ep|single|lp|mixtape)\s*$/i, '')
    .trim();
}

// Backup titles wrap the real name ("NewJeans 2nd EP 'Get Up'", "IU 5th Album 'LILAC'"),
// so produce several normalized candidates and match if ANY hits.
function titleCandidates(raw: string): string[] {
  const out = new Set<string>();
  out.add(stripEdition(raw));
  const quoted = raw.match(/[‘’'"“”]([^‘’'"“”]{2,})[‘’'"“”]/); // 'Get Up' / "X"
  if (quoted) out.add(stripEdition(quoted[1]));
  const prefix = stripEdition(raw).replace(/^.*?\b\d+(st|nd|rd|th)\s+(full\s+|mini\s+)?(album|ep|single|mixtape|lp)\b\s*/i, '');
  out.add(stripEdition(prefix));
  return [...out].map(s => normalizeStr(s)).filter(Boolean);
}
// Collab credits ("Sik-K, Lil Moshpit") → also try the primary artist only.
function artistCandidates(raw: string): string[] {
  const first = raw.split(/\s*[,&]\s*|\s+(feat|featuring|with|x)\s+/i)[0];
  return [...new Set([normalizeStr(raw), normalizeStr(first)])].filter(Boolean);
}

type DB = ReturnType<typeof getDB>;

async function loadGroupIndex(db: DB) {
  const byTitleArtist = new Map<string, string>();      // "title|artist" → rg.id
  const byTitle = new Map<string, string[]>();          // "title" → [rg.id] (fallback)
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('release_groups').select('id, title, artist_display').range(from, from + 999);
    if (!data?.length) break;
    for (const g of data as any[]) {
      const t = normalizeStr(stripEdition(g.title));
      byTitleArtist.set(`${t}|${normalizeStr(g.artist_display ?? '')}`, g.id);
      (byTitle.get(t) ?? byTitle.set(t, []).get(t)!).push(g.id);
    }
    if (data.length < 1000) break;
  }
  return { byTitleArtist, byTitle };
}

// Resolve a backup _release → rg.id. Try every title×artist candidate (exact), then
// title-only when that candidate is unique across the catalog.
function matchGroup(idx: Awaited<ReturnType<typeof loadGroupIndex>>, rel: BackupRelease): { id: string | null; reason: string } {
  const titles = titleCandidates(rel.title);
  const artists = artistCandidates(rel.artist);
  for (const t of titles) for (const a of artists) {
    const hit = idx.byTitleArtist.get(`${t}|${a}`);
    if (hit) return { id: hit, reason: 'title+artist' };
  }
  for (const t of titles) {
    const cands = idx.byTitle.get(t);
    if (cands && cands.length === 1) return { id: cands[0], reason: 'title-only (unique)' };
  }
  const ambig = titles.map(t => idx.byTitle.get(t)).find(c => c && c.length > 1);
  return { id: null, reason: ambig ? `ambiguous title (${ambig!.length})` : 'no match' };
}

async function main() {
  const db = getDB();
  const albums: AlbumRating[] = JSON.parse(readFileSync(ALBUMS, 'utf8'));
  const tracks: TrackRating[] = JSON.parse(readFileSync(TRACKS, 'utf8'));
  console.log(`\n  relink-ratings ${WRITE ? '[WRITE]' : '[dry-run]'} — ${albums.length} album, ${tracks.length} track ratings\n`);

  const idx = await loadGroupIndex(db);
  console.log(`  catalog: ${idx.byTitleArtist.size} release_groups indexed\n`);

  // ── album ratings → ratings.release_group_id ──
  let aMatched = 0; const aMiss: string[] = [];
  for (const r of albums) {
    const m = matchGroup(idx, r._release);
    if (!m.id) { aMiss.push(`${r._release.artist} — ${r._release.title}  [${m.reason}]`); continue; }
    aMatched++;
    if (WRITE) {
      const { error } = await db.from('ratings').upsert({
        user_id: r.user_id, release_group_id: m.id,
        score: r.score, status: r.status, note: r.note,
        elo_score: r.elo_score, elo_games: r.elo_games,
        created_at: r.created_at, updated_at: r.updated_at,
      }, { onConflict: 'user_id,release_group_id' });
      if (error) console.log(`  ! album upsert "${r._release.title}": ${error.message}`);
    }
  }

  // ── track ratings → track_ratings.recording_id (via canonical release tracklist) ──
  let tMatched = 0; const tMiss: string[] = [];
  for (const r of tracks) {
    const m = matchGroup(idx, r._release);
    if (!m.id) { tMiss.push(`${r._release.artist} — ${r._release.title} / ${r.track_title}  [${m.reason}]`); continue; }
    // canonical release of the group
    const { data: rel } = await db.from('releases').select('id').eq('release_group_id', m.id).eq('is_canonical', true).limit(1).maybeSingle();
    if (!rel) { tMiss.push(`${r._release.title} / ${r.track_title}  [no canonical release]`); continue; }
    // tracklist: release_tracks ⋈ recordings
    const { data: rts } = await db.from('release_tracks').select('position, recording_id, recordings(id, title)').eq('release_id', rel.id);
    const rows = (rts ?? []) as any[];
    const want = normalizeStr(r.track_title);
    let rec = rows.find(x => normalizeStr(x.recordings?.title ?? '') === want);
    if (!rec) rec = rows.find(x => x.position === r.track_position); // fallback to position
    if (!rec?.recording_id) { tMiss.push(`${r._release.title} / ${r.track_title}  [track not found]`); continue; }
    tMatched++;
    if (WRITE) {
      const { error } = await db.from('track_ratings').upsert({
        user_id: r.user_id, recording_id: rec.recording_id,
        score: r.score, elo_score: r.elo_score, elo_games: r.elo_games, created_at: r.created_at,
      }, { onConflict: 'user_id,recording_id' });
      if (error) console.log(`  ! track upsert "${r.track_title}": ${error.message}`);
    }
  }

  console.log(`  ── albums ──  matched ${aMatched}/${albums.length}, unmatched ${aMiss.length}`);
  aMiss.forEach(s => console.log(`     · ${s}`));
  console.log(`\n  ── tracks ──  matched ${tMatched}/${tracks.length}, unmatched ${tMiss.length}`);
  tMiss.forEach(s => console.log(`     · ${s}`));
  console.log(WRITE
    ? `\n  ✓ upserted ${aMatched} album + ${tMatched} track ratings. Re-run after the pipeline drains to catch the rest.\n`
    : `\n  [dry-run] no writes. Re-run with --write to upsert, and again after more of the catalog ingests.\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
