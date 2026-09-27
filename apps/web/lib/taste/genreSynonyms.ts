/**
 * Genre-tag synonym merging — collapses near-duplicate spellings of the SAME
 * genre so the taste map doesn't show "k-pop", "kpop" and "korean pop" as three
 * separate sub-genre tiles (and so their rating weights combine into one honest
 * average).
 *
 * This is deliberately conservative: it only merges tags that are the *same
 * genre spelled differently*, never genres that are merely related.
 *
 * DERIVED FROM THE TAXONOMY (Phase 2, 2026-09-22): the primary merge key is the
 * canonical taxonomy node id — every tag that `resolveGenre` maps to the same
 * node (its id, aliases, and every fold/spacing variant of them) forms one
 * synonym group. The taxonomy's `aliases` are now the authoritative synonym
 * source. The old hand-maintained mechanisms are kept only as SAFETY NETS for
 * tags with no taxonomy node yet (the long tail):
 *   1. A **structural fold** (lowercase, strip every non-alphanumeric) — catches
 *      punctuation/spacing variants: k-pop / k pop / kpop, lo-fi / lofi, …
 *   2. A small **alias table** for word-level synonyms the fold can't see.
 *
 * The canonical spelling for each group is still the member with the highest
 * catalog support, so the canonical tag is always a real, embeddable, queryable
 * tag (NOT the node id — the embedding artifact is keyed on catalog spellings).
 *
 * Groups are built once from the embedding vocabulary (memoized). Server-only.
 */
import { genreSupport, genreVocab } from './embeddings';
import { resolveGenre } from '../genres/resolver';
import { NODE_BY_ID } from '../genres/taxonomy';

/** Strip case and every non-alphanumeric so "k-pop" / "k pop" / "kpop" collide. */
function fold(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Word-level synonym groups the structural fold can't merge on its own. Each
 * inner array is a set of *folded* forms that mean the same genre; the first
 * time any of them is seen, they're all unioned under one group id.
 */
const ALIAS_GROUPS: string[][] = [
  ['rb', 'rnb', 'randb', 'rhythmandblues'], // R&B
  ['kpop', 'koreanpop'],
  ['jpop', 'japanesepop'],
  ['jrock', 'japaneserock'],
  ['edm', 'electronicdancemusic'],
];

/** folded form → the alias-group representative it belongs to (or itself). */
const aliasOf = new Map<string, string>();
for (const group of ALIAS_GROUPS) {
  const rep = group[0];
  for (const f of group) aliasOf.set(f, rep);
}

/**
 * The merge key for a tag. Primary: the taxonomy node id it resolves to (so all
 * of a node's aliases/spellings merge into one group — the authoritative source).
 * Safety net (tag has no node): its alias-group rep, else its structural fold.
 */
function groupKey(tag: string): string {
  const id = resolveGenre(tag);
  if (id) return id;
  const f = fold(tag);
  return aliasOf.get(f) ?? f;
}

interface SynGroup {
  canonical: string;
  members: string[];
}

let GROUPS: Map<string, SynGroup> | null = null;

/** Build (once) the groupKey → {canonical, members} index over the catalog vocab. */
function groups(): Map<string, SynGroup> {
  if (GROUPS) return GROUPS;
  const byKey = new Map<string, string[]>();
  for (const tag of genreVocab()) {
    const key = groupKey(tag);
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(tag);
  }
  const out = new Map<string, SynGroup>();
  for (const [key, members] of byKey) {
    // Canonical = the most-supported spelling (guaranteed to have a vector).
    let canonical = members[0];
    let best = -1;
    for (const m of members) {
      const s = genreSupport(m);
      if (s > best) {
        best = s;
        canonical = m;
      }
    }
    out.set(key, { canonical, members });
  }
  GROUPS = out;
  return out;
}

/**
 * The canonical spelling of a genre tag — the dominant catalog spelling of its
 * synonym group. Tags with no known group (not in the vocab, no fold collision)
 * are returned trimmed-but-unchanged.
 */
export function canonicalize(tag: string): string {
  const g = groups().get(groupKey(tag));
  return g ? g.canonical : tag.trim();
}

/**
 * Every catalog spelling in a tag's synonym group (canonical included) — used to
 * expand a canonical tag back to all spellings for DB `genres` overlap queries,
 * so a recommendation tagged "kpop" still matches the canonical "k-pop".
 *
 * Sources unioned: the group members from the embedding vocab (raw spellings, in
 * the v1 raw-keyed artifact) AND the taxonomy node's own id + `aliases` (the
 * curated spellings). The taxonomy half is what keeps this correct when the
 * artifact is v2 (id-keyed): the vocab group then holds only the id, so the raw
 * DB spellings must come from the aliases.
 */
export function synonymsOf(tag: string): string[] {
  const out = new Set<string>();
  const g = groups().get(groupKey(tag));
  if (g) for (const m of g.members) out.add(m);
  const id = resolveGenre(tag);
  if (id) {
    out.add(id);
    const node = NODE_BY_ID.get(id);
    if (node) for (const a of node.aliases) out.add(a);
  }
  if (out.size === 0) out.add(tag.trim());
  return [...out];
}
