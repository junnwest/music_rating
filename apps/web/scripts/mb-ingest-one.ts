/**
 * Ingest a single MB artist (testing + manual gap-fill).
 *   npx tsx --env-file=.env.local scripts/mb-ingest-one.ts --name="Se So Neon" --region=KR
 *   npx tsx --env-file=.env.local scripts/mb-ingest-one.ts --mbid=<MBID>
 */
import { getDB, resolveArtist, ingestArtist } from './mb-ingest';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const name = arg('--name');
const mbidArg = arg('--mbid');
const region = arg('--region') ?? null;

async function main() {
  if (!name && !mbidArg) {
    console.error('Usage: --name="Artist" [--region=KR]  |  --mbid=<MBID>');
    process.exit(1);
  }
  const db = getDB();

  let mbid = mbidArg;
  if (!mbid) {
    const r = await resolveArtist(name!, region);
    if (!r.best) {
      console.log(`No confident MB match for "${name}"${r.needsReview ? ' (needs review)' : ''}.`);
      process.exit(0);
    }
    console.log(`Resolved "${name}" → ${r.best.name}${r.best.disambiguation ? ` (${r.best.disambiguation})` : ''} [${r.best.id}]${r.ambiguous ? ' — AMBIGUOUS' : ''}`);
    mbid = r.best.id;
  }

  console.log('Ingesting from MusicBrainz…');
  const res = await ingestArtist(db, mbid!);
  console.log(`\n  artist ${res.artistId} (${res.isNew ? 'new' : 'existing'}) → ${res.rgCount} release-groups, ${res.recCount} recordings\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
