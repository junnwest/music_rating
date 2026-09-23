/**
 * Set native_language='ko' for Korean artists the tag never reached (2026-09-22).
 *
 * THE BUG. native_language is derived from name_native: an artist is tagged 'ko' only when their
 * name_native holds Hangul. The counts line up exactly -- 9,116 artists have Hangul in name_native
 * and 9,116 are tagged 'ko'. But a large part of the Korean scene styles its name in Latin script
 * (C Jamm, YANGHONGWON, Owen Ovadoz, JUSTHIS), so name_native is empty or Latin and the tag never
 * lands, even though every release they put out is Korean.
 *
 * WHY THAT MATTERS. native_language is not read by the app at all -- it is purely the targeting
 * field for the Korean backfills (backfill-native-titles-deezer, backfill-rg-covers-kr,
 * backfill-phonetic-ko, discover-itunes-backfill and others), every one of which filters
 * .eq('native_language','ko'). An untagged Korean artist is therefore invisible to all of them,
 * permanently. Reported from the app as "Keung - CJAMM: it appears as 'Keung' even when language is
 * set as Korean. it should show the original Korean title '킁'" -- C Jamm is untagged, so the native
 * title backfill never looked at him. 957 artists release Korean-titled material while untagged,
 * against 1,416 tagged: roughly 40% of the Korean artist population was being skipped.
 *
 * THE GUARD, AND WHY IT IS COUNTRY. The opposite error has already been made once here: the old
 * backfill-native-names.ts inferred language from Wikipedia langlinks and tagged Taylor Swift
 * native_language='ko' off a phonetic rendering, which polluted native-name display, search and the
 * bot pools until fix-native-language-mistags.ts undid it. That fix established the safe signal --
 * country -- and this script uses the same one rather than re-deriving it:
 *
 *   country = 'KR'  AND  at least one release group with Hangul in its title or native_title
 *
 * Both halves are required. Country alone would sweep in Korean-registered foreign acts; Korean
 * titles alone would sweep in foreign artists who appear on one Korean collaboration, which is
 * exactly what the measurement shows -- of the 957 untagged artists with Korean-titled releases,
 * 779 are KR, 165 have no country at all, and 13 are JP/US/GB/AU/DE/SU. The 13 are the false
 * positives the gate exists to reject. The 165 null-country rows are LEFT ALONE, the same call
 * fix-native-language-mistags.ts made: "no country" cannot be told apart from "legitimately Korean,
 * country missing", and guessing is how the last mess started.
 *
 * This writes ONLY native_language. It never touches name_native -- inventing a Hangul name is what
 * went wrong in 2026-07-05, and a Latin-styled artist's name genuinely is Latin.
 *
 * REPORT-ONLY unless --apply. Idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/fix-native-language-korean-gaps.ts
 *   npx tsx --env-file=.env.local scripts/fix-native-language-korean-gaps.ts --apply
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const OUT = arg('--out') ?? 'scripts/data/native-language-korean-gaps.json';

interface Cand { id: string; name: string; country: string; ko_rgs: number; total_rgs: number; sample: string[] }

async function main() {
  const db = getDB();

  // One SQL pass: the untagged KR artists carrying Korean-script release groups, with a few of those
  // titles carried along so the report is auditable by eye rather than on trust.
  const sql = `
    select a.id::text, a.name, a.country,
           count(*) filter (where rg.native_title ~ '[가-힣]' or rg.title ~ '[가-힣]') as ko_rgs,
           count(*) as total_rgs,
           (array_agg(coalesce(rg.native_title, rg.title)
                      order by rg.first_release_date desc nulls last)
            filter (where rg.native_title ~ '[가-힣]' or rg.title ~ '[가-힣]'))[1:3] as sample
      from artists a
      join release_groups rg on rg.primary_artist_id = a.id
     where a.native_language is null
       and a.country = 'KR'
     group by 1,2,3
    having count(*) filter (where rg.native_title ~ '[가-힣]' or rg.title ~ '[가-힣]') > 0
     order by ko_rgs desc`;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const cands = (await res.json()) as Cand[];

  const rgTotal = cands.reduce((n, c) => n + Number(c.total_rgs), 0);
  console.log(`[native-lang] ${cands.length} untagged KR artist(s), ${rgTotal} release group(s) behind them` +
              `${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  fs.mkdirSync('scripts/data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cands, null, 2));

  console.log('\nsample (most Korean-titled releases first):');
  for (const c of cands.slice(0, 15)) {
    console.log(`  ${c.name.padEnd(28)} ${String(c.ko_rgs).padStart(3)}/${String(c.total_rgs).padEnd(4)} ko  ${(c.sample ?? []).join(' · ')}`);
  }

  if (APPLY) {
    let tagged = 0;
    const ids = cands.map(c => c.id);
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const { error } = await db.from('artists').update({ native_language: 'ko' }).in('id', slice);
      if (error) console.warn(`  ! batch ${i}: ${error.message}`); else tagged += slice.length;
    }
    console.log(`\n  TAGGED ${tagged} artist(s) native_language='ko'`);
    console.log('  re-run the Korean backfills to pick them up:');
    console.log('    backfill-native-titles-deezer.ts · backfill-rg-covers-kr.ts · backfill-phonetic-ko.ts');
  } else {
    console.log(`\n  report → ${OUT}`);
    console.log('  report only — re-run with --apply to tag');
  }
}

if (process.argv[1] && process.argv[1].endsWith('fix-native-language-korean-gaps.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
