/**
 * Deezer fallback — recover GENUINELY MB-missing artists (queue rows MB left `skipped`
 * = no_match / needs_review) from Deezer. Clean by construction, fixing every job-C sin:
 *   • only the TARGET artist gets a row — collaborators are text `artist_display`, never
 *     separate entities (Deezer returns them as contributors, not artists);
 *   • country is the seed region hint or NULL — never a store country;
 *   • everything is tagged `source='deezer'` (artist `source_status='deezer_gapfill'`);
 *   • a disambiguation guard skips generic names (those go to mb-overrides, not here) and
 *     requires an exact-name Deezer match — no blind "take the top result".
 *
 * Recordings carry Deezer's ISRC (mb_recording_id stays null), so if MB later adds the
 * artist these can be matched/upgraded — unlike an iTunes fallback.
 *
 *   npx tsx --env-file=.env.local scripts/mb-deezer-fallback.ts            # dry-run (report matches)
 *   npx tsx --env-file=.env.local scripts/mb-deezer-fallback.ts --write    # ingest
 *   ... --limit=N   (default 10 skipped rows per run)
 *
 * Standalone + bounded on purpose — NOT an auto lane (yet), so it can't repeat job C's
 * uncontrolled pollution. Review a dry-run before --write.
 */
import { randomUUID } from 'node:crypto';
import { getDB, normalizeStr, releaseGroupKey, detectLanguage, mapGenre, type DB } from './itunes-ingest-core';
import { MB_ARTIST_OVERRIDES } from './mb-overrides';
import { searchArtists, artistAlbums, albumWithTracks, type DzArtist } from './deezer-client';

const WRITE = process.argv.includes('--write');
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : 10; })();
const MAX_ATTEMPTS = 3;
const now = () => new Date().toISOString();

// Generic / ambiguous names that name-search can't safely disambiguate (Deezer has no country
// to filter on) — these belong in mb-overrides, not here. Override keys + a short denylist +
// very short single tokens.
const GENERIC = new Set([...Object.keys(MB_ARTIST_OVERRIDES), 'dean', 'gray', 'kai', 'sole', 'bibi', 'hot', 'h o t', 'god', 'crush', 'cl']);
function isGeneric(norm: string): boolean {
  if (GENERIC.has(norm)) return true;
  return !norm.includes(' ') && norm.length <= 4; // single short token → too ambiguous for name search
}

const WIKI_REGION: Record<string, string> = { wikipedia_korea: 'KR', wikipedia_japan: 'JP', wikipedia_greater_china: 'TW', wikipedia_south_asia: 'IN' };
function regionHint(source: string, sourceId: string | null): string | null {
  if (source === 'seed') return sourceId;
  return WIKI_REGION[source] ?? null;
}

function tokenSet(s: string): Set<string> { return new Set(normalizeStr(s).split(' ').filter(Boolean)); }
function tokenSetEqual(a: string, b: string): boolean {
  const A = tokenSet(a), B = tokenSet(b);
  if (A.size === 0 || A.size !== B.size) return false;
  for (const t of A) if (!B.has(t)) return false;
  return true;
}
/**
 * Confident match: an exact normalized-name Deezer artist, else a token-set match (same words,
 * any order — catches "Hoshino Gen" ↔ "Gen Hoshino"); prefer most fans. Pure romanization
 * variants (e.g. "shik" vs "sik") are intentionally NOT matched — missing > wrong.
 */
function pickArtist(cands: DzArtist[], rawName: string): DzArtist | null {
  const want = normalizeStr(rawName);
  const exact = cands.filter(c => normalizeStr(c.name) === want).sort((a, b) => b.nbFan - a.nbFan);
  if (exact[0]) return exact[0];
  const ts = cands.filter(c => tokenSetEqual(c.name, rawName)).sort((a, b) => b.nbFan - a.nbFan);
  return ts[0] ?? null;
}

async function findOrCreateArtist(db: DB, dz: DzArtist, country: string | null): Promise<string> {
  const { data: ext } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'deezer').eq('external_id', String(dz.id)).maybeSingle();
  if (ext?.artist_id) return ext.artist_id as string;

  const id = randomUUID();
  const native = detectLanguage(dz.name) ? dz.name : null;
  const { error } = await db.from('artists').insert({
    id, name: dz.name, name_native: native, native_language: native ? detectLanguage(native) : null,
    country, disambiguation: null, source_status: 'gapfill_unverified', ingest_state: 'tracks_done',
    next_check_at: null, last_ingested_at: now(), cached_at: now(),
  });
  if (error) throw new Error(`artist insert "${dz.name}": ${error.message}`);
  const { error: extErr } = await db.from('artist_external_ids').upsert(
    { source: 'deezer', external_id: String(dz.id), artist_id: id }, { onConflict: 'source,external_id', ignoreDuplicates: true });
  if (extErr) throw new Error(`artist_external_ids "${dz.name}": ${extErr.message}`); // surface, don't silently break idempotency
  return id;
}

async function ingestArtist(db: DB, dz: DzArtist, country: string | null): Promise<number> {
  const artistId = await findOrCreateArtist(db, dz, country);
  const albums = (await artistAlbums(dz.id)).filter(a => a.recordType !== 'compilation'); // skip VA comps
  const seenKey = new Set<string>();
  let groups = 0;
  for (const al of albums) {
    const key = releaseGroupKey(al.title);
    if (seenKey.has(key)) continue;        // collapse editions within this artist
    seenKey.add(key);
    const detail = await albumWithTracks(al.id, true);
    if (!detail || detail.tracks.length === 0) continue;

    const rgId = randomUUID();
    const date = (detail.releaseDate || al.releaseDate || '')?.slice(0, 10) || null;
    const genre = mapGenre(detail.genre ?? '') || null;
    const native = detectLanguage(al.title) ? al.title : null;
    const { error: rgErr } = await db.from('release_groups').insert({
      id: rgId, primary_artist_id: artistId, artist_display: dz.name, title: al.title,
      release_group_type: ['album', 'ep', 'single'].includes(al.recordType) ? al.recordType : 'album',
      first_release_date: date, cover_url: detail.cover || al.cover || null,
      genres: genre ? [genre] : null, native_title: native, source: 'deezer',
    });
    if (rgErr) throw new Error(`release_group "${al.title}": ${rgErr.message}`);

    const relId = randomUUID();
    const { error: relErr } = await db.from('releases').insert({
      id: relId, release_group_id: rgId, is_canonical: true, region: country,
      title: al.title, artist: dz.name, release_date: date,
      release_type: al.recordType, cover_url: detail.cover || al.cover || null,
      total_tracks: detail.tracks.length, source: 'deezer', cached_at: now(),
    });
    if (relErr) throw new Error(`release "${al.title}": ${relErr.message}`);

    const recs = detail.tracks.map(t => ({
      id: randomUUID(), primary_artist_id: artistId, artist_display: t.artists || dz.name,
      title: t.title, isrc: t.isrc, duration_ms: t.durationMs, source: 'deezer',
    }));
    const { error: recErr } = await db.from('recordings').insert(recs);
    if (recErr) throw new Error(`recordings "${al.title}": ${recErr.message}`);
    const rts = detail.tracks.map((t, i) => ({ release_id: relId, recording_id: recs[i].id, position: t.position, disc_number: t.discNumber }));
    const { error: rtErr } = await db.from('release_tracks').insert(rts);
    if (rtErr) throw new Error(`release_tracks "${al.title}": ${rtErr.message}`);
    groups++;
  }
  return groups;
}

export interface DeezerFallbackResult { processed: number; matched: number; ingested: number; skippedGeneric: number; noMatch: number }

/**
 * Process up to `limit` MB-skipped queue rows through the Deezer fallback. Exported so both
 * the CLI and the pipeline's (gated) DEEZER lane call the same path. `write=false` = dry-run.
 */
export async function runDeezerFallback(db: DB, opts: { limit?: number; write?: boolean; log?: (m: string) => void } = {}): Promise<DeezerFallbackResult> {
  const limit = opts.limit ?? 10, write = opts.write ?? false, log = opts.log ?? (() => {});
  const { data: rows } = await db.from('artist_ingestion_queue')
    .select('id, name, source, source_id, attempt_count').eq('status', 'skipped').order('created_at').limit(limit * 4);
  const res: DeezerFallbackResult = { processed: 0, matched: 0, ingested: 0, skippedGeneric: 0, noMatch: 0 };
  const bump = (r: any) => db.from('artist_ingestion_queue').update({ attempt_count: (r.attempt_count ?? 0) + 1 }).eq('id', r.id);

  for (const r of rows ?? []) {
    if (res.processed >= limit) break;
    if (isGeneric(normalizeStr((r as any).name))) { res.skippedGeneric++; continue; } // → mb-overrides, not Deezer
    if (((r as any).attempt_count ?? 0) >= MAX_ATTEMPTS) continue;
    res.processed++;

    const hit = pickArtist(await searchArtists((r as any).name), (r as any).name);
    if (!hit) {
      res.noMatch++; log(`  ✗ ${(r as any).name.padEnd(26)} no exact Deezer match`);
      if (write) await bump(r);
      continue;
    }
    res.matched++;
    const country = regionHint((r as any).source, (r as any).source_id);
    log(`  ✓ ${(r as any).name.padEnd(26)} → Deezer ${hit.id} "${hit.name}" (${hit.nbFan} fans, ${hit.nbAlbum} albums)${country ? ` [${country}]` : ''}`);
    if (write) {
      try {
        const g = await ingestArtist(db, hit, country);
        await db.from('artist_ingestion_queue').update({ status: 'done', processed_at: now(), error: 'deezer-fallback', releases_added: g }).eq('id', (r as any).id);
        res.ingested += g; log(`      ingested ${g} groups`);
      } catch (e) { log(`      ERROR: ${(e as Error).message}`); await bump(r); }
    }
  }
  return res;
}

async function main() {
  const db = getDB();
  console.log(`\n  deezer-fallback ${WRITE ? '[WRITE]' : '[dry-run]'} — up to ${LIMIT} skipped rows\n`);
  const r = await runDeezerFallback(db, { limit: LIMIT, write: WRITE, log: m => console.log(m) });
  console.log(`\n  processed ${r.processed} · matched ${r.matched} · ingested ${r.ingested} groups · generic→overrides ${r.skippedGeneric} · no-match ${r.noMatch}`);
  console.log(WRITE ? '' : '  [dry-run] no writes — re-run with --write.\n');
}

if (process.argv[1] && process.argv[1].endsWith('mb-deezer-fallback.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
