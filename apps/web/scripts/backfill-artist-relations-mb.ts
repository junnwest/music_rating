/**
 * Link an artist's personas and groups, so their page shows the work they are actually known for.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artist-relations-mb.ts --artist "MF DOOM"
 *   npx tsx --env-file=.env.local scripts/backfill-artist-relations-mb.ts --artist "MF DOOM" --apply
 *   npx tsx --env-file=.env.local scripts/backfill-artist-relations-mb.ts --limit 50 --apply
 *
 * THE PROBLEM IT SOLVES. Our MF DOOM page listed 74 releases and omitted Madvillainy, Vaudeville
 * Villain, Take Me to Your Leader, The Mouse and the Mask and Key to the Kuffs — most of what he is
 * known for — because each is credited to a separate artist row (Madvillain, Viktor Vaughn, King
 * Geedorah, DANGERDOOM, JJ DOOM) with nothing joining them. Spotify and YouTube Music link personas;
 * we never imported MusicBrainz's artist-artist relationships, so each one was an island.
 *
 * TWO HOPS, WHICH IS THE WHOLE REASON THIS IS A SCRIPT AND NOT A ONE-LINER. MB does not relate
 * MF DOOM to Viktor Vaughn. It relates both to the HUMAN:
 *     MF DOOM        --is person-->  Daniel Dumile
 *     Viktor Vaughn  --is person-->  Daniel Dumile
 *     MF DOOM        --member of band-->  Madvillain, DANGERDOOM, JJ DOOM, NehruvianDOOM…
 * So sibling personas are only reachable by going out to the person and back. This resolves that
 * closure (2 MB calls per artist: the artist, then the person) and stores FLAT symmetric pairs, so
 * the read path in get_artist_release_groups stays a single hop.
 *
 * WHAT IT WILL NOT DO. It only links artists ALREADY in our catalogue — artist_relations has FKs
 * both ways, and inventing rows for artists we have never ingested would create referential
 * garbage. NehruvianDOOM and Metal Fingers are absent today, so DOOM gains nothing from those two
 * until they are ingested; re-running later picks them up. Unlinked targets are reported.
 *
 * RELATION TYPES KEPT, and why only these:
 *   'is person'      -> 'persona'  both directions. Same human, other name: their work is his work.
 *   'member of band' -> 'group'    member -> group. Madvillainy IS DOOM's record.
 * Deliberately ignored: 'collaboration' (a one-off feature is not a discography), 'named after
 * artist' (Metal Face Terrorists are not DOOM), 'tribute', 'supporting musician'. Each of those
 * would pull in records a listener would not expect on the page.
 *
 * ONE MUSICBRAINZ LANE AT A TIME. mbGet paces itself at 1.1s, but the pipeline's ingest lane is
 * also on the MB API and two concurrent lanes get the whole app throttled. Stop the pipeline (or
 * run this while it is down) rather than racing it.
 *
 * Report-only unless --apply.
 */
import { getArtist } from './mb-client';
import { getDB } from './mb-ingest';

const argv = process.argv.slice(2);
const arg = (f: string, d = '') => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const ONLY_ARTIST = arg('--artist');
const LIMIT = parseInt(arg('--limit', '25'), 10);

const db = getDB();

type Pair = { artist_id: string; related_artist_id: string; relation_type: 'persona' | 'group' };

/** Our artist id for an MBID, or null when we have never ingested them. */
async function ourArtist(mbid: string): Promise<{ id: string; name: string } | null> {
  const { data } = await db.from('artist_external_ids')
    .select('artist_id, artists!inner(id, name)')
    .eq('source', 'musicbrainz').eq('external_id', mbid).limit(1);
  const row = (data ?? [])[0] as any;
  return row ? { id: row.artists.id, name: row.artists.name } : null;
}

async function main() {
  console.log(`\n  MB artist relations → personas & groups${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  let targets: { id: string; name: string; mbid: string }[] = [];
  if (ONLY_ARTIST) {
    const { data } = await db.from('artists')
      .select('id, name, artist_external_ids!inner(source, external_id)')
      .eq('name', ONLY_ARTIST).limit(1);
    for (const a of (data ?? []) as any[]) {
      const mb = (a.artist_external_ids ?? []).find((e: any) => e.source === 'musicbrainz');
      if (mb) targets.push({ id: a.id, name: a.name, mbid: mb.external_id });
    }
  } else {
    // Highest-prestige artists first: aliases matter most where someone will actually look.
    const { data } = await db.from('artists')
      .select('id, name, prestige_score, artist_external_ids!inner(source, external_id)')
      .order('prestige_score', { ascending: false, nullsFirst: false })
      .limit(LIMIT * 3);
    for (const a of (data ?? []) as any[]) {
      const mb = (a.artist_external_ids ?? []).find((e: any) => e.source === 'musicbrainz');
      if (mb) targets.push({ id: a.id, name: a.name, mbid: mb.external_id });
      if (targets.length >= LIMIT) break;
    }
  }
  if (!targets.length) { console.log('  no targets with a MusicBrainz id'); return; }
  console.log(`  ${targets.length} artist(s) to resolve\n`);

  let written = 0, unlinked = 0, checked = 0;
  for (const t of targets) {
    const detail = await getArtist(t.mbid);
    checked++;
    if (!detail) { console.log(`  ${t.name}: MB lookup failed`); continue; }

    const pairs: Pair[] = [];
    const missing: string[] = [];

    // member of band -> 'group' (directional: t is a member of the group)
    for (const r of detail.relations.filter(r => r.type === 'member of band')) {
      const other = await ourArtist(r.artistId);
      if (!other) { missing.push(`${r.artistName} [group]`); continue; }
      pairs.push({ artist_id: t.id, related_artist_id: other.id, relation_type: 'group' });
    }

    // is person -> the human; their OTHER personas are siblings of t. Second hop.
    for (const person of detail.relations.filter(r => r.type === 'is person')) {
      const personDetail = await getArtist(person.artistId);
      if (!personDetail) continue;
      for (const sib of personDetail.relations.filter(r => r.type === 'is person')) {
        if (sib.artistId === t.mbid) continue;                 // that is us
        const other = await ourArtist(sib.artistId);
        if (!other) { missing.push(`${sib.artistName} [persona]`); continue; }
        // Symmetric: either page should show the other's work.
        pairs.push({ artist_id: t.id, related_artist_id: other.id, relation_type: 'persona' });
        pairs.push({ artist_id: other.id, related_artist_id: t.id, relation_type: 'persona' });
      }
    }

    const uniq = [...new Map(pairs.map(p => [`${p.artist_id}|${p.related_artist_id}|${p.relation_type}`, p])).values()];
    unlinked += missing.length;
    console.log(`  ${t.name}: ${uniq.length} link(s)${missing.length ? `, ${missing.length} not in catalogue (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''})` : ''}`);

    if (!APPLY || !uniq.length) continue;
    const { error } = await db.from('artist_relations').upsert(uniq, {
      onConflict: 'artist_id,related_artist_id,relation_type', ignoreDuplicates: true,
    });
    if (error) console.warn(`    ! ${t.name}: ${error.message}`);
    else written += uniq.length;
  }

  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  artists checked:        ${checked}`);
  console.log(`  links ${APPLY ? 'written' : 'proposed'}:        ${APPLY ? written : 'see above'}`);
  console.log(`  related but not in our catalogue: ${unlinked}`);
  if (!APPLY) console.log('  (report only — re-run with --apply to write)');
}

main().catch(e => { console.error(e); process.exit(1); });
