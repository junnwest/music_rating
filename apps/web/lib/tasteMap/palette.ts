/**
 * The map's color palette (genre lens): a handful of the user's own defining
 * tags, each given a hue, and every node's mix over them. Pure; runs in
 * payload.ts on the tags block, the client mixes the colors (lib/tasteMap/color.ts).
 *
 * Why adaptive and not one hue per family: most maps are mostly one or two
 * families (rock + pop), so family hues would paint nearly everything the same.
 * The palette is picked from what varies across THIS map:
 *
 *   1. Candidates: every tag dim except plain families and scene roots (the
 *      closure puts "rock" on every rock node, so it never tells two apart).
 *      A language-qualified family ("rock@ja") stays: it is a real world.
 *   2. Energy s_k = Σ_i mass_i · t_ik² (t = the node's L2-normalized tag block,
 *      so Σ_k t_ik² = 1 and t_ik² is node i's share of tag k).
 *   3. Greedy pick by energy, skipping a tag whose column (√mass_i · t_ik over
 *      nodes) has cosine > PICK_MAX_COS with one already picked: near-synonyms
 *      (britpop / brit rock) would waste a hue.
 *   3b. Rollups: a plain family never competes on its own column, but when the
 *      map has a pocket of artists that NO pick explains (Avicii and Fred
 *      again.. on a K-hip-hop / Brit-rock map: house, progressive house, UK
 *      garage, each tag too small to make the cut), the family they share is a
 *      real region of the map. Orphan energy = energy on candidate tags step 5
 *      would leave unassigned, summed per family they descend from (same
 *      language). When the biggest orphan family beats the weakest pick (or a
 *      slot is free), it takes that slot as a rollup hue and owns its
 *      descendants; up to MAX_ROLLUPS times. Data decides, so a rock+pop map
 *      never gets a "Rock" hue: its rock tags are already explained.
 *   4. Hue order: classical MDS of the picked tags (distance² = 2 − 2·cos), the
 *      angle of each tag in the top-2 plane sorts them around the color wheel,
 *      then hues are spaced evenly. Tags that co-occur get neighboring hues, so
 *      color distance tracks musical distance.
 *   5. Every other candidate dim is folded into a picked tag: a picked taxonomy
 *      ancestor in the same language first (boom-bap@ko → Korean Hip-Hop even
 *      when one artist is the only one carrying it, so the columns barely
 *      overlap), else the most similar picked tag when that cosine ≥
 *      ASSIGN_MIN_COS. A node's mix is its tag energy per palette tag. Energy on
 *      unassigned tags is left out, so a node that fits no palette tag mixes to
 *      gray.
 */
import { NODE_BY_ID } from '../genres/taxonomy';
import { ancestorsOf, isSceneRoot } from '../genres/resolver';
import { parseQualified, qualifiedInfo, qualify } from '../genres/language';
import type { FeatureSpace, NodeKey, PaletteHue } from './types';

export const PALETTE_SIZE = 8;
export const PICK_MAX_COS = 0.75;
export const ASSIGN_MIN_COS = 0.5;
/** A tag below this share of the total energy never gets a hue. */
export const MIN_ENERGY_SHARE = 0.01;
/** At most this many family rollups (step 3b). */
export const MAX_ROLLUPS = 2;
/** Hue of the first tag around the wheel (OKLCh degrees). */
export const HUE_START = 20;
const MIX_MIN = 0.02;

export interface Palette {
  hues: PaletteHue[];
  /** node key → palette tag id → share of the node's tag energy (sums to ≤ 1). */
  mix: Record<NodeKey, Record<string, number>>;
}

function isCandidate(id: string): boolean {
  if (id.includes('@')) return true;
  const info = qualifiedInfo(id);
  return !info || info.level !== 'family';
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The plain taxonomy ids a (qualified) tag stands for: k-rap → {k-rap, hip-hop}, rock@ko → {rock}. */
function basesOf(id: string): string[] {
  const plain = parseQualified(id)?.base ?? id;
  return [plain, ...(NODE_BY_ID.get(plain)?.localizes ?? [])];
}

/** A tag's language and every plain id it descends from, itself included. */
function lineageOf(id: string): { lang: string | null; ids: Set<string> } {
  const ids = new Set<string>();
  for (const b of basesOf(id)) {
    ids.add(b);
    for (const a of ancestorsOf(b)) ids.add(a);
  }
  return { lang: qualifiedInfo(id)?.lang ?? null, ids };
}

/** True when picked tag `p` is a taxonomy ancestor of `t` in t's language (or p is language-free). */
function covers(p: string, t: string): boolean {
  const pl = qualifiedInfo(p)?.lang ?? null;
  const tl = lineageOf(t);
  if (pl !== null && pl !== tl.lang) return false;
  return basesOf(p).some((b) => tl.ids.has(b));
}

/** Plain families `t` descends from, in t's language (house → electronic, boom-bap@ko → hip-hop@ko). */
function familiesOf(id: string): string[] {
  const { lang, ids } = lineageOf(id);
  const out = new Set<string>();
  for (const a of ids) {
    if (NODE_BY_ID.get(a)?.level !== 'family' || isSceneRoot(a)) continue;
    out.add(qualify(a, lang));
  }
  return [...out];
}

/** Top-2 eigenvectors of a small symmetric matrix (power iteration + deflation), sign-fixed. */
function top2(B: number[][]): [number[], number[]] {
  const n = B.length;
  const M = B.map((r) => [...r]);
  const out: number[][] = [];
  for (let e = 0; e < 2; e++) {
    let v = Array.from({ length: n }, (_, i) => 1 + i / n);
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = M.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      const nn = Math.hypot(...w);
      if (!(nn > 1e-12)) {
        v = v.map(() => 0);
        break;
      }
      v = w.map((x) => x / nn);
      lambda = nn;
    }
    // Largest |component| positive, so the order doesn't flip between runs.
    let big = 0;
    for (let i = 1; i < n; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
    if (v[big] < 0) v = v.map((x) => -x);
    out.push(v.map((x) => x * Math.sqrt(Math.max(lambda, 0))));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] -= lambda * v[i] * v[j];
  }
  return [out[0], out[1]];
}

export function buildPalette(space: FeatureSpace, size = PALETTE_SIZE): Palette {
  const { nodes, tagDims } = space;
  const dims = tagDims.length;
  const mix: Palette['mix'] = Object.fromEntries(nodes.map((n) => [n.key, {}]));
  if (!dims || !nodes.length) return { hues: [], mix };

  const cand = tagDims.map((d) => isCandidate(d.id));
  // Weighted columns: col[k][i] = √mass_i · t_ik. Rollups (3b) append virtual
  // columns past `dims`; ids / labels cover both.
  const ids = tagDims.map((d) => d.id);
  const labels = tagDims.map((d) => d.label);
  const col: Float64Array[] = tagDims.map(() => new Float64Array(nodes.length));
  const energy: number[] = new Array(dims).fill(0);
  nodes.forEach((n, i) => {
    if (!n.has.tags) return;
    const sw = Math.sqrt(Math.max(n.mass, 0));
    const t = n.blocks.tags;
    for (let k = 0; k < dims; k++) {
      const x = t[k] ?? 0;
      if (!x || !cand[k]) continue;
      col[k][i] = sw * x;
      energy[k] += sw * sw * x * x;
    }
  });
  const colNorm = col.map((c) => Math.sqrt(c.reduce((s, x) => s + x * x, 0)));
  const cos = (a: number, b: number) => {
    if (!(colNorm[a] > 0) || !(colNorm[b] > 0)) return 0;
    let s = 0;
    const ca = col[a];
    const cb = col[b];
    for (let i = 0; i < ca.length; i++) s += ca[i] * cb[i];
    return s / (colNorm[a] * colNorm[b]);
  };

  const total = energy.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return { hues: [], mix };
  const order = [...energy.keys()]
    .filter((k) => cand[k] && energy[k] >= MIN_ENERGY_SHARE * total)
    .sort((a, b) => energy[b] - energy[a] || (ids[a] < ids[b] ? -1 : 1));
  let picked: number[] = [];
  for (const k of order) {
    if (picked.length >= size) break;
    if (picked.some((j) => cos(k, j) > PICK_MAX_COS)) continue;
    picked.push(k);
  }

  // Step 5: the picked index owning each candidate dim (−1 = unassigned).
  const ownersFor = (pk: number[]): Int32Array => {
    const owner = new Int32Array(dims).fill(-1);
    for (let k = 0; k < dims; k++) {
      if (!cand[k] || !(energy[k] > 0)) continue;
      const self = pk.indexOf(k);
      if (self >= 0) {
        owner[k] = self;
        continue;
      }
      // Same-language ancestors beat a language-free one (indie-rock@ja → J-Rock
      // over Alternative Rock), a real tag beats a rollup, then the more similar
      // column wins.
      const ancestors = pk
        .map((j, pi) => ({ pi, c: cos(k, j), same: qualifiedInfo(ids[j])?.lang != null, real: j < dims }))
        .filter(({ pi }) => covers(ids[pk[pi]], ids[k]));
      if (ancestors.length) {
        ancestors.sort((x, y) => Number(y.same) - Number(x.same) || Number(y.real) - Number(x.real) || y.c - x.c);
        owner[k] = ancestors[0].pi;
        continue;
      }
      let best = -1;
      let bestCos = ASSIGN_MIN_COS;
      pk.forEach((j, pi) => {
        if (j >= dims) return;
        const c = cos(k, j);
        if (c >= bestCos) {
          bestCos = c;
          best = pi;
        }
      });
      owner[k] = best;
    }
    return owner;
  };

  // 3b. Rollups: a family that explains a pocket of otherwise-gray artists.
  const famCache = new Map<number, string[]>();
  const fams = (k: number) => {
    if (!famCache.has(k)) famCache.set(k, familiesOf(ids[k]));
    return famCache.get(k)!;
  };
  for (let round = 0; round < MAX_ROLLUPS; round++) {
    const owner = ownersFor(picked);
    const orphan = new Map<string, number>();
    for (let k = 0; k < dims; k++) {
      if (owner[k] >= 0 || !cand[k] || !(energy[k] > 0)) continue;
      for (const f of fams(k)) orphan.set(f, (orphan.get(f) ?? 0) + energy[k]);
    }
    const best = [...orphan]
      // A qualified family (rock@ko) is a candidate and competed in step 3.
      .filter(([f]) => !picked.some((j) => ids[j] === f) && !cand[ids.indexOf(f)])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (!best || best[1] < MIN_ENERGY_SHARE * total) break;
    const real = picked.filter((j) => j < dims);
    const weakest = real.length ? real.reduce((a, b) => (energy[b] < energy[a] ? b : a)) : -1;
    if (picked.length >= size) {
      if (!(weakest >= 0 && best[1] > energy[weakest])) break;
      picked = picked.filter((j) => j !== weakest);
    }
    // The rollup's column: √mass_i · √(node i's share on its orphan tags).
    const [fam, e] = best;
    const v = new Float64Array(nodes.length);
    for (let k = 0; k < dims; k++) {
      if (owner[k] >= 0 || !cand[k] || !fams(k).includes(fam)) continue;
      for (let i = 0; i < nodes.length; i++) v[i] += col[k][i] * col[k][i];
    }
    for (let i = 0; i < v.length; i++) v[i] = Math.sqrt(v[i]);
    ids.push(fam);
    labels.push(tagDims.find((d) => d.id === fam)?.label ?? qualifiedInfo(fam)?.display.en ?? fam);
    col.push(v);
    colNorm.push(Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
    energy.push(e);
    picked.push(ids.length - 1);
  }
  if (!picked.length) return { hues: [], mix };
  // The strongest pick anchors the wheel.
  picked.sort((a, b) => energy[b] - energy[a] || (ids[a] < ids[b] ? -1 : 1));

  // Around the wheel by classical MDS: B = −½ J D² J with D² = 2 − 2C.
  const m = picked.length;
  let angleOf: number[] = picked.map((_, i) => i);
  if (m >= 3) {
    const D2 = picked.map((a) => picked.map((b) => (a === b ? 0 : 2 - 2 * cos(a, b))));
    const rowMean = D2.map((r) => r.reduce((s, x) => s + x, 0) / m);
    const all = rowMean.reduce((s, x) => s + x, 0) / m;
    const B = D2.map((r, i) => r.map((x, j) => -0.5 * (x - rowMean[i] - rowMean[j] + all)));
    const [e1, e2] = top2(B);
    angleOf = picked.map((_, i) => Math.atan2(e2[i], e1[i]));
  }
  // Start the wheel at the strongest tag so the biggest region keeps HUE_START.
  const a0 = angleOf[0];
  const wheel = picked
    .map((k, i) => ({ k, a: (((angleOf[i] - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }))
    .sort((x, y) => x.a - y.a || x.k - y.k);
  const hues: PaletteHue[] = wheel.map(({ k }, r) => ({
    id: ids[k],
    label: labels[k],
    hue: Math.round((HUE_START + (360 * r) / m) % 360),
  }));

  // Fold the other candidate dims into their closest picked tag.
  const owner = ownersFor(picked);
  for (const n of nodes) {
    if (!n.has.tags) continue;
    const t = n.blocks.tags;
    let all = 0;
    const acc = new Float64Array(m);
    for (let k = 0; k < dims; k++) {
      const x = t[k] ?? 0;
      if (!x || !cand[k]) continue;
      all += x * x;
      if (owner[k] >= 0) acc[owner[k]] += x * x;
    }
    if (!(all > 0)) continue;
    const rec: Record<string, number> = {};
    acc.forEach((x, pi) => {
      const share = x / all;
      if (share >= MIX_MIN) rec[ids[picked[pi]]] = round3(share);
    });
    mix[n.key] = rec;
  }
  return { hues, mix };
}
