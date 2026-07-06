/**
 * Fix systematic native_language mis-tags (2026-07-05).
 *
 * The OLD backfill-native-names.ts (Wikipedia ko/ja langlinks, run before name_phonetic_ko existed)
 * wrote the Korean/Japanese PHONETIC rendering of NON-native artists into name_native and set
 * native_language='ko'/'ja'. So Taylor Swift (US) ended up native_language='ko',
 * name_native='테일러 스위프트' — polluting native-name display, search, and (here) the bot pools.
 *
 * Safe signal: country. A native_language='ko' artist whose country is set and ≠ 'KR' (or 'ja' ≠ 'JP')
 * is a mis-tag. Fix:
 *   • ko mis-tags: the name_native IS the Korean phonetic → move it to name_phonetic_ko (where it
 *     belongs, and restores the phonetic search they were wrongly excluded from), then null
 *     name_native + native_language.
 *   • ja mis-tags: name_native is a Japanese phonetic (no Korean value) → just null name_native +
 *     native_language (their Korean phonetic, if any, already lives in name_phonetic_ko).
 *
 * Conservative: leaves null-country rows untouched (can't tell legit-Korean-missing-country from a
 * mis-tag). Idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/fix-native-language-mistags.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/fix-native-language-mistags.ts --apply
 */
import { getDB } from './itunes-ingest-core';
const db = getDB();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`\n  native_language mis-tag fix${APPLY ? '' : '  [DRY RUN]'}\n`);
  let fixedKo = 0, fixedJa = 0;
  for (const [lang, home] of [['ko', 'KR'], ['ja', 'JP']] as const) {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('artists').select('id, name, country, name_native, name_phonetic_ko')
        .eq('native_language', lang).not('country', 'is', null).neq('country', home).order('id').range(from, from + 999);
      if (!data?.length) break;
      rows.push(...data); if (data.length < 1000) break;
    }
    console.log(`  ${lang}: ${rows.length} foreign-country mis-tags`);
    for (const a of rows) {
      const patch: any = { name_native: null, native_language: null };
      if (lang === 'ko' && !a.name_phonetic_ko && a.name_native) patch.name_phonetic_ko = a.name_native;
      if (APPLY) { const { error } = await db.from('artists').update(patch).eq('id', a.id); if (error) { console.warn(`  ! ${a.name}: ${error.message}`); continue; } }
      if (lang === 'ko') fixedKo++; else fixedJa++;
    }
    console.log('   samples:', rows.slice(0, 10).map(r => `${r.name}(${r.country})`).join(', '));
  }
  console.log(`\n  ${APPLY ? 'FIXED' : 'WOULD FIX'} — ko ${fixedKo}, ja ${fixedJa}, total ${fixedKo + fixedJa}\n`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
