/**
 * Recover native-script (Hangul / kana) aliases from MusicBrainz for artists we hold only under a
 * Latin name.
 *
 * THE PROBLEM (CATALOG_GAP_REPORT.md cause 4). 4,266 of 6,567 Latin-named Korean artists have no
 * Hangul name or alias anywhere in our data, and 609 of 946 Japanese artists have no kana. The
 * search RPC already reads `artist_aliases`, so this is the reason a Korean user searching 양홍원,
 * 씨잼, 수란, 재지팩트, 로제, 타이거JK, 팻두 or 빌스택스 finds nothing while we hold every one of
 * those artists under their romanized name.
 *
 * WHY MUSICBRAINZ IS THE RIGHT SOURCE, AND WHY THIS IS A BACKFILL RATHER THAN A FIX. mb-client's
 * getArtist already requests `inc=aliases`, and MusicBrainz genuinely carries these -- verified
 * directly: YANGHONGWON has 양홍원 and 영비, C Jamm has 씨잼 and 류성민, SURAN has 수란. Nothing is
 * broken in the ingest path today; these artists were ingested before aliases were stored, so the
 * data was simply never fetched for them. New ingests already get it.
 *
 * NOT EVERYTHING IS RECOVERABLE HERE. FatDoo has zero aliases on MusicBrainz, so he stays
 * unsearchable in Hangul until another source (Melon/Bugs/Genie carry Korean names that MB and
 * Deezer do not). The run reports that residual rather than hiding it.
 *
 * One MusicBrainz request per artist at 1 req/sec, so this must not run alongside another
 * MB-touching lane -- the limiter in mb-client is per-process, not global.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-aliases-mb.ts --limit=50
 *   npx tsx --env-file=.env.local scripts/backfill-native-aliases-mb.ts --apply
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { getArtist } from './mb-client';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit') ?? Infinity);
const STATE = 'scripts/data/native-aliases-state.json';

const HANGUL = /[가-힣]/;
const KANA = /[぀-ゟ゠-ヿ]/;
const isNative = (s: string) => HANGUL.test(s) || KANA.test(s);
const normAlias = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

const loadState = (): Set<string> => { try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done as string[]); } catch { return new Set(); } };
const saveState = (s: Set<string>) => fs.writeFileSync(STATE, JSON.stringify({ done: [...s] }));

async function sql<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function main() {
  const db = getDB();
  const done = loadState();

  // Artists whose name, native name and every existing alias are all non-native script, ordered so
  // the ones a user is most likely to search reach the front.
  const rows = await sql<{ id: string; name: string; mbid: string; pop: number | null; own: number }>(`
    select a.id::text, a.name, x.external_id as mbid, a.popularity as pop,
           (select count(*) from release_groups rg where rg.primary_artist_id = a.id) own
      from artists a
      join artist_external_ids x on x.artist_id = a.id and x.source = 'musicbrainz'
     where (
             a.native_language in ('ko','ja') or a.country in ('KR','JP')
             -- country and native_language are BOTH null for many of the artists this exists to
             -- fix: YANGHONGWON, C Jamm, SURAN and Tiger JK all have neither set, so gating on
             -- them excluded precisely the names the report lists. Releasing native-script
             -- material is the evidence that actually generalises.
             or exists (select 1 from release_groups rg
                         where rg.primary_artist_id = a.id
                           and (rg.title ~ '[가-힣]' or rg.native_title ~ '[가-힣]'))
             or a.name_phonetic_ko is not null
           )
       and a.name !~ '[가-힣\\u3040-\\u30ff]'
       and coalesce(a.name_native, '') !~ '[가-힣\\u3040-\\u30ff]'
       and not exists (
         select 1 from artist_aliases al
          where al.artist_id = a.id and al.alias ~ '[가-힣\\u3040-\\u30ff]')
     order by coalesce(a.popularity, 0) desc, own desc
     limit ${Number.isFinite(LIMIT) ? LIMIT : 20000}`);

  const todo = rows.filter(r => !done.has(r.id));
  console.log(`[native-aliases] ${todo.length} artist(s) with no native-script name anywhere${APPLY ? '  *** APPLY ***' : '  (report only)'}`);

  let found = 0, none = 0, written = 0, processed = 0;
  for (const r of todo) {
    // MbAlias is an object ({name, locale, primary, type}), not a string. Filtering the objects
    // against a regex silently matched nothing and reported every artist as "MusicBrainz has none"
    // -- a clean-looking zero that was a bug, not a finding.
    let natives: string[] = [];
    try {
      const d = await getArtist(r.mbid);
      natives = [...new Set((d?.aliases ?? []).map(al => al.name).filter(n => !!n && isNative(n)))];
    } catch { /* transient — leave for the next run */ done.add(r.id); continue; }

    processed++;
    if (natives.length) {
      found++;
      if (APPLY) {
        for (const alias of natives) {
          const { error } = await db.from('artist_aliases').insert({
            artist_id: r.id, alias, alias_norm: normAlias(alias),
            script: HANGUL.test(alias) ? 'Hang' : 'Jpan',
            primary_for_locale: false, source: 'musicbrainz',
          });
          if (!error) written++;
          else if (!/duplicate|unique/i.test(error.message)) console.warn(`  ! ${r.name}: ${error.message}`);
        }
      } else if (found <= 20) {
        console.log(`  ${r.name}  ->  ${natives.join(', ')}`);
      }
    } else none++;

    done.add(r.id);
    if (processed % 100 === 0) {
      if (APPLY) saveState(done);
      console.log(`  ${processed}/${todo.length}  with native alias ${found} (${(100 * found / processed).toFixed(0)}%), MB has none ${none}`);
    }
  }
  if (APPLY) saveState(done);
  console.log(`\n  processed ${processed}`);
  console.log(`  native aliases recovered : ${found} artists, ${written} alias row(s)`);
  console.log(`  MusicBrainz has none     : ${none}  (need Melon/Bugs/Genie — not reachable from here)`);
  if (!APPLY) console.log('  report only — re-run with --apply');
}

if (process.argv[1] && process.argv[1].endsWith('backfill-native-aliases-mb.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
