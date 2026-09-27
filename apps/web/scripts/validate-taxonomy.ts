/**
 * Build-time validator for the canonical genre taxonomy (GENRE_TAXONOMY.md §3.1).
 * Enforces every invariant, then reports catalog coverage of the authored head.
 * Exit 1 on any hard failure — safe to wire into CI.
 *
 * Invariants:
 *   I1  every id unique
 *   I2  every parent id (sound + scene) exists
 *   I3  no sound-parent cycle
 *   I4  alias→id map is 1:1 (folded); no alias claimed by two nodes; no alias
 *       collides with a different node's id
 *   I5  single-subgenre collapse: no genre has exactly ONE subgenre child
 *   I6  level/parent shape: family has no sound parents; a genre's sound parents
 *       are families; a subgenre's sound parents are genres; scene parents are
 *       always isScene nodes; families are not surfaced via sound unless intended
 *   I7  every node's scene set is derivable (ancestor walk terminates)
 *   I8  display.en / display.ko non-empty
 *
 * Run (from apps/web/):
 *   npx tsx scripts/validate-taxonomy.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NODE_BY_ID, TAXONOMY, type GenreNode } from '../lib/genres/taxonomy';

const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── I1: unique ids ──────────────────────────────────────────────────────────
{
  const seen = new Set<string>();
  for (const node of TAXONOMY) {
    if (seen.has(node.id)) fail(`I1 duplicate id: ${node.id}`);
    seen.add(node.id);
  }
}

// ── I2: parents exist ───────────────────────────────────────────────────────
for (const node of TAXONOMY) {
  for (const p of node.soundParents) if (!NODE_BY_ID.has(p)) fail(`I2 ${node.id}: missing soundParent ${p}`);
  for (const p of node.sceneParents) if (!NODE_BY_ID.has(p)) fail(`I2 ${node.id}: missing sceneParent ${p}`);
}

// ── I3: no sound-parent cycle ───────────────────────────────────────────────
{
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string, stack: string[]) => {
    color.set(id, GREY);
    const node = NODE_BY_ID.get(id);
    for (const p of node?.soundParents ?? []) {
      const c = color.get(p) ?? WHITE;
      if (c === GREY) fail(`I3 sound cycle: ${[...stack, id, p].join(' → ')}`);
      else if (c === WHITE) visit(p, [...stack, id]);
    }
    color.set(id, BLACK);
  };
  for (const node of TAXONOMY) if ((color.get(node.id) ?? WHITE) === WHITE) visit(node.id, []);
}

// ── I4: alias map 1:1 ───────────────────────────────────────────────────────
{
  const aliasOwner = new Map<string, string>();
  const idFolds = new Map<string, string>(); // folded id → id
  for (const node of TAXONOMY) idFolds.set(fold(node.id), node.id);
  for (const node of TAXONOMY) {
    for (const a of node.aliases) {
      const f = fold(a);
      if (!f) { fail(`I4 ${node.id}: empty alias`); continue; }
      const prev = aliasOwner.get(f);
      if (prev && prev !== node.id) fail(`I4 alias "${a}" (${f}) claimed by both ${prev} and ${node.id}`);
      aliasOwner.set(f, node.id);
      const idOwner = idFolds.get(f);
      if (idOwner && idOwner !== node.id) fail(`I4 alias "${a}" collides with node id ${idOwner} (owned by ${node.id})`);
    }
  }
}

// ── I5: single-subgenre collapse ────────────────────────────────────────────
{
  const subCount = new Map<string, number>(); // genre id → # subgenre children
  for (const node of TAXONOMY) {
    if (node.level !== 'subgenre') continue;
    for (const p of node.soundParents) {
      const parent = NODE_BY_ID.get(p);
      if (parent?.level === 'genre') subCount.set(p, (subCount.get(p) ?? 0) + 1);
    }
  }
  for (const [genre, count] of subCount) {
    if (count === 1) fail(`I5 genre "${genre}" has exactly one subgenre child — promote it (collapse rule)`);
  }
}

// ── I6: level/parent shape ──────────────────────────────────────────────────
for (const node of TAXONOMY) {
  if (node.level === 'family') {
    if (node.soundParents.length) fail(`I6 family ${node.id} must have no soundParents`);
  }
  if (node.level === 'genre') {
    if (node.soundParents.length === 0) fail(`I6 genre ${node.id} needs ≥1 soundParent`);
    for (const p of node.soundParents) {
      const parent = NODE_BY_ID.get(p);
      if (parent && parent.level !== 'family') fail(`I6 genre ${node.id}: soundParent ${p} must be a family, is ${parent.level}`);
      if (parent?.isScene) fail(`I6 genre ${node.id}: ${p} is a scene root — use sceneParents`);
    }
  }
  if (node.level === 'subgenre') {
    if (node.soundParents.length === 0) fail(`I6 subgenre ${node.id} needs ≥1 soundParent`);
    for (const p of node.soundParents) {
      const parent = NODE_BY_ID.get(p);
      if (parent && parent.level !== 'genre') fail(`I6 subgenre ${node.id}: soundParent ${p} must be a genre, is ${parent.level}`);
    }
  }
  for (const p of node.sceneParents) {
    const parent = NODE_BY_ID.get(p);
    if (parent && !parent.isScene) fail(`I6 ${node.id}: sceneParent ${p} is not a scene root`);
  }
  if (node.isScene && node.level !== 'family') fail(`I6 scene root ${node.id} must be level:'family'`);
}

// ── I7: scene set derivable (ancestor walk terminates; multi-parent DAG) ─────
function sceneSet(id: string): Set<string> {
  const scenes = new Set<string>();
  const seen = new Set<string>();
  const walk = (cur: string) => {
    if (seen.has(cur)) return;
    seen.add(cur);
    const node = NODE_BY_ID.get(cur);
    if (!node) return;
    for (const s of node.sceneParents) {
      const sr = NODE_BY_ID.get(s);
      if (sr?.isScene) scenes.add(sr.id);
      walk(s);
    }
    for (const p of node.soundParents) walk(p);
  };
  walk(id);
  return scenes;
}
for (const node of TAXONOMY) {
  try { sceneSet(node.id); } catch { fail(`I7 ${node.id}: scene walk did not terminate`); }
}

// ── I8: display strings ─────────────────────────────────────────────────────
for (const node of TAXONOMY) {
  if (!node.display.en?.trim()) fail(`I8 ${node.id}: empty display.en`);
  if (!node.display.ko?.trim()) fail(`I8 ${node.id}: empty display.ko`);
  if (node.display.ko === node.display.en && node.level !== 'family') warn(`ko == en (first-pass) for ${node.id}`);
}

// ── Report + coverage ───────────────────────────────────────────────────────
const byLevel = (lvl: GenreNode['level']) => TAXONOMY.filter((n) => n.level === lvl && !n.isScene).length;
console.log('\n🎼  Taxonomy validation\n');
console.log(`Nodes: ${TAXONOMY.length}  (families ${byLevel('family')}, genres ${byLevel('genre')}, subgenres ${byLevel('subgenre')}, scene roots ${TAXONOMY.filter((n) => n.isScene).length})`);
console.log(`Surface nodes: ${TAXONOMY.filter((n) => n.surface).length}\n`);

// Alias fold set → catalog coverage against the vocab dump (if present).
try {
  const tsv = resolve(process.cwd(), '..', '..', 'GENRE_VOCAB_DUMP.tsv');
  const rows = readFileSync(tsv, 'utf8').split('\n').filter(Boolean).slice(1)
    .map((l) => { const [rank, tag, support] = l.split('\t'); return { rank: +rank, tag, support: +support }; });
  const resolvable = new Set<string>();
  for (const node of TAXONOMY) { resolvable.add(fold(node.id)); for (const a of node.aliases) resolvable.add(fold(a)); }
  const covered = (r: { tag: string }) => resolvable.has(fold(r.tag));
  const head = rows.slice(0, 150);
  const cov = (list: typeof rows) => {
    const c = list.filter(covered);
    const supAll = list.reduce((s, r) => s + r.support, 0);
    const supC = c.reduce((s, r) => s + r.support, 0);
    return { tags: `${c.length}/${list.length}`, support: `${((supC / supAll) * 100).toFixed(1)}%` };
  };
  const h = cov(head), all = cov(rows);
  console.log(`Catalog coverage (tag resolves to a taxonomy node by id/alias fold):`);
  console.log(`  top 150 tags:  ${h.tags} tags, ${h.support} of head support`);
  console.log(`  all 1009 tags: ${all.tags} tags, ${all.support} of total support`);
  const missHead = head.filter((r) => !covered(r));
  if (missHead.length) {
    console.log(`\n  Uncovered head tags (${missHead.length}) — fold via resolver safety net or add a node/alias:`);
    for (const r of missHead) console.log(`    #${String(r.rank).padStart(3)} ${r.tag.padEnd(28)} support ${r.support}`);
  }
} catch {
  console.log('(GENRE_VOCAB_DUMP.tsv not found — run scripts/dump-genre-vocab.ts --write for coverage)');
}

console.log('');
if (warnings.length) console.log(`⚠  ${warnings.length} warning(s) (non-fatal): e.g. ${warnings.slice(0, 3).join(' | ')}${warnings.length > 3 ? ' …' : ''}\n`);
if (errors.length) {
  console.error(`❌ ${errors.length} invariant failure(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log('✅ All invariants hold.\n');
