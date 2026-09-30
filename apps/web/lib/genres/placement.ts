/**
 * ALBUM PLACEMENT — which world (sound family × language) an album belongs to.
 *
 * Replaces "the most specific tag decides" (resolver.primaryOf), which let one
 * minor co-tag pick the world: 808s & Heartbreak went to R&B on `alternative r&b`,
 * OK Computer to Electronic on `leftfield`, 기리보이 to Classical on `instrumental`
 * (GENRE_AUDIT.md §3). Here the world is the family with the most EVIDENCE, and
 * specificity only picks the genre inside it (lib/taste/worlds.ts).
 *
 *   evidence  = the album's own tags, plus an ARTIST PRIOR: the artist's other
 *               albums in our catalog, and the artist's MusicBrainz genres,
 *               Last.fm tags and Wikidata genres (artists.genre_evidence).
 *   per source: each tag → its taxonomy node → its family, weighted by the tag's
 *               votes/count relative to the source's top tag. A hybrid genre
 *               splits across its parents (pop rap = ½ hip-hop + ½ pop), so parent
 *               order no longer matters. Descriptors (evidence 0) don't count;
 *               catch-alls (k-pop 0.3) count weakly, and still count at full
 *               weight towards how MUCH the source said — so an album tagged only
 *               "k-pop" is weak evidence the artist prior can outvote.
 *   combine:    sources at equal weight, except iTunes (a single coarse store genre
 *               per album) at half; the artist prior counts λ = 0.5 when the album's
 *               own evidence is strong, rising to 1 as it weakens.
 *
 * Measured on hand-labelled golden sets (GENRE_AUDIT.md §8): 69 → 89% best-label
 * accuracy on the rated albums, 51 → 88% on a Korean holdout. Equal source weights
 * generalized better than tuned ones; per-album external sources added nothing.
 *
 * Dependency-light (taxonomy + resolver + language), like the rest of lib/genres.
 */
import { NODE_BY_ID } from './taxonomy';
import { resolveGenre } from './resolver';
import {
  albumLanguage,
  fromTitleLanguage,
  homeFamily,
  scriptLanguage,
  type AlbumLanguage,
  type AlbumLanguageInput,
} from './language';

/** A tag from some source, with its vote count / tag count (default 1). */
export interface EvidenceTag {
  tag: string;
  weight?: number;
}

/** Artist-level evidence: the artist prior. Every field optional. */
export interface ArtistEvidence {
  /** Tag counts over the artist's OTHER albums/EPs in our catalog (not singles). */
  catalog?: EvidenceTag[];
  /** MusicBrainz artist genres with vote counts. */
  musicbrainz?: EvidenceTag[];
  /** Last.fm artist top tags with counts (0–100). */
  lastfm?: EvidenceTag[];
  /** Wikidata artist genres (P136), unweighted. */
  wikidata?: EvidenceTag[];
  /** iTunes primaryGenreName counts over the artist's OTHER albums (raw store names). */
  itunes?: EvidenceTag[];
}

/** Languages of the artist's OTHER releases (any type), for the artist-level fallback. */
export interface ReleaseLanguages {
  /** How many other releases the artist has. */
  total: number;
  /** language → how many of them are in it (stored tracklist language, else title script). */
  counts: Record<string, number>;
}

export interface PlacementInput extends AlbumLanguageInput {
  /** The artist's display name — its script is language evidence (기리보이 → ko). */
  artistName?: string | null;
  artist?: ArtistEvidence | null;
  /** The album's own iTunes primaryGenreName, when the artist was matched on iTunes. */
  itunesGenre?: string | null;
  /** See ReleaseLanguages — used only when the album itself shows no language. */
  artistReleaseLanguages?: ReleaseLanguages | null;
}

/** Artist prior weight when the album's own evidence is strong. */
export const PRIOR_LAMBDA = 0.5;
/** iTunes files each album under ONE coarse store genre, so it counts half. */
export const ITUNES_WEIGHT = 0.5;
/** Artist-level language fallback: at least this many other releases, this share in one language. */
export const ARTIST_LANGUAGE_MIN_RELEASES = 3;
export const ARTIST_LANGUAGE_MIN_SHARE = 0.7;

/**
 * External-source vocabulary that the taxonomy's aliases don't carry: Discogs /
 * Wikidata / Last.fm spellings of genres we have. null = known non-genre (skip).
 * Folded like resolver.fold. Word synonyms of OUR vocabulary belong in
 * taxonomy.ts aliases instead; this is only the bridge for outside sources.
 */
const SOURCE_VOCAB: Record<string, string | null> = {
  funksoul: 'rnb-soul',
  folkworldcountry: 'folk',
  stagescreen: null,
  childrens: null,
  brassmilitary: null,
  rnbswing: 'r-and-b',
  rhythmandblues: 'r-and-b',
  rnb: 'r-and-b',
  conscious: 'conscious-hip-hop',
  gangsta: 'gangsta-rap',
  khiphop: 'k-rap',
  koreanhiphop: 'k-rap',
  krnb: 'k-r-and-b',
  koreanrnb: 'k-r-and-b',
  traditionalfolk: 'folk',
  indie: null,
  vocal: null,
};

const foldTag = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * iTunes primaryGenreName → a tag we resolve, or null for store genres that say
 * nothing about sound. "Alternative" / "Adult Alternative" are dropped: the store
 * files art pop, singer-songwriters and indie electronic there (it sent Tom Misch
 * and Bastille to Rock). Names not listed pass through to the resolver. Keys folded.
 */
const ITUNES_GENRE: Record<string, string | null> = {
  hiphoprap: 'hip hop', rap: 'hip hop', undergroundrap: 'hip hop', alternativerap: 'hip hop',
  dirtysouth: 'hip hop', eastcoastrap: 'hip hop', westcoastrap: 'hip hop', ukhiphop: 'hip hop',
  jhiphop: 'hip hop', chinesehiphop: 'hip hop', germanhiphop: 'hip hop', frenchrap: 'hip hop',
  koreanhiphop: 'korean hip hop', rbsoul: 'r&b', contemporaryrb: 'r&b', koreanrb: 'korean r&b',
  koreanrock: 'rock', koreanfolkpop: 'folk', koreanindie: 'korean indie', singersongwriter: 'singer-songwriter',
  frenchpop: 'chanson', varietefrancaise: 'chanson', germanpop: 'pop', teenpop: 'pop', poprock: 'pop rock',
  americantradrock: 'rock', rockyalternativo: 'rock', deutschrock: 'rock', psychedelic: 'psychedelic rock',
  progrockartrock: 'progressive rock', drumbass: 'drum and bass', cantopophkpop: 'cantopop', brazilian: 'mpb',
  latinurban: 'reggaeton', urbanolatino: 'reggaeton', poplatino: 'latin pop', anime: 'j-pop', neosoul: 'neo soul',
  alternative: null, adultalternative: null, vocal: null, soundtrack: null, karaoke: null, fitnessworkout: null,
  childrensmusic: null, holiday: null, christmas: null, music: null, world: null, worldwide: null,
  easylistening: null, instrumental: null, comedy: null, spokenword: null, newage: null,
};
/** An iTunes store genre as a tag for placement, or null. */
export function itunesTag(genre: string | null | undefined): string | null {
  if (!genre) return null;
  const f = foldTag(genre.normalize('NFKD'));
  return f in ITUNES_GENRE ? ITUNES_GENRE[f] : genre.toLowerCase();
}

/** A tag from any source → taxonomy id, or null. Wikidata's "… music" suffix is dropped. */
export function resolveEvidenceTag(raw: string): string | null {
  const t = raw.toLowerCase().trim();
  const f = foldTag(t);
  if (f in SOURCE_VOCAB) return SOURCE_VOCAB[f];
  const direct = resolveGenre(t);
  if (direct) return direct;
  const stripped = t.replace(/ music$/, '').replace(/^music of /, '');
  const fs = foldTag(stripped);
  if (fs in SOURCE_VOCAB) return SOURCE_VOCAB[fs];
  return resolveGenre(stripped);
}

/** The families a node counts towards: each sound parent's family for a hybrid,
 *  else its own family. pop-rap → [pop, hip-hop]; shoegaze → [rock]. */
export function familiesOf(id: string): string[] {
  const node = NODE_BY_ID.get(id);
  if (!node) return [];
  const fams =
    node.soundParents.length > 1 ? node.soundParents.map((p) => homeFamily(p)) : [homeFamily(id)];
  return [...new Set(fams.filter((f): f is string => !!f))];
}

/** How much a node counts towards choosing a world (taxonomy `evidence`, default 1). */
export function evidenceOf(id: string): number {
  return NODE_BY_ID.get(id)?.evidence ?? 1;
}

/**
 * One source's family distribution. Weights are relative to the source's top tag;
 * the result is normalized by the source's undiscounted mass, so it sums to ≤ 1 —
 * below 1 exactly when catch-alls were discounted. Descriptors are skipped unless
 * `descriptors` is set (the last-resort fallback).
 */
export function familyDistribution(
  tags: readonly EvidenceTag[] | null | undefined,
  descriptors = false,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!tags?.length) return out;
  const max = Math.max(1e-9, ...tags.map((t) => t.weight ?? 1));
  let raw = 0;
  for (const t of tags) {
    const id = resolveEvidenceTag(t.tag);
    if (!id) continue;
    const node = NODE_BY_ID.get(id);
    if (!node || node.isScene) continue;
    const ev = evidenceOf(id);
    if (ev === 0 && !descriptors) continue;
    let w = (t.weight ?? 1) / max;
    raw += w;
    if (ev > 0) w *= ev;
    if (w <= 0) continue;
    const fams = familiesOf(id);
    for (const f of fams) out.set(f, (out.get(f) ?? 0) + w / fams.length);
  }
  if (raw > 0) for (const [k, v] of out) out.set(k, v / raw);
  return out;
}

const HANGUL = /[가-힯]/;
const KANA = /[぀-ヿ]/;

export interface WorldChoice extends AlbumLanguage {
  /** The winning sound family (unqualified), or null when nothing resolves. */
  family: string | null;
  /** 0–1: how much of the decision came from the album's own tags. */
  albumStrength: number;
}

/** The album's family (by weighted evidence) and language. */
export function chooseWorld(input: PlacementInput): WorldChoice {
  const own: EvidenceTag[] = (input.genres ?? []).map((tag) => ({ tag }));
  const artist = input.artist ?? {};

  const itunesOwn = itunesTag(input.itunesGenre);
  const albumSources: [EvidenceTag[], number][] = [
    [own, 1],
    [itunesOwn ? [{ tag: itunesOwn }] : [], ITUNES_WEIGHT],
  ];
  const artistSources: [EvidenceTag[] | undefined, number][] = [
    [artist.catalog, 1],
    [artist.musicbrainz, 1],
    [artist.lastfm, 1],
    [artist.wikidata, 1],
    [artist.itunes, ITUNES_WEIGHT],
  ];

  const tally = (descriptors: boolean) => {
    const mass = new Map<string, number>();
    let got = 0;
    let had = 0;
    for (const [tags, w] of albumSources) {
      const d = familyDistribution(tags, descriptors);
      if (d.size === 0) continue;
      had += w;
      for (const [f, v] of d) {
        mass.set(f, (mass.get(f) ?? 0) + w * v);
        got += w * v;
      }
    }
    const strength = had > 0 ? got / had : 0;
    const lambda = PRIOR_LAMBDA + (1 - PRIOR_LAMBDA) * (1 - strength);
    for (const [tags, w] of artistSources) {
      for (const [f, v] of familyDistribution(tags, descriptors)) mass.set(f, (mass.get(f) ?? 0) + lambda * w * v);
    }
    return { mass, strength };
  };
  let { mass, strength } = tally(false);
  if (mass.size === 0) ({ mass, strength } = tally(true));

  // Highest mass wins; ties keep insertion order (the album's own tags first).
  let family: string | null = null;
  let best = 0;
  for (const [f, m] of mass) {
    if (m > best + 1e-12) {
      family = f;
      best = m;
    }
  }

  // Language: the album's tags; artist-level tags only when the artist's country is
  // unknown (Wikidata lists "samba" for Michael Jackson — a US act must never read
  // as Portuguese); the artist's name script when no native language is stored.
  const langTags = [...(input.genres ?? [])];
  if (!input.artistCountry) {
    for (const src of [artist.lastfm?.slice(0, 5), artist.musicbrainz, artist.wikidata]) {
      for (const t of src ?? []) {
        const id = resolveEvidenceTag(t.tag);
        if (id) langTags.push(id);
      }
    }
  }
  let nativeLanguage = input.artistNativeLanguage ?? null;
  if (!nativeLanguage && input.artistName) {
    if (HANGUL.test(input.artistName)) nativeLanguage = 'ko';
    else if (KANA.test(input.artistName)) nativeLanguage = 'ja';
  }
  const found = albumLanguage({ ...input, genres: langTags, artistNativeLanguage: nativeLanguage });
  let { lang, source } = found;
  // Last resort: the album shows no language of its own, but the artist's other
  // releases overwhelmingly do (Dominique A's Spirales: 37 of 39 French). A strict
  // share keeps bilingual artists (Lara Fabian, 46/72 French) unmarked.
  if (!lang) {
    const al = artistLanguage(input.artistReleaseLanguages);
    if (al) {
      lang = al;
      source = 'artist-releases';
    }
  }
  return { family, lang, source, albumStrength: strength };
}

/** The artist's dominant release language, or null (see ARTIST_LANGUAGE_*). */
export function artistLanguage(rl: ReleaseLanguages | null | undefined): string | null {
  if (!rl || rl.total < ARTIST_LANGUAGE_MIN_RELEASES) return null;
  let best: string | null = null;
  let n = 0;
  for (const [l, c] of Object.entries(rl.counts)) {
    if (c > n) {
      best = l;
      n = c;
    }
  }
  return best && n / rl.total >= ARTIST_LANGUAGE_MIN_SHARE ? best : null;
}

/** Tally ReleaseLanguages from an artist's other releases. */
export function releaseLanguages(
  releases: readonly { title?: string | null; nativeTitle?: string | null; titleLanguage?: string | null }[],
  artistCountry: string | null | undefined,
): ReleaseLanguages {
  const counts: Record<string, number> = {};
  for (const r of releases) {
    const l =
      fromTitleLanguage(r.titleLanguage) ?? scriptLanguage(r.nativeTitle ?? r.title ?? '', artistCountry ?? null);
    if (l) counts[l] = (counts[l] ?? 0) + 1;
  }
  return { total: releases.length, counts };
}

/** Tag counts over an artist's other albums — the `catalog` part of the prior. */
export function catalogEvidence(
  albums: readonly { genres: readonly string[] | null | undefined }[],
): EvidenceTag[] {
  const counts = new Map<string, number>();
  for (const a of albums) for (const g of new Set(a.genres ?? [])) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()].map(([tag, weight]) => ({ tag, weight }));
}
