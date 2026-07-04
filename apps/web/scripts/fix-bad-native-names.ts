/**
 * Corrects artists.name_native values that were set by the pre-fix pickNative()
 * bug in mb-ingest.ts: when MusicBrainz had no alias explicitly marked primary
 * for a ko/ja/zh locale, the old logic guessed by grabbing *any* CJK-locale
 * alias — which is sometimes the artist's legal/birth name rather than the
 * native-script form of their actual stage name (e.g. E SENS → wrongly "강민호"
 * instead of the correct "이센스", which MusicBrainz doesn't have on file at all
 * for this artist — the fixed behavior is to show no native name, not a wrong one).
 *
 * Scope: only touches artists that have artist_aliases rows (i.e. went through
 * the MusicBrainz ingest path this bug lives in). Artists with no aliases rows
 * were populated by the separate Wikipedia-langlinks backfill (backfill-native-names.ts)
 * and are left untouched — that mechanism doesn't share this bug and hasn't been audited.
 *
 * For each affected artist: recomputes name_native from their stored aliases (see
 * pickNativeFromAliases below for the full rule, including how a non-primary CJK
 * alias is told apart from birth-name pollution). Only writes when the recomputed
 * value actually differs from what's stored, and sets native_language to match
 * whichever locale was actually picked (not hardcoded).
 *
 * Candidate set is every artist_id present in artist_aliases — not artists whose
 * name_native is currently non-null. A prior run can wrongly null out a value that
 * was actually correct; scoping by name_native would make that row permanently
 * invisible to future corrective runs.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fix-bad-native-names.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/fix-bad-native-names.ts
 */

import { getDB } from './itunes-ingest-core';

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 500;

type AliasRow = {
  artist_id: string;
  alias: string;
  locale: string | null;
  primary_for_locale: boolean;
};

function localeBase(locale: string | null): string | null {
  return locale ? locale.split(/[-_]/)[0] : null;
}

function isCjkScript(s: string): boolean {
  return /[가-힣ᄀ-ᇿ぀-ゟ゠-ヿ一-鿿]/.test(s);
}

// Genuine phonetic transliterations of a Latin stage name into Japanese are conventionally
// written in katakana (the script Japanese reserves for foreign/loan words) — e.g. "Toto" →
// "トト", "Jack White" → "ジャック・ホワイト". A ja alias written purely in kanji with no
// katakana at all is not a transliteration of a Latin name; it's almost always the artist's
// real name (e.g. "aiko" → real full name "柳井愛子", not a rendering of the stage name).
function isKanjiOnlyJapanese(s: string): boolean {
  const hasKanji = /[一-鿿]/.test(s);
  const hasKana = /[぀-ゟ゠-ヿ]/.test(s);
  return hasKanji && !hasKana;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A real personal name reads as 2+ words and is a genuinely separate identity from the
// stage name — not merely a variant/extension of it (e.g. "THE BLANKEY JET CITY" contains
// "BLANKEY JET CITY" and is just an official alt-form, not a different person). MusicBrainz
// doesn't reliably tag these with locale='en' — e.g. Lily Chou‐Chou (a fictional stage
// persona) has her real performer's name "Keiko Suzuki" tagged locale=null, same as most
// of her other Latin aliases — so the locale tag alone isn't a safe signal.
function looksLikeDistinctPersonalName(alias: string, mainName: string): boolean {
  const normAlias = normalize(alias);
  const normMain = normalize(mainName);
  if (normAlias.includes(normMain) || normMain.includes(normAlias)) return false;
  const wordCount = alias.trim().split(/\s+/).filter(Boolean).length;
  return wordCount >= 2;
}

function pickNativeFromAliases(mainName: string, aliases: AliasRow[]): { name: string; language: string } | null {
  const cjk = aliases.filter(a => ['ko', 'ja', 'zh'].includes(localeBase(a.locale) ?? ''));
  const primary =
    cjk.find(a => a.primary_for_locale && localeBase(a.locale) === 'ko') ??
    cjk.find(a => a.primary_for_locale);
  if (primary) return { name: primary.alias, language: localeBase(primary.locale)! };

  // No primary CJK alias. When the stage name is already native script (e.g. a Korean idol's
  // Hangul mononym like "가은" or "윤상"), never guess from a lone non-primary CJK alias — that
  // is exactly where full legal-name pollution concentrates (가은's real name "이가은", 윤상's
  // "이윤상", 지민's "신지민" — all stored as plain non-primary Hangul aliases, indistinguishable
  // from a genuine transliteration by any non-CJK signal, since there often isn't one). A stage
  // name that's already native has no script gap to fill, so there's nothing safe to guess here.
  if (isCjkScript(mainName)) return null;

  // Stage name is Latin. A single non-primary CJK alias is still trustworthy UNLESS some other
  // (non-CJK-tagged) alias reads as the artist's separate real/legal name — that pattern is
  // the signature of "this CJK alias is the artist's birth name, not a transliteration of
  // their stage name" (e.g. E SENS has "Kang Min-Ho"; his paired Hangul "강민호" is his birth
  // name, not a rendering of "E SENS"). Whereas e.g. ENHYPEN's only non-Latin alias,
  // "엔하이픈", has no such real-name pair — it's simply the correct Korean transliteration
  // of the stage name that MusicBrainz didn't flag primary.
  const hasRealNameAlias = aliases.some(
    a => !['ko', 'ja', 'zh'].includes(localeBase(a.locale) ?? '') && looksLikeDistinctPersonalName(a.alias, mainName)
  );
  if (hasRealNameAlias) return null;

  if (cjk.length === 1) {
    const only = cjk[0];
    if (localeBase(only.locale) === 'ja' && isKanjiOnlyJapanese(only.alias)) return null;
    return { name: only.alias, language: localeBase(only.locale)! };
  }
  return null;
}

async function main() {
  const db = getDB();

  // Scope is defined by artist_aliases, not by artists.name_native — a prior overly-strict
  // pass can wrongly null out a correct value, and that row must still be re-examined here.
  // Filtering on "name_native IS NOT NULL" would make such rows permanently invisible.
  let offset = 0;
  const aliasesByArtist = new Map<string, AliasRow[]>();
  for (;;) {
    const { data: rows, error } = await db
      .from('artist_aliases')
      .select('artist_id, alias, locale, primary_for_locale')
      .order('artist_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch aliases: ${error.message}`);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      const list = aliasesByArtist.get(r.artist_id) ?? [];
      list.push(r);
      aliasesByArtist.set(r.artist_id, list);
    }
    offset += PAGE_SIZE;
  }

  const artistIds = [...aliasesByArtist.keys()];
  let totalChecked = 0;
  let totalWrong = 0;
  let totalCleared = 0;

  for (let i = 0; i < artistIds.length; i += PAGE_SIZE) {
    const chunk = artistIds.slice(i, i + PAGE_SIZE);
    const { data: artists, error } = await db
      .from('artists')
      .select('id, name, name_native')
      .in('id', chunk);
    if (error) throw new Error(`fetch artists: ${error.message}`);

    for (const artist of artists ?? []) {
      totalChecked++;
      const aliases = aliasesByArtist.get(artist.id)!;

      const corrected = pickNativeFromAliases(artist.name, aliases);
      if ((corrected?.name ?? null) === artist.name_native) continue; // already correct

      totalWrong++;
      if (!corrected) totalCleared++;
      console.log(
        `${DRY_RUN ? '[dry-run] ' : ''}${artist.name}: "${artist.name_native}" -> ${corrected ? `"${corrected.name}" (${corrected.language})` : 'null'}`
      );

      if (!DRY_RUN) {
        const { error: updErr } = await db
          .from('artists')
          .update({ name_native: corrected?.name ?? null, native_language: corrected?.language ?? null })
          .eq('id', artist.id);
        if (updErr) console.error(`  update failed: ${updErr.message}`);
      }
    }
  }

  console.log(`\nChecked: ${totalChecked} artists with alias rows`);
  console.log(`Wrong / corrected: ${totalWrong} (${totalCleared} cleared to null, ${totalWrong - totalCleared} replaced)`);
  if (DRY_RUN) console.log('\nDry run — no writes made. Re-run without --dry-run to apply.');
}

main();
