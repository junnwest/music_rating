/**
 * Discography GAP audit — finds releases an artist we already hold is missing, and ingests them.
 *
 * THE HOLE THIS FILLS. GAPFILL (mb-gapfill.ts) is append-only into EMPTY FIELDS: a null cover, an
 * empty tracklist, an artist MusicBrainz skipped. None of that notices an artist whose row is
 * perfectly healthy but whose discography is short. Reported case: 와비사비룸 was seeded from Deezer,
 * which lists 2 releases; iTunes has 3, so the EP "Secret Collage" / "비밀꼴라쥬" simply never existed
 * here, and no lane would ever have added it — seed-deezer-artist reads Deezer and stops.
 *
 * IDENTITY IS THE WHOLE RISK, so this only looks at artists with a RECORDED iTunes id in
 * artist_external_ids (2,280 of them today, and the number grows every time the stub writer links
 * one). No name-guessing: a name lookup is what produced shadow artists before, which is why
 * GAPFILL_RECOVER_ARTISTS is still off by default in the pipeline.
 *
 * WHAT COUNTS AS MISSING is deliberately strict, because a false positive here writes a junk album:
 *   - normalized title must match nothing we already hold for that artist, comparing against BOTH
 *     title and native_title (an album held only in Korean must not be re-added in English, which
 *     is exactly the cross-language duplicate class that cost 486 rows to clean up)
 *   - the iTunes release must carry a track count and a date
 *   - compilations are skipped: they re-package tracks we already have and inflate the catalogue
 *
 * The write goes through ingest-stub-itunes' report format rather than a private insert path, so
 * everything lands with the same provenance, collision guards and cover handling as the audited
 * bulk writer. This script emits that report; --apply then runs it.
 *
 * REPORT-ONLY unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/audit-discography-gaps.ts --limit 50
 *   npx tsx --env-file=.env.local scripts/audit-discography-gaps.ts --limit 50 --apply
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDB, normalizeStr } from './itunes-ingest-core';
import { fetchDiscography } from './itunes-client';

const argv = process.argv.slice(2);
const arg = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '50')!, 10);
const APPLY = argv.includes('--apply');
const REPORT = arg('--report', 'scripts/data/discography-gaps.json')!;

const db = getDB();

interface Linked { artist_id: string; external_id: string }

function typeOf(a: { collectionType?: string | null; trackCount?: number | null }): string {
  const n = a.trackCount ?? 0;
  if (n <= 3) return 'single';
  if (n <= 7) return 'ep';
  return 'album';
}

async function main() {
  console.log(`\n  discography gaps — up to ${LIMIT} linked artist(s)${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  // --artist <uuid> points the audit at one artist, for a reported gap rather than a sweep.
  const ONLY = arg('--artist');
  let q = db.from('artist_external_ids').select('artist_id, external_id').eq('source', 'itunes');
  if (ONLY) q = q.eq('artist_id', ONLY);
  const { data: links, error } = await q.limit(ONLY ? 1 : LIMIT);
  if (error) { console.error('DB error:', error.message); process.exit(1); }

  const rows: unknown[] = [];
  let checked = 0, withGaps = 0, missingTotal = 0;

  for (const l of (links ?? []) as Linked[] ) {
    const { data: art } = await db.from('artists').select('id, name').eq('id', l.artist_id).maybeSingle();
    if (!art) continue;
    const { data: held } = await db.from('release_groups')
      .select('title, native_title').eq('primary_artist_id', l.artist_id);
    const have = new Set<string>();
    for (const h of (held ?? []) as { title: string | null; native_title: string | null }[]) {
      if (h.title) have.add(normalizeStr(h.title));
      if (h.native_title) have.add(normalizeStr(h.native_title));
    }

    let disco: Awaited<ReturnType<typeof fetchDiscography>> = [];
    try { disco = await fetchDiscography(Number(l.external_id)); } catch { continue; }
    checked++;

    const missing = disco.filter((a: any) => {
      if (!a.collectionName || !a.releaseDate || !a.trackCount) return false;
      if ((a.collectionType ?? '') === 'Compilation') return false;
      // THE RELEASE MUST BE THEIRS, not one they guest on. iTunes' artist lookup returns everything
      // the artist is credited on, so an unfiltered diff proposes features and OST parts as missing
      // albums: a first run suggested "Whatever (feat. ...)" and "Hometown Cha-Cha-Cha, Pt. 1 (OST)"
      // among 103 "gaps" across 12 artists. Those belong to the other artist's collection id, so
      // requiring the collection's own artistId to match drops them and keeps genuine own-releases
      // like Wavisabiroom's "Secret Collage". Without this the tool would manufacture precisely the
      // credit-stub noise the catalogue already carries ~38,800 of.
      if (Number(a.artistId) !== Number(l.external_id)) return false;
      const clean = String(a.collectionName).replace(/\s*-\s*(EP|Single)$/i, '');
      return !have.has(normalizeStr(clean));
    });
    if (!missing.length) continue;
    withGaps++; missingTotal += missing.length;

    console.log(`  ${art.name}  — ${missing.length} missing of ${disco.length} on iTunes`);
    for (const m of missing.slice(0, 6)) console.log(`      + ${String(m.releaseDate).slice(0, 10)}  ${m.collectionName}  (${m.trackCount} tracks)`);

    rows.push({
      id: l.artist_id,
      name: art.name,
      verdict: 'CORROBORATED',           // identity is the stored iTunes link, not a name guess
      itunesArtistId: Number(l.external_id),
      itunesArtistName: art.name,
      store: 'us',
      newAlbums: missing.map((m: any) => ({
        collectionId: m.collectionId,
        title: String(m.collectionName).replace(/\s*-\s*(EP|Single)$/i, ''),
        displayTitle: String(m.collectionName).replace(/\s*-\s*(EP|Single)$/i, ''),
        date: String(m.releaseDate).slice(0, 10),
        trackCount: m.trackCount,
        type: typeOf(m),
        primary: true,
        creditedAs: art.name,
        artworkUrl: m.artworkUrl100 ? String(m.artworkUrl100).replace('100x100bb', '600x600bb') : null,
        flags: [],
        collides: null,
      })),
    });
  }

  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  linked artists checked: ${checked}`);
  console.log(`  with gaps:              ${withGaps}`);
  console.log(`  releases missing:       ${missingTotal}`);

  try { mkdirSync(REPORT.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  writeFileSync(REPORT, JSON.stringify(rows, null, 1));
  console.log(`  report -> ${REPORT}`);

  if (!APPLY) { console.log('  (report only - re-run with --apply to ingest the missing releases)'); return; }
  if (!rows.length) { console.log('  nothing to apply'); return; }

  console.log('\n  applying via ingest-stub-itunes (same writer, guards and provenance as the bulk pass)...');
  const out = execFileSync('npx', ['tsx', '--env-file=.env.local', 'scripts/ingest-stub-itunes.ts', `--report=${REPORT}`, '--limit=100000', '--write'], { encoding: 'utf8' });
  console.log(out.split('\n').slice(-8).join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
