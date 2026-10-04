/**
 * Promote a Hangul alias we ALREADY HOLD to the artist's display name.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-names-from-aliases.ts
 *   npx tsx --env-file=.env.local scripts/backfill-native-names-from-aliases.ts --apply
 *
 * FOUND BY ACCIDENT, WHICH IS WHY IT IS WORTH READING. Chasing Korean names through the iTunes KR
 * storefront turned up "Country Kkokko" and wrote 컨츄리 꼬꼬 — and the alias insert came back a
 * duplicate, because MusicBrainz had supplied that exact alias long ago. The artist was already
 * SEARCHABLE in Korean and had been the whole time. What was missing was the DISPLAY name.
 *
 * That asymmetry is systemic, not a one-off: backfill-native-aliases-mb.ts writes `artist_aliases`
 * (which the search RPC reads) and never touches `artists.name_native` (which the UI shows). So a
 * Korean user could find these acts by typing Hangul and would then be shown a romanization.
 *
 * THE NUMBERS. 1,645 of the 5,879 KR artists with no `name_native` already have a Hangul alias
 * sitting in our own database. That is roughly nineteen times what the iTunes KR storefront yields
 * (~87, measured at 8% in audit-itunes-kr-storefront.ts) and it costs no API calls at all — the data
 * never had to be fetched, only used.
 *
 * WHICH ALIAS WINS: `primary_for_locale` first (set on 9,465 of 13,158 Hangul aliases, so it is a real
 * signal rather than a default), then MusicBrainz over other sources, then the longest string — among
 * 컨츄리 꼬꼬 and 컨츄리꼬꼬 the spaced form is the conventional rendering, and length is the cheap
 * proxy for it.
 *
 * ONLY FILLS NULLS. An existing `name_native` from any source is left alone; this adds a display name
 * where there is none, it does not arbitrate between sources.
 *
 * Report-only unless --apply.
 */
import { getDB } from './itunes-ingest-core';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '5000'), 10);
const COUNTRY = arg('--country', 'KR');

const db = getDB();

interface Candidate { artist_id: string; name: string; alias: string; source: string; primary_for_locale: boolean }

async function main() {
  console.log(`\n  native name from existing aliases — ${COUNTRY}${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  const HANGUL = /[가-힣]/;
  // PostgREST caps a response at 1,000 rows, so this pages. The first version did not and silently
  // measured only the first page - 204 of the real 1,432.
  const rows: any[] = [];
  for (let from = 0; from < LIMIT; from += 1000) {
    const { data, error: e } = await db
      .from('artists')
      .select('id, name, country, name_native, artist_aliases(alias, source, primary_for_locale)')
      .eq('country', COUNTRY)
      .is('name_native', null)
      .range(from, Math.min(from + 999, LIMIT - 1));
    if (e) { console.error('DB error:', e.message); process.exit(1); }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const picks: Candidate[] = [];
  for (const a of rows) {
    // ONLY ROMANIZED NAMES. An artist already held as 잔나비 gains nothing from name_native = 잔나비;
    // the first run proposed 204 such no-ops. The case worth fixing is "Country Kkokko" -> 컨츄리 꼬꼬,
    // where the display name is a romanization and the Hangul is sitting unused in artist_aliases.
    if (HANGUL.test(a.name ?? '')) continue;
    /* PRIMARY-FOR-LOCALE IS NOT A TIEBREAK HERE, IT IS THE WHOLE GUARD. MusicBrainz distinguishes an
       artist's name from their LEGAL name, and we do not store that distinction - artist_aliases has
       no type column. Without this filter the run proposed SUHO -> 김준면 and JIN -> 박명은, which are
       the performers' real names, not the Korean form of their stage names: it would have replaced a
       stage name with a legal one across the app. The flag encodes exactly the needed claim ("this is
       the name in this locale") - SUHO's Hangul alias is primary_for_locale false, 잔나비's is true. */
    const aliases = (a.artist_aliases ?? []).filter((x: any) => HANGUL.test(x.alias ?? '') && x.primary_for_locale === true);
    if (!aliases.length) continue;
    aliases.sort((x: any, y: any) =>
      Number(y.primary_for_locale) - Number(x.primary_for_locale)
      || Number(y.source === 'musicbrainz') - Number(x.source === 'musicbrainz')
      || (y.alias as string).length - (x.alias as string).length
      || (x.alias as string).localeCompare(y.alias));
    picks.push({ artist_id: a.id, name: a.name, alias: aliases[0].alias, source: aliases[0].source, primary_for_locale: !!aliases[0].primary_for_locale });
  }

  console.log(`  ${picks.length} artist(s) can take a display name from an alias they already have\n`);
  for (const p of picks.slice(0, 20)) console.log(`      ${p.name}  ->  ${p.alias}   [${p.source}${p.primary_for_locale ? ', primary' : ''}]`);

  if (!APPLY) { console.log('\n  (report only — re-run with --apply to write)'); return; }

  let written = 0, failed = 0;
  for (const p of picks) {
    const { error: e } = await db.from('artists')
      .update({ name_native: p.alias }).eq('id', p.artist_id).is('name_native', null);
    if (e) { failed++; if (failed <= 5) console.warn(`  ! ${p.name}: ${e.message}`); } else written++;
    if (written % 200 === 0 && written) console.log(`    ${written}/${picks.length}`);
  }
  console.log(`\n  name_native set on ${written} artist(s)${failed ? `, ${failed} failed` : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
