/**
 * LANGUAGE QUALIFICATION — the nationality/language axis of the genre system.
 *
 * A genre's identity is sound × language: rock sung in Japanese is J-Rock, not
 * "rock"; hip-hop by a Korean act is Korean Hip-Hop. English is the unmarked default —
 * an English-language (or unknown-language) album keeps its genres as they are.
 *
 *   albumLanguage(input)   → { lang, source }   which language an album is in
 *   qualify(id, lang)      → qualified id       base genre → its in-language form
 *   qualifiedInfo(qid)     → level/rank/display/family of any (qualified) id
 *   qualifyAlbum(tags,lang)→ qualified ids      the album's genres, qualified
 *   primaryOfAlbum(tags,lang) → qualified id    the album's primary genre, qualified
 *   albumGenreLabels(tags,lang) → string[]      chip labels: only the broadest genre
 *                                               gets the language ("Korean rock")
 *
 * Qualified ids are either an AUTHORED localized node (taxonomy `localizes`:
 * pop@ko → 'k-pop', rock@ja → 'j-rock', hip-hop@ko → 'k-rap') or a SYNTHETIC id
 * `<base>@<lang>` ("alternative-rock@ja" → "Japanese Alternative Rock"). Synthetic
 * ids exist only in derived, in-memory views (taste map); they are never written
 * to release_groups.genres / release_genres, so no stored key shape changes.
 *
 * Why the language is INFERRED rather than read: no source we ingest records
 * lyric language. MusicBrainz's release `text-representation.language` describes
 * the TRACKLIST TITLES, not the lyrics — verified live 2026-09-28: Korean rap
 * releases with English track titles come back `eng`. So the evidence ladder is
 * (strongest first): a language-bound genre tag on the album (k-pop, j-rock,
 * chanson…) → the stored NON-English MB tracklist language
 * (release_groups.title_language — "eng" is never stored, it proves nothing)
 * → the title's script (Hangul ⇒ ko, kana ⇒ ja) → the artist's
 * native-script name language (ko/ja only; the stored `zh` is a kanji false
 * positive for Japanese names) → the artist's country, for countries whose acts
 * overwhelmingly sing in the local language. Anything weaker stays unqualified —
 * the conservative default is "leave the genre as is".
 *
 * Dependency-light (taxonomy + resolver only) so client, server and scripts can
 * all use it.
 */
import { NODE_BY_ID, TAXONOMY, type GenreLevel } from './taxonomy';
import { ancestorsOf, primaryOf, resolveGenre } from './resolver';

export interface LanguageInfo {
  en: string;
  ko: string;
  /**
   * Countries whose acts overwhelmingly sing in this language, so artist
   * country alone is enough evidence. Languages without one (German, French,
   * Swedish…) qualify only on positive evidence (a tag or the script), because
   * a large share of those countries' acts sing in English.
   */
  countries?: string[];
}

export const LANGUAGES: Readonly<Record<string, LanguageInfo>> = {
  ko: { en: 'Korean', ko: '한국', countries: ['KR', 'KP'] },
  ja: { en: 'Japanese', ko: '일본', countries: ['JP'] },
  zh: { en: 'Chinese', ko: '중국어', countries: ['CN', 'TW', 'HK', 'MO'] },
  es: {
    en: 'Spanish',
    ko: '스페인어',
    countries: ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'CU', 'PR', 'DO', 'EC', 'UY', 'PY', 'BO', 'GT', 'CR', 'PA', 'SV', 'HN', 'NI'],
  },
  pt: { en: 'Portuguese', ko: '포르투갈어', countries: ['BR', 'PT', 'AO', 'MZ'] },
  it: { en: 'Italian', ko: '이탈리아어', countries: ['IT'] },
  tr: { en: 'Turkish', ko: '튀르키예어', countries: ['TR'] },
  ru: { en: 'Russian', ko: '러시아어', countries: ['RU', 'BY'] },
  th: { en: 'Thai', ko: '태국어', countries: ['TH'] },
  vi: { en: 'Vietnamese', ko: '베트남어', countries: ['VN'] },
  id: { en: 'Indonesian', ko: '인도네시아어', countries: ['ID'] },
  hi: { en: 'Indian', ko: '인도', countries: ['IN'] },
  fr: { en: 'French', ko: '프랑스어' },
  de: { en: 'German', ko: '독일어' },
  uk: { en: 'Ukrainian', ko: '우크라이나어' },
  ar: { en: 'Arabic', ko: '아랍어' },
};

/** Countries whose acts are English-language by default (never qualified). */
const ENGLISH_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ']);

const COUNTRY_LANG = new Map<string, string>();
for (const [lang, info] of Object.entries(LANGUAGES)) {
  for (const c of info.countries ?? []) COUNTRY_LANG.set(c, lang);
}

/**
 * Sound families whose genres are language-sensitive (sung, and their scenes
 * split by language). Jazz / classical / electronic / experimental stay
 * unqualified — mostly instrumental, and their scenes are not language-bound.
 */
const SENSITIVE_FAMILIES = new Set([
  'pop', 'rock', 'hip-hop', 'rnb-soul', 'punk', 'metal', 'folk', 'country', 'blues',
]);
/** Families that are regional in themselves — their genres are never re-qualified. */
const REGIONAL_FAMILIES = new Set(['latin', 'reggae']);

// ── node helpers ──────────────────────────────────────────────────────────────

/** The family a node belongs to, following its FIRST sound parent (its primary
 *  lineage): synth-pop → pop, trip-hop → electronic, k-rap → hip-hop. */
export function homeFamily(id: string): string | null {
  let cur = NODE_BY_ID.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.level === 'family') return cur.isScene ? null : cur.id;
    const next = cur.soundParents[0];
    if (!next) return null;
    cur = NODE_BY_ID.get(next);
  }
  return null;
}

/** The language a node is bound to — its own, else a scene root's — or null. */
export function nodeLanguage(id: string): string | null {
  const node = NODE_BY_ID.get(id);
  if (!node) return null;
  if (node.language) return node.language;
  for (const a of ancestorsOf(id)) {
    const l = NODE_BY_ID.get(a)?.language;
    if (l) return l;
  }
  return null;
}

/** True when the node can take a language qualifier: a sung, non-regional genre
 *  with no language of its own. */
export function isLanguageNeutral(id: string): boolean {
  const node = NODE_BY_ID.get(id);
  if (!node || node.isScene) return false;
  if (nodeLanguage(id)) return false;
  const fam = homeFamily(id);
  if (!fam || !SENSITIVE_FAMILIES.has(fam)) return false;
  for (const a of ancestorsOf(id)) if (REGIONAL_FAMILIES.has(a)) return false;
  return true;
}

/** `${base}@${lang}` → authored localized node id. Built once. */
let LOCALIZED: Map<string, string> | null = null;
function localized(): Map<string, string> {
  if (LOCALIZED) return LOCALIZED;
  const m = new Map<string, string>();
  for (const node of TAXONOMY) {
    if (!node.localizes) continue;
    const lang = nodeLanguage(node.id);
    if (!lang) continue;
    for (const base of node.localizes) {
      const key = `${base}@${lang}`;
      if (!m.has(key)) m.set(key, node.id);
    }
  }
  LOCALIZED = m;
  return m;
}

// ── qualification ─────────────────────────────────────────────────────────────

/**
 * The in-language form of a genre. English/unknown language, or a genre that is
 * not language-neutral (jazz, house, salsa, k-pop itself), returns the id
 * unchanged; otherwise the authored localized node when one exists, else the
 * synthetic `<base>@<lang>`.
 */
export function qualify(id: string, lang: string | null | undefined): string {
  if (!lang || lang === 'en' || !isLanguageNeutral(id)) return id;
  return localized().get(`${id}@${lang}`) ?? `${id}@${lang}`;
}

/** Split a synthetic qualified id; null for a plain taxonomy id. */
export function parseQualified(qid: string): { base: string; lang: string } | null {
  const at = qid.lastIndexOf('@');
  if (at <= 0) return null;
  return { base: qid.slice(0, at), lang: qid.slice(at + 1) };
}

export interface QualifiedInfo {
  id: string;
  /** The language-neutral node this sits on (the id itself for a plain node). */
  base: string;
  /** Language of the id (bound or qualified), null when unmarked. */
  lang: string | null;
  level: GenreLevel;
  rank: number;
  display: { en: string; ko: string };
  /** Display without the language — for a genre shown inside its language's
   *  world ("Alternative Rock" inside Japanese Rock). Same as display for plain
   *  and authored nodes. */
  shortDisplay: { en: string; ko: string };
  /** The (qualified) family this id lives under — the taste-map world key. */
  family: string | null;
}

const INFO_CACHE = new Map<string, QualifiedInfo | null>();

/** Level, rank, display and world family of a plain or qualified id. */
export function qualifiedInfo(qid: string): QualifiedInfo | null {
  if (INFO_CACHE.has(qid)) return INFO_CACHE.get(qid)!;
  let out: QualifiedInfo | null = null;
  const parsed = parseQualified(qid);
  if (parsed) {
    const base = NODE_BY_ID.get(parsed.base);
    if (base) {
      const fam = homeFamily(base.id);
      out = {
        id: qid,
        base: base.id,
        lang: parsed.lang,
        level: base.level,
        rank: base.rank,
        display: {
          en: `${languageName(parsed.lang, 'en')} ${base.display.en}`,
          ko: `${languageName(parsed.lang, 'ko')} ${base.display.ko}`,
        },
        shortDisplay: base.display,
        family: fam ? qualify(fam, parsed.lang) : null,
      };
    }
  } else {
    const node = NODE_BY_ID.get(qid);
    if (node) {
      const lang = nodeLanguage(qid);
      const fam = homeFamily(qid);
      // A language-bound node's world is its language's form of its family
      // (korean-indie → rock@ko → Korean Rock, city-pop → pop@ja → J-Pop, chanson →
      // French Pop); qualify() leaves non-sensitive families plain (bossa nova →
      // Latin), and a plain node's world is its family.
      out = {
        id: qid,
        base: node.localizes?.[0] ?? qid,
        lang: lang === 'en' ? null : lang,
        level: node.level,
        rank: node.rank,
        display: node.display,
        shortDisplay: node.display,
        family: fam ? qualify(fam, lang) : null,
      };
    }
  }
  INFO_CACHE.set(qid, out);
  return out;
}

/**
 * Name of a language for prefixing a genre ("Korean", "스페인어"). Languages
 * outside LANGUAGES (e.g. Swedish from a stored MB tracklist language) fall back
 * to Intl's language names.
 */
export function languageName(lang: string, ui: 'en' | 'ko'): string {
  const info = LANGUAGES[lang];
  if (info) return info[ui];
  try {
    return new Intl.DisplayNames([ui], { type: 'language' }).of(lang) ?? lang.toUpperCase();
  } catch {
    return lang.toUpperCase();
  }
}

/** ISO 639-3 (MusicBrainz) → the codes used here; unlisted codes pass through. */
const ISO3_TO_LANG: Record<string, string> = {
  kor: 'ko', jpn: 'ja', zho: 'zh', chi: 'zh', cmn: 'zh', yue: 'zh', nan: 'zh',
  spa: 'es', por: 'pt', ita: 'it', tur: 'tr', rus: 'ru', tha: 'th', vie: 'vi',
  ind: 'id', msa: 'id', hin: 'hi', pan: 'hi', tam: 'hi', tel: 'hi', ben: 'hi',
  mar: 'hi', urd: 'hi', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ukr: 'uk',
  ara: 'ar', swe: 'sv', nld: 'nl', dut: 'nl', pol: 'pl', fin: 'fi', dan: 'da',
  nor: 'no', nob: 'no', ces: 'cs', ell: 'el', heb: 'he', hun: 'hu', ron: 'ro',
  tgl: 'tl', fas: 'fa', per: 'fa',
};
const NO_EVIDENCE = new Set(['eng', 'mul', 'zxx', 'und', 'mis']);

/** A stored MB tracklist language as a language code, or null. */
export function fromTitleLanguage(code: string | null | undefined): string | null {
  const c = code?.trim().toLowerCase();
  if (!c || NO_EVIDENCE.has(c)) return null;
  return ISO3_TO_LANG[c] ?? c;
}

// ── album language ────────────────────────────────────────────────────────────

export type LanguageSource = 'tag' | 'title-language' | 'script' | 'artist-script' | 'country';

export interface AlbumLanguageInput {
  genres: readonly string[] | null | undefined;
  title?: string | null;
  nativeTitle?: string | null;
  /** Primary artist's ISO 3166-1 country (MB pseudo-codes XW/XE/XU = unknown). */
  artistCountry?: string | null;
  /** artists.native_language — script-detected from the native name. */
  artistNativeLanguage?: string | null;
  /** release_groups.title_language — MB tracklist language, stored only when non-English. */
  titleLanguage?: string | null;
}

export interface AlbumLanguage {
  /** ISO 639-1, 'en' for English, null when unknown (treated as unmarked). */
  lang: string | null;
  source: LanguageSource | null;
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HAN = /[㐀-䶿一-鿿]/;
const THAI = /[฀-๿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿ]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/** Language implied by the script of a title, when the script is decisive. */
export function scriptLanguage(text: string, country: string | null): string | null {
  if (!text) return null;
  if (HANGUL.test(text)) return 'ko';
  if (KANA.test(text)) return 'ja';
  if (THAI.test(text)) return 'th';
  if (DEVANAGARI.test(text)) return 'hi';
  if (ARABIC.test(text)) return 'ar';
  if (CYRILLIC.test(text)) return country === 'UA' ? 'uk' : 'ru';
  if (HAN.test(text)) {
    // Han without kana is shared by Chinese and kanji-only Japanese titles —
    // only the artist's country can split them.
    const cl = country ? COUNTRY_LANG.get(country) : null;
    if (cl === 'ja' || cl === 'zh') return cl;
    return null;
  }
  return null;
}

function normCountry(c: string | null | undefined): string | null {
  const u = c?.trim().toUpperCase();
  if (!u || u.length !== 2 || u === 'XW' || u === 'XE' || u === 'XU') return null;
  return u;
}

/** The album's language by the evidence ladder in the header comment. */
export function albumLanguage(input: AlbumLanguageInput): AlbumLanguage {
  const country = normCountry(input.artistCountry);

  // 1. Language-bound genre tags (k-pop, j-rock, chanson, latin pop…).
  const tagLangs = new Map<string, string>(); // lang → first tag id carrying it
  for (const raw of input.genres ?? []) {
    const id = resolveGenre(raw);
    if (!id) continue;
    const l = nodeLanguage(id);
    if (l && l !== 'en' && !tagLangs.has(l)) tagLangs.set(l, id);
  }
  const script =
    scriptLanguage(input.nativeTitle ?? '', country) ?? scriptLanguage(input.title ?? '', country);
  const titleLang = fromTitleLanguage(input.titleLanguage);
  if (tagLangs.size === 1) return { lang: [...tagLangs.keys()][0], source: 'tag' };
  if (tagLangs.size > 1) {
    // Conflicting tags (a Korean act's Japanese single tagged k-pop + j-pop): the
    // tracklist language or title script decides, else the primary genre's.
    if (titleLang && tagLangs.has(titleLang)) return { lang: titleLang, source: 'tag' };
    if (script && tagLangs.has(script)) return { lang: script, source: 'tag' };
    const primary = primaryOf([...tagLangs.values()]);
    const pl = primary ? nodeLanguage(primary) : null;
    return { lang: pl ?? [...tagLangs.keys()][0], source: 'tag' };
  }

  // 2. Non-English MB tracklist language, then the title's script.
  if (titleLang) return { lang: titleLang, source: 'title-language' };
  if (script) return { lang: script, source: 'script' };

  // 3. Artist's native-script name (ko/ja only — the stored zh is unreliable).
  const nl = input.artistNativeLanguage?.trim().toLowerCase();
  if (nl === 'ko' || nl === 'ja') return { lang: nl, source: 'artist-script' };

  // 4. Artist country.
  if (country) {
    if (ENGLISH_COUNTRIES.has(country)) return { lang: 'en', source: 'country' };
    const cl = COUNTRY_LANG.get(country);
    if (cl) return { lang: cl, source: 'country' };
  }
  return { lang: null, source: null };
}

/** Countries whose artists default to `lang` (for country-filtered DB queries). */
export function countriesOfLanguage(lang: string | null): string[] {
  return lang ? [...(LANGUAGES[lang]?.countries ?? [])] : [];
}

/**
 * An album's genres as qualified ids, deduped, in tag order (tags with no
 * taxonomy node are dropped — they have no family to live under).
 */
export function qualifyAlbum(genres: readonly string[] | null | undefined, lang: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of genres ?? []) {
    const id = resolveGenre(raw);
    if (!id || NODE_BY_ID.get(id)?.isScene) continue;
    const q = qualify(id, lang);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

/**
 * A localized node that stands for a whole FAMILY in its language (k-pop = pop
 * in Korean, j-rock = rock in Japanese, k-rap = hip-hop in Korean). Tags like
 * these are used as catch-alls: MusicBrainz editors and the iTunes store label
 * nearly every Korean release "k-pop" — Beenzino's and Dynamic Duo's rap albums
 * included — so on its own such a tag says "Korean", not "idol pop".
 */
function isCatchAll(id: string): boolean {
  const node = NODE_BY_ID.get(id);
  return !!node?.localizes?.some((b) => NODE_BY_ID.get(b)?.level === 'family');
}

/**
 * The album's primary genre, qualified: the taxonomy's primary walk runs on the
 * tags AS WRITTEN, and only the winner is qualified (qualifying "hip hop" to
 * k-rap must not make it more specific than it was).
 *
 * One correction on top: when the walk picks a catch-all localized family tag
 * (k-pop) but a tag of a DIFFERENT sung family is listed before it, the earlier
 * family wins. genres[] is stored in vote / merge-rank order (MusicBrainz votes
 * sorted descending, then the Phase-3 merge ranking), so the order carries the
 * signal the tags themselves don't: rap albums read [hip hop, k-pop], idol
 * albums [k-pop, hip hop, dance] or [pop, k-pop, hip hop].
 */
export function primaryOfAlbum(genres: readonly string[] | null | undefined, lang: string | null): string | null {
  const tags = (genres ?? []).filter((g) => {
    const id = resolveGenre(g);
    return id != null && !NODE_BY_ID.get(id)?.isScene;
  });
  let primary = primaryOf(tags);
  if (primary && isCatchAll(primary)) {
    const ids = tags.map((t) => resolveGenre(t)!);
    const at = ids.indexOf(primary);
    const ownFamily = homeFamily(primary);
    const earlier = ids
      .slice(0, at)
      .find((id) => {
        const fam = homeFamily(id);
        return fam != null && fam !== ownFamily && SENSITIVE_FAMILIES.has(fam);
      });
    if (earlier) {
      // Most specific tag of that earlier family (hip hop + trap → trap).
      const fam = homeFamily(earlier);
      const sameFamily = tags.filter((t) => homeFamily(resolveGenre(t)!) === fam);
      primary = primaryOf(sameFamily) ?? earlier;
    }
  }
  return primary ? qualify(primary, lang) : null;
}

/**
 * Chip labels for an album's genre list, in the same order: only the album's
 * BROADEST language-neutral genre (lowest level, first in order on a tie) gets
 * the language in front — ["alternative rock", "rock"] by a Japanese act →
 * ["alternative rock", "Japanese rock"]. English/unknown language, or no
 * qualifiable genre, returns the tags unchanged. Links should keep the raw tag.
 */
export function albumGenreLabels(
  genres: readonly string[],
  lang: string | null,
  ui: 'en' | 'ko' = 'en',
): string[] {
  const out = [...genres];
  if (!lang || lang === 'en') return out;
  const LEVEL: Record<GenreLevel, number> = { family: 0, genre: 1, subgenre: 2 };
  let best = -1;
  let bestLevel = Infinity;
  genres.forEach((raw, i) => {
    const id = resolveGenre(raw);
    if (!id || !isLanguageNeutral(id)) return;
    const level = LEVEL[NODE_BY_ID.get(id)!.level];
    if (level < bestLevel) {
      best = i;
      bestLevel = level;
    }
  });
  if (best >= 0) out[best] = `${languageName(lang, ui)} ${genres[best]}`;
  return out;
}
