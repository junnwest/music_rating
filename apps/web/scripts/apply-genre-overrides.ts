/**
 * The MANUAL genre source (GENRE_TAXONOMY.md Phase 3): lands the hand-curated genres
 * in scripts/genre-overrides.json in `release_genres(source='manual')` — top trust in
 * the merge (lib/genres/merge.ts), so a human's call outranks every acquired tag.
 *
 * The file predates the catalog renovation: its `id`s are old Spotify-era release ids
 * that no longer exist, so each entry is matched to a release group by ARTIST + TITLE
 * (first credited artist via artist_aliases, edition-stripped title key; see
 * findReleaseGroup), with release year then type breaking ties. Only an unambiguous single match is written — a wrong
 * match would put top-trust genres on the wrong album; misses/ambiguities are listed
 * for a human to fix in the file.
 *
 * Goes through the shared per-source writer (lib/genres/sourceWriter.ts): tags resolve
 * to canonical ids, the album's `manual` rows are replaced with the file's current set
 * (so editing the file and re-running is the whole workflow), and unresolvable tags
 * are staged in `genre_unmapped`. It no longer writes the dead `releases.genres`.
 *
 *   npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSourceGenres, resolveSourceTags, type SourceGenreInput } from '../lib/genres/sourceWriter';
import { normalizeStr, releaseGroupKey } from './itunes-ingest-core';

const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
const IN_PATH = join(__dirname, 'genre-overrides.json');

interface OverrideRow {
  id: string;
  title: string;
  artist: string;
  release_date: string | null;
  release_type: string | null;
  sources: string[];
  genres: string;
}

interface RGMatch {
  id: string;
  title: string;
  artist_display: string;
  first_release_date: string | null;
  release_group_type: string | null;
}
const RG_COLS = 'id, title, artist_display, first_release_date, release_group_type';

/** Escape PostgREST ilike wildcards so a string is matched literally. */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The first credited artist of a free-text credit ("Sik-K, Lil Moshpit" → "Sik-K"). */
const firstArtist = (credit: string) => credit.split(/,| & | x | feat\.? | with /i)[0].trim();

/** Narrow several candidates: exact title (the key folds "K-FLIP"/"K-FLIP+" together),
 *  then same release year, then the override's release type. */
function narrow(hits: RGMatch[], row: OverrideRow): RGMatch[] {
  if (hits.length > 1) {
    const exact = hits.filter((h) => h.title.trim().toLowerCase() === row.title.trim().toLowerCase());
    if (exact.length) hits = exact;
  }
  if (hits.length > 1 && row.release_date) {
    const year = row.release_date.slice(0, 4);
    const sameYear = hits.filter((h) => h.first_release_date?.startsWith(year));
    if (sameYear.length) hits = sameYear;
  }
  if (hits.length > 1 && row.release_type) {
    const type = row.release_type.toLowerCase();
    const sameType = hits.filter((h) => h.release_group_type?.toLowerCase() === type);
    if (sameType.length) hits = sameType;
  }
  return hits;
}

/**
 * Match an override to ONE release group. Primary strategy: resolve the first credited
 * artist through artist_aliases (normalized, so "Dynamicduo"/"Dynamic Duo" and Korean
 * names both work via the alias table), then compare edition-stripped title keys
 * (releaseGroupKey — "Odd - The 4th Album"/"(Remastered)" collapse). Fallback: literal
 * title + artist_display substring. Anything but a single survivor is reported.
 */
async function findReleaseGroup(row: OverrideRow): Promise<{ match?: RGMatch; reason?: string }> {
  const key = releaseGroupKey(row.title);
  const artist = firstArtist(row.artist);
  const norms = [...new Set([normalizeStr(artist), normalizeStr(artist).replace(/ /g, '')])].filter(Boolean);

  const { data: aliases, error: aErr } = await db.from('artist_aliases').select('artist_id').in('alias_norm', norms);
  if (aErr) return { reason: `alias query failed: ${aErr.message}` };
  const artistIds = [...new Set((aliases ?? []).map((a) => a.artist_id as string))];

  let hits: RGMatch[] = [];
  if (artistIds.length) {
    const { data, error } = await db.from('release_groups').select(RG_COLS).in('primary_artist_id', artistIds.slice(0, 50));
    if (error) return { reason: `release_group query failed: ${error.message}` };
    hits = ((data ?? []) as RGMatch[]).filter((rg) => releaseGroupKey(rg.title) === key);
  }
  if (!hits.length) {
    const { data, error } = await db
      .from('release_groups')
      .select(RG_COLS)
      .ilike('title', literal(row.title.trim()))
      .ilike('artist_display', `%${literal(artist)}%`)
      .limit(20);
    if (error) return { reason: `fallback query failed: ${error.message}` };
    hits = (data ?? []) as RGMatch[];
  }

  hits = narrow(hits, row);
  if (hits.length === 1) return { match: hits[0] };
  return {
    reason: hits.length
      ? `ambiguous (${hits.length} release groups: ${hits.map((h) => `${h.title} ${h.first_release_date ?? '?'} ${h.release_group_type ?? ''}`).join(' | ')})`
      : artistIds.length
        ? `artist found, no release group titled like this`
        : 'artist not in catalog',
  };
}

async function main() {
  console.log(`\n🎵  Apply genre overrides → release_genres(source='manual')${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const parsed = JSON.parse(readFileSync(IN_PATH, 'utf8')) as { releases: OverrideRow[] };
  const all = parsed.releases ?? [];
  const filled = all.filter((r) => r.genres && r.genres.trim() !== '');
  console.log(`Entries: ${all.length} (${filled.length} with genres, ${all.length - filled.length} blank → skipped)\n`);

  const items: SourceGenreInput[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const row of filled) {
    const { match, reason } = await findReleaseGroup(row);
    if (!match) {
      unmatched.push(`  ✗ ${row.title} — ${row.artist}: ${reason}`);
      continue;
    }
    if (seen.has(match.id)) {
      unmatched.push(`  ✗ ${row.title} — ${row.artist}: duplicate entry for the same release group`);
      continue;
    }
    seen.add(match.id);
    const tags = row.genres.split(',').map((t) => ({ tag: t.trim(), confidence: null })).filter((t) => t.tag);
    const { genres, unmapped } = resolveSourceTags(tags);
    console.log(
      `  ✓ ${match.title.slice(0, 40).padEnd(40)} — ${match.artist_display.slice(0, 24).padEnd(24)} ` +
        `→ [${genres.map((g) => g.genreId).join(', ')}]${unmapped.length ? `  unmapped: ${unmapped.join(', ')}` : ''}`,
    );
    items.push({ releaseGroupId: match.id, title: match.title, tags });
  }

  const res = await writeSourceGenres(db, 'manual', items, { dryRun: DRY_RUN });

  if (unmatched.length) console.log(`\nNot applied (fix the title/artist in genre-overrides.json):\n${unmatched.join('\n')}`);
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Matched release groups : ${items.length}/${filled.length}
  release_genres rows    : ${res.upserted} ${DRY_RUN ? 'to write' : 'written'}, ${res.deleted} deleted, ${res.unchanged} already current
  Unmapped tags staged   : ${res.unmappedStaged}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${DRY_RUN ? '\n  DRY RUN — no writes.' : ''}
`);
}

main().catch((err) => { console.error(err); process.exit(1); });
