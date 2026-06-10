/**
 * Finds duplicate releases caused by the same album being ingested from both
 * Spotify and iTunes with mismatched artist names (e.g. "Yerin Baek" vs "백예린").
 *
 * Detection:
 *   1. Normalized title + normalized artist match (same-language duplicates)
 *   2. Same artist_id + normalized title match (cross-language name duplicates)
 *
 * Keeper selection (highest score wins):
 *   +100 per user rating | +50 per review/pin/ranking entry
 *   +40 if has both spotify_id AND itunes_id
 *   +20 if has itunes_id | +10 if has tracklist | +5 if has genres
 *
 * Fix (--fix):
 *   - Merges metadata from duplicate into keeper (itunes_id, cover, genres, native names)
 *   - Remaps all FK references (ratings, reviews, list_items, pinned_albums,
 *     ranking_votes, ranking_seed_entries, user_ranking_entries, curated_releases,
 *     track_ratings, rating_history) — handles unique-constraint conflicts by
 *     deleting the duplicate's conflicting rows before updating
 *   - Deletes the duplicate
 *
 * Run:
 *   npm run dedup:releases          ← report only, no changes
 *   npm run dedup:releases -- --fix ← merge + delete duplicates
 */

import { createClient } from '@supabase/supabase-js';

const FIX      = process.argv.includes('--fix') || process.argv.includes('--fix-low');
const FIX_LOW  = process.argv.includes('--fix-low');

// Release IDs that must never be dropped — confirmed false positives where
// norm() strips meaningful title distinctions or the date filter mis-classifies
// very old albums as padded dates.
const SKIP_IDS = new Set([
  // CHROMAKOPIA + (Tyler, The Creator) — deluxe edition, "+" stripped by norm()
  'af2281e1-ade5-429a-b1f8-9f7343f3b57f',
  // BIGBANG ALIVE — Korean (Feb, 7 tracks) and Japanese (Mar, 9 tracks) editions
  '0f499553-2344-40ee-976a-08047c12026a',
  'b9776f5f-f965-42c7-9f9e-c68cacba9fa2',
  'ea3f7640-74b9-49cc-96a7-12b49c60a25d',
  '997ad16f-4066-4082-acf4-1489e50712a9',
  // Hokey Pokey (Richard & Linda Thompson) — 1975 original album (not the 2004 compilation)
  '8d3aeb70-0f16-4596-b96c-84434680aca6',
  // K-FLIP+ (Sik-K & Lil Moshpit) — deluxe of K-FLIP; "+" stripped by norm() causes false match
  '274d9b4a-112a-4fcb-93d8-511218b35368',
  'f5e45ca3-ed19-4299-9e12-1a1754bd17ef',
  // "Miles Tones" (1980) vs "Milestones" (1958) — completely different Miles Davis albums;
  // norm() strips the space so both become "milestones"
  '5c971ac2-5d0f-451b-bfd6-b12de27457cc',
  'd3d1aab5-2ad4-4f18-bc8c-bd791a5853e5',
  // "1945 해방" — Drunken Tiger (solo, 2016) vs Drunken Tiger & YDG (collab, 2005)
  '5dd175e9-9930-429d-af95-365ea8a97775',
  'a56718b8-0c39-47bb-9d75-1a00ff040203',
  // LOONA "[#] - EP" (2020-02-05) vs "[+ +] - EP" (2018-08-20) — different EPs;
  // norm() strips all brackets/symbols leaving "ep" = "ep"
  '3b7060c6-cf76-4d71-b4f9-135d55bf3bb6',
  'fe5f5a7e-e5fd-4aaa-a8cd-8ab00233f0a5',
  // Mars "Rehearsal Tapes and Alt-Takes NYC 1976-1978" (6-track EP) vs
  // "Rehearsal Tapes and Alt - Takes Nyc 1976 - 1978" (41-track Album) — different releases
  '4acf9ab8-dc90-490a-9850-d664f461961f',
  '9f4e06ea-e1da-4602-add6-6369c3b25f86',
]);

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}
type DB = ReturnType<typeof getDB>;

// Strips punctuation and whitespace but preserves all Unicode scripts
// (CJK, Cyrillic, Arabic, Devanagari, Hebrew, Thai, Greek, etc.).
// Without this, Cyrillic-titled releases like "Душа - EP" and "Сон - EP"
// both stripped to "ep" and appear as false duplicates.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '') // strip non-letter/non-digit in any script
    .trim();
}

// ── Load all non-single releases ──────────────────────────────────────────────

interface Release {
  id: string;
  title: string;
  artist: string;
  title_native: string | null;
  artist_native: string | null;
  release_type: string | null;
  release_date: string | null;
  total_tracks: number | null;
  spotify_id: string | null;
  itunes_id: number | null;
  cover_url: string | null;
  genres: string | null;
  tracklist: any;
  artist_id: string | null;
}

async function loadAllReleases(db: DB): Promise<Release[]> {
  const all: Release[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist, title_native, artist_native, release_type, release_date, total_tracks, spotify_id, itunes_id, cover_url, genres, tracklist, artist_id')
      .not('release_type', 'ilike', 'single')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as Release[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// ── Dedup detection ───────────────────────────────────────────────────────────

function findDuplicateGroups(releases: Release[]): Release[][] {
  const rawGroups: Release[][] = [];

  // Strategy 1: same normalized title + same normalized artist
  const byTitleArtist: Map<string, Release[]> = new Map();
  for (const r of releases) {
    const key = `${norm(r.title)}__${norm(r.artist)}`;
    if (!byTitleArtist.has(key)) byTitleArtist.set(key, []);
    byTitleArtist.get(key)!.push(r);
  }
  for (const g of byTitleArtist.values()) {
    if (g.length > 1) rawGroups.push(g);
  }

  // Strategy 2: same artist_id + same normalized title (catches cross-language name variants)
  const byArtistId: Map<string, Release[]> = new Map();
  for (const r of releases) {
    if (!r.artist_id) continue;
    const key = `${r.artist_id}__${norm(r.title)}`;
    if (!byArtistId.has(key)) byArtistId.set(key, []);
    byArtistId.get(key)!.push(r);
  }
  for (const g of byArtistId.values()) {
    if (g.length > 1) rawGroups.push(g);
  }

  // Collapse overlapping groups — if two groups share any release ID they refer to
  // the same duplicate cluster and must be merged into one group. Without this,
  // a 4-way duplicate (e.g. 2NE1 CRUSH) produces multiple overlapping groups and
  // --fix would try to delete records that were already deleted by a prior group.
  return collapseOverlappingGroups(rawGroups);
}

function collapseOverlappingGroups(groups: Release[][]): Release[][] {
  const idToGroupIdx = new Map<string, number>();
  const merged: Release[][] = [];

  for (const group of groups) {
    let targetIdx: number | undefined;
    for (const r of group) {
      if (idToGroupIdx.has(r.id)) { targetIdx = idToGroupIdx.get(r.id)!; break; }
    }

    if (targetIdx !== undefined) {
      const existingIds = new Set(merged[targetIdx].map(r => r.id));
      for (const r of group) {
        if (!existingIds.has(r.id)) {
          merged[targetIdx].push(r);
          idToGroupIdx.set(r.id, targetIdx);
        }
      }
    } else {
      const newIdx = merged.length;
      merged.push([...group]);
      for (const r of group) idToGroupIdx.set(r.id, newIdx);
    }
  }

  return merged;
}

// ── Confidence ────────────────────────────────────────────────────────────────

// HIGH = safe to auto-merge. LOW = needs manual review (different editions,
// sequels, or reissues that share a normalized title but are genuinely separate).
function groupConfidence(group: Release[]): 'high' | 'low' | 'skip' {
  const tracks  = group.map(r => r.total_tracks).filter((t): t is number => t != null);
  const dates   = group.map(r => r.release_date).filter((d): d is string => d != null);

  // Large track count spread → probably different editions (e.g. standard vs deluxe)
  if (tracks.length >= 2) {
    const diff = Math.max(...tracks) - Math.min(...tracks);
    if (diff > 2) return 'low';
  }

  // Date gap > 90 days (ignoring padded YYYY-01-01 dates) → possible reissue/sequel
  const realDates = dates.filter(d => !(d.endsWith('-01-01') && d.length === 10 && !dates.some(x => x !== d && x.startsWith(d.slice(0, 4)))));
  if (realDates.length >= 2) {
    const times = realDates.map(d => new Date(d).getTime()).filter(t => !isNaN(t));
    if (times.length >= 2) {
      const daysDiff = (Math.max(...times) - Math.min(...times)) / 86_400_000;
      if (daysDiff > 90) return 'low';
    }
  }

  return 'high';
}

// ── Scoring ───────────────────────────────────────────────────────────────────

async function scoreRelease(db: DB, id: string): Promise<number> {
  let score = 0;

  const [{ count: ratingCount }, { count: reviewCount }, { count: pinCount }, { count: entryCount }] =
    await Promise.all([
      db.from('ratings').select('id', { count: 'exact', head: true }).eq('release_id', id),
      db.from('reviews').select('id', { count: 'exact', head: true }).eq('release_id', id),
      db.from('pinned_albums').select('id', { count: 'exact', head: true }).eq('release_id', id),
      db.from('user_ranking_entries').select('id', { count: 'exact', head: true }).eq('release_id', id),
    ]);

  score += (ratingCount ?? 0) * 100;
  score += (reviewCount ?? 0) * 50;
  score += (pinCount ?? 0) * 50;
  score += (entryCount ?? 0) * 50;

  return score;
}

function metadataScore(r: Release): number {
  let s = 0;
  if (r.spotify_id && r.itunes_id) s += 40;
  else if (r.itunes_id) s += 20;
  if (r.tracklist && Array.isArray(r.tracklist) && r.tracklist.length > 0) s += 10;
  if (r.genres) s += 5;
  if (r.cover_url) s += 3;
  return s;
}

// ── FK remapping ──────────────────────────────────────────────────────────────

// For tables with unique constraint on (user_id, release_id): delete conflicts, then update.
async function remapWithUserConflict(db: DB, table: string, keeperId: string, dupId: string) {
  // Find user_ids that already have a row pointing at keeper
  const { data: keeperRows } = await db.from(table).select('user_id').eq('release_id', keeperId);
  const keeperUserIds = (keeperRows ?? []).map((r: any) => r.user_id).filter(Boolean);

  if (keeperUserIds.length > 0) {
    await db.from(table).delete().eq('release_id', dupId).in('user_id', keeperUserIds);
  }
  await db.from(table).update({ release_id: keeperId }).eq('release_id', dupId);
}

// For ranking_seed_entries: UNIQUE(category_id, release_id)
async function remapSeedEntries(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db.from('ranking_seed_entries').select('category_id').eq('release_id', keeperId);
  const keeperCatIds = (keeperRows ?? []).map((r: any) => r.category_id).filter(Boolean);

  if (keeperCatIds.length > 0) {
    await db.from('ranking_seed_entries').delete().eq('release_id', dupId).in('category_id', keeperCatIds);
  }
  await db.from('ranking_seed_entries').update({ release_id: keeperId }).eq('release_id', dupId);
}

// For ranking_votes: UNIQUE(user_id, release_id, category_id)
async function remapRankingVotes(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db
    .from('ranking_votes').select('user_id, category_id').eq('release_id', keeperId);

  if ((keeperRows ?? []).length > 0) {
    for (const kr of keeperRows!) {
      await db.from('ranking_votes').delete()
        .eq('release_id', dupId)
        .eq('user_id', kr.user_id)
        .eq('category_id', kr.category_id);
    }
  }
  await db.from('ranking_votes').update({ release_id: keeperId }).eq('release_id', dupId);
}

// For user_ranking_entries: UNIQUE(user_id, category_id, release_id)
async function remapUserRankingEntries(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db
    .from('user_ranking_entries').select('user_id, category_id').eq('release_id', keeperId);

  if ((keeperRows ?? []).length > 0) {
    for (const kr of keeperRows!) {
      await db.from('user_ranking_entries').delete()
        .eq('release_id', dupId)
        .eq('user_id', kr.user_id)
        .eq('category_id', kr.category_id);
    }
  }
  await db.from('user_ranking_entries').update({ release_id: keeperId }).eq('release_id', dupId);
}

// For list_items: UNIQUE(list_id, release_id)
async function remapListItems(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db.from('list_items').select('list_id').eq('release_id', keeperId);
  const keeperListIds = (keeperRows ?? []).map((r: any) => r.list_id).filter(Boolean);

  if (keeperListIds.length > 0) {
    await db.from('list_items').delete().eq('release_id', dupId).in('list_id', keeperListIds);
  }
  await db.from('list_items').update({ release_id: keeperId }).eq('release_id', dupId);
}

// For curated_releases: UNIQUE on release_id (or genre+release_id)
async function remapCuratedReleases(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db.from('curated_releases').select('genre').eq('release_id', keeperId);
  const keeperGenres = (keeperRows ?? []).map((r: any) => r.genre).filter(Boolean);

  if (keeperGenres.length > 0) {
    await db.from('curated_releases').delete().eq('release_id', dupId).in('genre', keeperGenres);
  }
  await db.from('curated_releases').update({ release_id: keeperId }).eq('release_id', dupId);
}

// For track_ratings: UNIQUE(user_id, release_id, track_position)
async function remapTrackRatings(db: DB, keeperId: string, dupId: string) {
  const { data: keeperRows } = await db
    .from('track_ratings').select('user_id, track_position').eq('release_id', keeperId);

  if ((keeperRows ?? []).length > 0) {
    for (const kr of keeperRows!) {
      await db.from('track_ratings').delete()
        .eq('release_id', dupId)
        .eq('user_id', kr.user_id)
        .eq('track_position', kr.track_position);
    }
  }
  await db.from('track_ratings').update({ release_id: keeperId }).eq('release_id', dupId);
}

async function mergeAndDelete(db: DB, keeper: Release, dup: Release) {
  // Remap all FK references
  await remapWithUserConflict(db, 'ratings', keeper.id, dup.id);
  await remapWithUserConflict(db, 'reviews', keeper.id, dup.id);
  await remapWithUserConflict(db, 'pinned_albums', keeper.id, dup.id);
  await remapListItems(db, keeper.id, dup.id);
  await remapSeedEntries(db, keeper.id, dup.id);
  await remapRankingVotes(db, keeper.id, dup.id);
  await remapUserRankingEntries(db, keeper.id, dup.id);
  await remapCuratedReleases(db, keeper.id, dup.id);
  await remapTrackRatings(db, keeper.id, dup.id);
  // rating_history has no unique constraint — safe to update directly
  await db.from('rating_history').update({ release_id: keeper.id }).eq('release_id', dup.id);

  // Merge metadata from duplicate into keeper (fill any gaps)
  const patch: Record<string, any> = {};
  if (!keeper.itunes_id && dup.itunes_id)         patch.itunes_id = dup.itunes_id;
  if (!keeper.spotify_id && dup.spotify_id)        patch.spotify_id = dup.spotify_id;
  if (!keeper.cover_url && dup.cover_url)          patch.cover_url = dup.cover_url;
  if (!keeper.genres && dup.genres)                patch.genres = dup.genres;
  if (!keeper.title_native && dup.title_native)    patch.title_native = dup.title_native;
  if (!keeper.artist_native && dup.artist_native)  patch.artist_native = dup.artist_native;
  if (!keeper.tracklist && dup.tracklist)          patch.tracklist = dup.tracklist;
  if (!keeper.artist_id && dup.artist_id)          patch.artist_id = dup.artist_id;
  if (Object.keys(patch).length > 0) {
    await db.from('releases').update(patch).eq('id', keeper.id);
  }

  // Delete the duplicate
  const { error } = await db.from('releases').delete().eq('id', dup.id);
  if (error) throw new Error(`Failed to delete ${dup.id}: ${error.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const modeLabel = FIX_LOW ? ' [FIX ALL]' : FIX ? ' [FIX HIGH CONFIDENCE]' : ' [DRY RUN]';
  console.log(`\n  sillajuku duplicate release finder${modeLabel}\n`);

  const db = getDB();

  console.log('  Loading releases…');
  const releases = await loadAllReleases(db);
  console.log(`  Loaded ${releases.length} non-single releases\n`);

  const groups = findDuplicateGroups(releases);

  if (groups.length === 0) {
    console.log('  ✓ No duplicates found.\n');
    return;
  }

  console.log(`  Found ${groups.length} duplicate group(s):\n`);

  let totalFixed = 0, totalLow = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const hasSkippedId = group.some(r => SKIP_IDS.has(r.id));
    const confidence = hasSkippedId ? 'skip' : groupConfidence(group);
    const label = confidence === 'skip' ? ' [SKIP — hardcoded exclusion]'
                : confidence === 'low'  ? ' [LOW CONFIDENCE — SKIPPED]'
                : '';
    console.log(`  ── Group ${gi + 1}/${groups.length}${label} ${'─'.repeat(Math.max(0, 20 - label.length))}`);

    // Score each release
    const scored = await Promise.all(group.map(async r => {
      const userScore = await scoreRelease(db, r.id);
      const metaScore = metadataScore(r);
      return { r, score: userScore + metaScore, userScore, metaScore };
    }));

    scored.sort((a, b) => b.score - a.score);
    const keeper = scored[0].r;
    const dups   = scored.slice(1).map(s => s.r);

    for (const { r, score, userScore, metaScore } of scored) {
      const tag = r.id === keeper.id ? '  KEEP' : '  DROP';
      console.log(`  ${tag}  "${r.title}" — ${r.artist}`);
      console.log(`         id=${r.id}`);
      console.log(`         type=${r.release_type ?? '?'}  date=${r.release_date ?? '?'}  tracks=${r.total_tracks ?? '?'}`);
      console.log(`         spotify=${r.spotify_id ?? 'null'}  itunes=${r.itunes_id ?? 'null'}`);
      console.log(`         score=${score} (user=${userScore}, meta=${metaScore})`);
    }

    if (confidence === 'skip') {
      console.log(`         → permanently excluded via SKIP_IDS\n`);
      continue;
    }

    if (confidence === 'low' && !FIX_LOW) {
      console.log(`         → review manually; use --fix-low to include\n`);
      totalLow++;
      continue;
    }

    if (!FIX) {
      console.log(`         → run with --fix to merge\n`);
      continue;
    }

    try {
      for (const dup of dups) {
        await mergeAndDelete(db, keeper, dup);
        console.log(`  ✓ Merged "${dup.title}" (${dup.id}) into keeper\n`);
      }
      totalFixed++;
    } catch (err) {
      console.error(`  ✗ Error: ${(err as Error).message}\n`);
    }
  }

  const highCount = groups.length - totalLow;
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (FIX) {
    console.log(`  Fixed        : ${totalFixed} group(s)`);
    console.log(`  Skipped (low): ${totalLow} group(s) — review manually`);
  } else {
    console.log(`  High confidence : ${highCount} group(s) → safe to --fix`);
    console.log(`  Low confidence  : ${totalLow} group(s) → review manually`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
