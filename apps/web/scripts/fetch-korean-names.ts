/**
 * Looks up real Korean native names + country for every item in the 500-item
 * suitability pool and the 30 holdout albums, needed as query input for the
 * Korean Wikipedia resolver (ko.wikipedia.org search doesn't work well off
 * English romanizations for most Korean artists/albums).
 *
 * Artist items: join by exact name to `artists` (name_native, native_language,
 * country). Album items (both pool albums and all 30 holdout albums, which
 * had no country lookup at all): join release_groups -> artists via
 * title+artist_display to get native_title and the artist's country/native name.
 *
 * Output: scripts/output/korean-names.json — one entry per item id, with
 * whatever real Korean-language names were found (null where none exist).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fetch-korean-names.ts
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars.'); process.exit(1); }
const db = createClient(url, key);

interface PoolItem {
  id: string; type: 'artist' | 'album'; name: string; title?: string; artist?: string; country?: string | null;
}

async function main() {
  const pool: PoolItem[] = JSON.parse(fs.readFileSync('scripts/output/suitability-pool.json', 'utf8'));
  const holdout: PoolItem[] = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const items = [...pool, ...holdout.map((h) => ({ ...h, id: 'holdout-' + h.id }))];

  const artistNames = [...new Set(items.map((i) => (i.type === 'artist' ? i.name : i.artist!)))];
  const artistByName = new Map<string, { name_native: string | null; native_language: string | null; country: string | null }>();
  const CHUNK = 100;
  for (let i = 0; i < artistNames.length; i += CHUNK) {
    const chunk = artistNames.slice(i, i + CHUNK);
    const { data, error } = await db.from('artists').select('name, name_native, native_language, country').in('name', chunk);
    if (error) { console.error(error.message); continue; }
    for (const r of data ?? []) if (!artistByName.has(r.name)) artistByName.set(r.name, r);
  }

  const albumItems = items.filter((i) => i.type === 'album');
  const albumNativeByKey = new Map<string, string | null>();
  for (const a of albumItems) {
    const { data, error } = await db
      .from('release_groups')
      .select('native_title')
      .eq('title', a.title!)
      .eq('artist_display', a.artist!)
      .limit(1);
    if (!error && data && data[0]) albumNativeByKey.set(`${a.title}::${a.artist}`, data[0].native_title);
    await new Promise((r) => setTimeout(r, 30));
  }

  const out = items.map((item) => {
    const artistName = item.type === 'artist' ? item.name : item.artist!;
    const artistInfo = artistByName.get(artistName);
    const albumNative = item.type === 'album' ? albumNativeByKey.get(`${item.title}::${item.artist}`) ?? null : null;
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      country: artistInfo?.country ?? item.country ?? null,
      artistNameNative: artistInfo?.native_language === 'ko' ? artistInfo.name_native : null,
      albumNativeTitle: item.type === 'album' ? albumNative : null,
    };
  });

  const outPath = path.resolve('scripts/output/korean-names.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const withArtistNative = out.filter((o) => o.artistNameNative).length;
  const krCountry = out.filter((o) => o.country === 'KR').length;
  console.log(`${out.length} items | country=KR: ${krCountry} | with Korean artist name: ${withArtistNative}`);
  console.log(`Wrote ${outPath}`);
}

main();
