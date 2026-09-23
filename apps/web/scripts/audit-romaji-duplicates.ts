/**
 * How many pending writes are the SAME release we already hold, written in a different script?
 * REPORT ONLY.
 *
 * WHY. iTunes returns romanised titles for Japanese releases while MusicBrainz stores native script,
 * and titleVariants compares characters, so the two never meet. Found by reading a verification
 * sample by eye rather than trusting the matcher:
 *
 *   held    コノヨノシルシ -The Greatest ver.-        (BoA, 2022-04-18)
 *   pending KONOYONOSHIRUSHI (The Greatest Version)
 *
 * The same release. The verify script could not catch it because it calls titlesMatch, which is the
 * thing that is blind here -- the same trap as the earlier AGGRESSIVE case.
 *
 * WHAT THIS MEASURES, AND WHAT IT CANNOT. Kana romanises deterministically, so katakana and
 * hiragana titles can be transliterated and compared. KANJI CANNOT -- its reading depends on context
 * and no table gives it. So this is a LOWER BOUND on the duplicate population: it finds kana-only
 * collisions and silently misses anything containing kanji. Hangul is romanised by Revised
 * Romanization, which is rule-based but has assimilation exceptions this ignores, so Korean numbers
 * here are approximate in both directions.
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const IN = arg('--in') ?? 'scripts/data/kr-scene-report.clean.json';
const OUT = arg('--out') ?? 'scripts/data/romaji-duplicates.json';

// Katakana/hiragana -> romaji. Two-character digraphs first so キャ becomes "kya", not "kiya".
const DIGRAPHS: Record<string, string> = {
  'キャ':'kya','キュ':'kyu','キョ':'kyo','シャ':'sha','シュ':'shu','ショ':'sho','チャ':'cha','チュ':'chu','チョ':'cho',
  'ニャ':'nya','ニュ':'nyu','ニョ':'nyo','ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo','ジャ':'ja','ジュ':'ju','ジョ':'jo',
  'ビャ':'bya','ビュ':'byu','ビョ':'byo','ピャ':'pya','ピュ':'pyu','ピョ':'pyo','ティ':'ti','ディ':'di','ファ':'fa',
  'フィ':'fi','フェ':'fe','フォ':'fo','ウィ':'wi','ウェ':'we','ウォ':'wo','ヴァ':'va','ヴィ':'vi','ヴェ':'ve','ヴォ':'vo',
};
const MONO: Record<string, string> = {
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','ヴ':'vu','ー':'',
};
const hasKana = (s: string) => /[぀-ゟ゠-ヿ]/.test(s);
const hasKanji = (s: string) => /[一-鿿]/.test(s);

/** Katakana/hiragana -> romaji. Hiragana is shifted into katakana first so one table serves both. */
function romanize(s: string): string {
  const kata = s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  let out = '';
  for (let i = 0; i < kata.length; i++) {
    const two = kata.slice(i, i + 2);
    if (DIGRAPHS[two]) { out += DIGRAPHS[two]; i++; continue; }
    if (kata[i] === 'ッ') {                      // sokuon doubles the next consonant
      const nxt = DIGRAPHS[kata.slice(i + 1, i + 3)] ?? MONO[kata[i + 1]] ?? '';
      if (nxt) out += nxt[0];
      continue;
    }
    out += MONO[kata[i]] ?? kata[i];
  }
  return out;
}
const key = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

interface Album { primary: boolean; collides: unknown | null; displayTitle: string }
interface Row { id: string; name: string; verdict: string; newAlbums: Album[] }

async function main() {
  const db = getDB();
  const rows: Row[] = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const corr = rows.filter(r => r.verdict === 'CORROBORATED');

  let artistsChecked = 0, pending = 0, kanaHeld = 0, kanjiHeldSkipped = 0;
  const hits: { artist: string; pending: string; held: string }[] = [];

  for (const r of corr) {
    const want = (r.newAlbums ?? []).filter(a => a.primary && !a.collides);
    if (!want.length) continue;
    const { data, error } = await db.from('release_group_artists')
      .select('release_groups!inner(title, native_title)').eq('artist_id', r.id).limit(1000);
    if (error) continue;
    artistsChecked++; pending += want.length;

    // Held titles that are kana and therefore romanisable.
    const held: { orig: string; rom: string }[] = [];
    for (const d of (data ?? []) as any[]) {
      for (const t of [d.release_groups.title, d.release_groups.native_title]) {
        if (!t) continue;
        if (hasKanji(t)) { kanjiHeldSkipped++; continue; }   // reading is unknowable from a table
        if (!hasKana(t)) continue;
        held.push({ orig: t, rom: key(romanize(t)) });
        kanaHeld++;
      }
    }
    if (!held.length) continue;

    for (const a of want) {
      const k = key(a.displayTitle);
      if (!k) continue;
      // Containment either way: the pending title usually carries an edition suffix the held one
      // spells differently ("(The Greatest Version)" vs "-The Greatest ver.-").
      // BOTH sides need a length floor. Guarding only the held romanisation let short pending
      // titles match anything containing their letters: "AMOR" matched まもりたい because "amor" is
      // inside "m-amor-itai", and "A" matched ガナガナGO! because "ganaganago" contains an "a".
      // Two of twelve hits in the first run were this, so the raw count overstated the problem.
      const hit = k.length < 6 ? undefined
        : held.find(h => h.rom.length >= 6 && (k.includes(h.rom) || h.rom.includes(k)));
      if (hit) hits.push({ artist: r.name, pending: a.displayTitle, held: hit.orig });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(hits, null, 2));
  console.log(`\n  artists with pending writes : ${artistsChecked}`);
  console.log(`  pending albums              : ${pending}`);
  console.log(`  kana held titles compared   : ${kanaHeld}`);
  console.log(`  kanji held titles SKIPPED   : ${kanjiHeldSkipped}  (unromanisable — this is why the count below is a floor)`);
  console.log(`  ROMAJI DUPLICATES FOUND     : ${hits.length}`);
  console.log('\n  examples:');
  for (const h of hits.slice(0, 20)) console.log(`    ${h.artist} :: "${h.pending}"\n        held as "${h.held}"`);
  console.log(`\n  report → ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith('audit-romaji-duplicates.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
