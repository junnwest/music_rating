/**
 * The genre RESOLVER — the one place a raw source tag becomes a canonical
 * taxonomy id, plus the graph walks every consumer will project from
 * (GENRE_TAXONOMY.md §3.2 / §3.4). Everything here is DERIVED from
 * `taxonomy.ts`; nothing is hand-maintained twice.
 *
 *   resolveGenre(rawTag) → genreId | null   normalize a source tag to a node id
 *   ancestorsOf(id)      → Set<genreId>     all sound + scene ancestors (excl. self)
 *   primaryOf(tags[])    → genreId | null   the album's primary genre (replaces PRECEDENCE)
 *
 * Deliberately dependency-light: imports ONLY the taxonomy, never the embedding
 * artifact or Postgres, so it is safe to use anywhere (client, server, scripts,
 * the ingest resolver). The alias map is built once and memoized.
 *
 * The fold matches genreSynonyms.ts EXACTLY (lowercase + strip every
 * non-alphanumeric) so that punctuation/spacing tail variants — "K-Pop",
 * "k pop", "kpop" — all land on the same node without needing an explicit
 * alias, and so the legacy synonym fold can stay a drop-in safety net.
 */
import { NODE_BY_ID, TAXONOMY, type GenreLevel } from './taxonomy';

/** Strip case and every non-alphanumeric so "k-pop" / "k pop" / "kpop" collide.
 *  MUST stay byte-for-byte identical to genreSynonyms.ts's fold. */
export function fold(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Specificity of a level for the primary walk; higher = more specific. */
const LEVEL_RANK: Record<GenreLevel, number> = { family: 0, genre: 1, subgenre: 2 };

/** folded form (id or alias) → canonical genre id. Built once. */
let ALIAS_MAP: Map<string, string> | null = null;

function aliasMap(): Map<string, string> {
  if (ALIAS_MAP) return ALIAS_MAP;
  const map = new Map<string, string>();
  // Node ids are authoritative: seed them first so an alias can never shadow an id.
  for (const node of TAXONOMY) map.set(fold(node.id), node.id);
  for (const node of TAXONOMY) {
    for (const a of node.aliases) {
      const f = fold(a);
      if (!f) continue;
      // taxonomy.ts is validated 1:1 under fold (invariant I4); the id-first seed
      // above means we only skip an alias that re-states its own node's id.
      if (!map.has(f)) map.set(f, node.id);
    }
  }
  ALIAS_MAP = map;
  return map;
}

/**
 * Normalize a raw source tag to its canonical taxonomy id, or null if the tag
 * has no node (the caller routes nulls to `genre_unmapped` — never drop them).
 *
 * Resolution is the structural fold against the id/alias set: exact id, then any
 * authored alias, then the fold catches the spacing/punctuation tail. Word-level
 * synonyms the fold can't see ("bollywood" → filmi, "rap" → hip-hop) must be
 * authored as `aliases` in taxonomy.ts — this function never guesses.
 */
export function resolveGenre(rawTag: string | null | undefined): string | null {
  if (!rawTag) return null;
  const f = fold(rawTag);
  if (!f) return null;
  return aliasMap().get(f) ?? null;
}

/**
 * Every ancestor of a node — both sound and scene parents, transitively —
 * excluding the node itself. Used for homepage category membership (a surface
 * node's row = node + all descendants, i.e. every node whose ancestor set
 * contains it) and scene derivation (does the set contain a scene root).
 * Safe on the multi-parent DAG: visited-guarded, so it terminates.
 */
export function ancestorsOf(id: string): Set<string> {
  const out = new Set<string>();
  const walk = (cur: string) => {
    const node = NODE_BY_ID.get(cur);
    if (!node) return;
    for (const p of [...node.soundParents, ...node.sceneParents]) {
      if (out.has(p)) continue;
      out.add(p);
      walk(p);
    }
  };
  walk(id);
  return out;
}

/**
 * The album's PRIMARY genre id: of the tags that resolve, the most specific one
 * — highest level (subgenre > genre > family), tie-broken by `rank` (higher
 * wins), then by tag order (first seen wins). This replaces the triplicated
 * PRECEDENCE list: the taxonomy's level + rank already encode "scene-qualified
 * > niche > specific > broad", so a [hip hop, k-pop, pop] album resolves to
 * k-pop (rank 5) and a [indie rock, rock, shoegaze] album to shoegaze (rank 4).
 *
 * Returns null when no tag resolves (caller decides the fallback — Phase 1 keeps
 * it additive and never invents a primary the taxonomy can't back).
 */
export function primaryOf(tags: readonly string[] | null | undefined): string | null {
  if (!tags?.length) return null;
  let bestId: string | null = null;
  let bestLevel = -1;
  let bestRank = -Infinity;
  for (const tag of tags) {
    const id = resolveGenre(tag);
    if (!id) continue;
    const node = NODE_BY_ID.get(id);
    if (!node) continue;
    const level = LEVEL_RANK[node.level];
    if (level > bestLevel || (level === bestLevel && node.rank > bestRank)) {
      bestId = id;
      bestLevel = level;
      bestRank = node.rank;
    }
  }
  return bestId;
}
