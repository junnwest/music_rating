/**
 * Backfills the real `country` field for both holdout batches (original 30 +
 * extra 20). The pick-holdout scripts only selected release_groups columns
 * and never joined to artists.country the way build-suitability-pool.ts
 * does, so every holdout item's country silently defaulted to null. That
 * broke Path A's `is_korea` gate for real Korean acts (idol groups included)
 * in the suitability model.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-holdout-country.ts
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars.'); process.exit(1); }
const db = createClient(url, key);

async function findCountryByArtistName(artistName: string): Promise<string | null> {
  const { data, error } = await db
    .from('release_groups')
    .select('primary_artist_id, artist_display')
    .eq('artist_display', artistName)
    .not('primary_artist_id', 'is', null)
    .limit(1);
  if (error || !data?.length) return null;
  const artistId = data[0].primary_artist_id;
  const { data: artistRow, error: artErr } = await db
    .from('artists')
    .select('country')
    .eq('id', artistId)
    .maybeSingle();
  if (artErr || !artistRow) return null;
  return artistRow.country ?? null;
}

async function main() {
  const holdout30: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const holdout20: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-extra20.json', 'utf8'));

  const allArtists = [...new Set([...holdout30.map((h) => h.artist), ...holdout20.map((h) => h.artist)])];
  console.log(`Looking up country for ${allArtists.length} unique artists...`);

  const countryByArtist: Record<string, string | null> = {};
  for (const artist of allArtists) {
    const country = await findCountryByArtistName(artist);
    countryByArtist[artist] = country;
    console.log(`${artist} -> ${country ?? 'null'}`);
  }

  fs.writeFileSync('scripts/output/holdout-country.json', JSON.stringify(countryByArtist, null, 2));
  const resolved = Object.values(countryByArtist).filter(Boolean).length;
  console.log(`\nResolved ${resolved}/${allArtists.length} artist countries.`);
  console.log('Wrote scripts/output/holdout-country.json');
}

main();
