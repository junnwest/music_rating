/**
 * The map's political layer (TASTE_MAP_PLAN.md §8 slice 2.3–2.4): countries,
 * their names and the bridges between them. Pure; client-side, computed from
 * the payload's kNN `neighbors`, so it needs no payload change and follows the
 * visible groups.
 *
 * - Graph: the kNN lists symmetrized, w_ij = max(sim_ij, sim_ji), sim > 0.
 * - communities: Louvain modularity at RESOLUTION (local moves, then aggregate),
 *   then every community split into its connected pieces (the guarantee Leiden
 *   adds over Louvain: no country is two islands glued by modularity), and
 *   singletons merged into their strongest neighbor's community. Deterministic:
 *   nodes are visited in key order.
 * - betweenness: Brandes on the same graph with distance 1 − w, normalized by
 *   the undirected pair count, so 1 = on every shortest path.
 * - bridges: nodes on many shortest paths whose own neighbors sit in at least
 *   one other country. The "bridge picks" of the direction doc: the artists
 *   your taste crosses over through.
 * - countryLinks: per pair of countries, the summed weight of the edges between
 *   them, drawn as one bundled arc instead of many crossing lines.
 * - regionFields: a density-clipped Voronoi (GMap) as smooth fields. For each
 *   country c, f_c = min(K_c − max_{c'≠c} K_c', D − REGION_MIN_DENSITY), with K_c
 *   the Gaussian kernel sum of c's members and D = Σ K. The 0-contour of f_c is
 *   c's territory: where c is the strongest presence and the map is dense
 *   enough to claim land. Borders between neighbors fall where both are equal.
 */
import type { Neighbor, NodeKey, PaletteHue } from './types';

/**
 * Louvain resolution. 1 merges a 30-artist map into ~3 continents; 2 gives the
 * genre-scene countries (measured on zero, 2026-11-04). Pruning weak kNN edges
 * instead splits the graph into islands and leaves no bridges.
 */
export const RESOLUTION = 2;
export const BRIDGE_MIN = 0.12;
export const MAX_BRIDGES = 5;
export const REGION_MIN_DENSITY = 0.22;

type Graph = Map<NodeKey, Map<NodeKey, number>>;

/**
 * A node in at least this share of the other nodes' kNN lists (and in more
 * than HUB_K_FACTOR × k of them) is a hub: it keeps only mutual edges.
 */
export const HUB_SHARE = 0.6;
export const HUB_K_FACTOR = 3;

/**
 * Hubness guard: a node with little evidence (an untagged artist with only the
 * era block) is ~1.0 similar to everyone from its era, lands in every list and
 * would be every country's bridge. A hub keeps an edge only when the other node
 * is in its own list too (mutual kNN, the standard hubness reduction).
 */
export function knnGraph(neighbors: Record<NodeKey, Neighbor[]>, keep: Set<NodeKey>): Graph {
  const g: Graph = new Map();
  for (const k of [...keep].sort()) g.set(k, new Map());
  const listed = (a: NodeKey) => (neighbors[a] ?? []).filter((nb) => nb.key !== a && g.has(nb.key) && nb.sim > 0);
  const inDeg = new Map<NodeKey, number>();
  let k = 0;
  for (const a of g.keys()) {
    const l = listed(a);
    k = Math.max(k, l.length);
    for (const nb of l) inDeg.set(nb.key, (inDeg.get(nb.key) ?? 0) + 1);
  }
  const hubMin = Math.max(HUB_K_FACTOR * k, HUB_SHARE * (g.size - 1));
  const hub = (x: NodeKey) => (inDeg.get(x) ?? 0) >= hubMin;
  const mutual = (x: NodeKey, y: NodeKey) => listed(x).some((nb) => nb.key === y) && listed(y).some((nb) => nb.key === x);
  for (const a of g.keys()) {
    for (const nb of listed(a)) {
      if ((hub(a) || hub(nb.key)) && !mutual(a, nb.key)) continue;
      const w = Math.max(nb.sim, g.get(a)!.get(nb.key) ?? 0);
      g.get(a)!.set(nb.key, w);
      g.get(nb.key)!.set(a, w);
    }
  }
  return g;
}

/** One Louvain level over integer nodes; returns each node's community (0..c-1, by first appearance). */
function louvainLevel(adj: Map<number, number>[], selfW: number[], gamma: number): number[] {
  const n = adj.length;
  const deg = adj.map((m, i) => [...m.values()].reduce((s, x) => s + x, 0) + 2 * selfW[i]);
  const m2 = deg.reduce((s, x) => s + x, 0);
  const comm = Array.from({ length: n }, (_, i) => i);
  if (!(m2 > 0)) return comm;
  const tot = [...deg];
  let moved = true;
  for (let pass = 0; moved && pass < 50; pass++) {
    moved = false;
    for (let i = 0; i < n; i++) {
      const ci = comm[i];
      const links = new Map<number, number>();
      for (const [j, w] of adj[i]) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
      tot[ci] -= deg[i];
      let best = ci;
      let bestGain = (links.get(ci) ?? 0) - (gamma * tot[ci] * deg[i]) / m2;
      for (const [c, w] of [...links].sort((x, y) => x[0] - y[0])) {
        const gain = w - (gamma * tot[c] * deg[i]) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          best = c;
        }
      }
      tot[best] += deg[i];
      if (best !== ci) {
        comm[i] = best;
        moved = true;
      }
    }
  }
  const relabel = new Map<number, number>();
  return comm.map((c) => {
    if (!relabel.has(c)) relabel.set(c, relabel.size);
    return relabel.get(c)!;
  });
}

/** Node → community index, 0 = the community with the most total mass. */
export function communities(g: Graph, mass: (k: NodeKey) => number = () => 1, gamma = RESOLUTION): Map<NodeKey, number> {
  const keys = [...g.keys()];
  const idx = new Map(keys.map((k, i) => [k, i]));
  // Louvain: levels until nothing merges.
  let member = keys.map((_, i) => i);
  let adj: Map<number, number>[] = keys.map((k) => new Map([...g.get(k)!].map(([o, w]) => [idx.get(o)!, w])));
  let selfW = keys.map(() => 0);
  for (let level = 0; level < 10; level++) {
    const c = louvainLevel(adj, selfW, gamma);
    const count = Math.max(-1, ...c) + 1;
    if (count === adj.length) break;
    member = member.map((x) => c[x]);
    const next: Map<number, number>[] = Array.from({ length: count }, () => new Map());
    const nextSelf = new Array(count).fill(0);
    adj.forEach((m, i) => {
      nextSelf[c[i]] += selfW[i];
      for (const [j, w] of m) {
        if (c[i] === c[j]) nextSelf[c[i]] += w / 2;
        else next[c[i]].set(c[j], (next[c[i]].get(c[j]) ?? 0) + w);
      }
    });
    adj = next;
    selfW = nextSelf;
  }
  // Split each community into connected pieces.
  const piece = new Array(keys.length).fill(-1);
  let pieces = 0;
  for (let s = 0; s < keys.length; s++) {
    if (piece[s] >= 0) continue;
    const stack = [s];
    piece[s] = pieces;
    while (stack.length) {
      const i = stack.pop()!;
      for (const o of g.get(keys[i])!.keys()) {
        const j = idx.get(o)!;
        if (piece[j] < 0 && member[j] === member[s]) {
          piece[j] = pieces;
          stack.push(j);
        }
      }
    }
    pieces++;
  }
  // Singletons join their strongest neighbor's piece.
  const size = new Array(pieces).fill(0);
  piece.forEach((p) => size[p]++);
  keys.forEach((k, i) => {
    if (size[piece[i]] !== 1) return;
    let best = -1;
    let bw = 0;
    for (const [o, w] of g.get(k)!) {
      const p = piece[idx.get(o)!];
      if (w > bw && size[p] > 1) {
        bw = w;
        best = p;
      }
    }
    if (best >= 0) {
      size[piece[i]]--;
      piece[i] = best;
      size[best]++;
    }
  });
  // Order by mass, heaviest first.
  const massOf = new Map<number, number>();
  keys.forEach((k, i) => massOf.set(piece[i], (massOf.get(piece[i]) ?? 0) + mass(k)));
  const order = [...massOf.keys()].sort((a, b) => massOf.get(b)! - massOf.get(a)! || a - b);
  const rank = new Map(order.map((p, r) => [p, r]));
  return new Map(keys.map((k, i) => [k, rank.get(piece[i])!]));
}

/** Brandes betweenness with distance 1 − w, normalized to 0–1 by the undirected pair count. */
export function betweenness(g: Graph): Map<NodeKey, number> {
  const keys = [...g.keys()];
  const n = keys.length;
  const idx = new Map(keys.map((k, i) => [k, i]));
  const adj = keys.map((k) => [...g.get(k)!].map(([o, w]) => ({ j: idx.get(o)!, d: Math.max(0.02, 1 - w) })));
  const cb = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const dist = new Float64Array(n).fill(Infinity);
    const sigma = new Float64Array(n);
    const pred: number[][] = Array.from({ length: n }, () => []);
    const done = new Uint8Array(n);
    const stack: number[] = [];
    dist[s] = 0;
    sigma[s] = 1;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = 1;
      stack.push(u);
      for (const { j, d } of adj[u]) {
        const nd = dist[u] + d;
        if (nd < dist[j] - 1e-12) {
          dist[j] = nd;
          sigma[j] = sigma[u];
          pred[j] = [u];
        } else if (Math.abs(nd - dist[j]) <= 1e-12) {
          sigma[j] += sigma[u];
          pred[j].push(u);
        }
      }
    }
    const delta = new Float64Array(n);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) cb[w] += delta[w];
    }
  }
  // Each pair was counted from both ends.
  const pairs = ((n - 1) * (n - 2)) / 2;
  return new Map(keys.map((k, i) => [k, pairs > 0 ? cb[i] / 2 / pairs : 0]));
}

export interface Bridge {
  key: NodeKey;
  score: number;
  /** Countries it links: its own first, then the others its neighbors live in, strongest first. */
  countries: number[];
}

export interface Country {
  id: number;
  /** Its genre's name, shared by every country in the same realm. */
  name: string;
  /** Province name (its most central artists) when its realm has other countries too; else null. */
  sub: string | null;
  /** Index into `Atlas.realms`. */
  realm: number;
  /** Hue of the palette tag it is named after, null when named another way. */
  hue: number | null;
  members: NodeKey[];
  mass: number;
}

export interface CountryLink {
  a: number;
  b: number;
  w: number;
}

/** Countries that share a genre name: one name on the map, provinces inside. */
export interface Realm {
  id: number;
  name: string;
  hue: number | null;
  /** Country ids, heaviest first. */
  countries: number[];
  mass: number;
}

export interface Atlas {
  countryOf: Map<NodeKey, number>;
  countries: Country[];
  realms: Realm[];
  bridges: Map<NodeKey, Bridge>;
  links: CountryLink[];
}

export interface AtlasNode {
  key: NodeKey;
  label: string;
  mass: number;
  mix?: Record<string, number>;
  groups: Record<string, number>;
}

/**
 * Countries, bridges and bundled links for the visible nodes. Names: the
 * palette tag with the most mass-weighted mix among members; when the palette
 * explains little of it, the dominant group; else the heaviest artist.
 * Countries with one name form a realm (named once on the map); each is then a
 * province named by its most central artist.
 */
export function buildAtlas(
  nodes: AtlasNode[],
  neighbors: Record<NodeKey, Neighbor[]>,
  keep: Set<NodeKey>,
  palette: PaletteHue[] | undefined,
  groupNames: Record<string, string>,
): Atlas {
  const byKey = new Map(nodes.filter((n) => keep.has(n.key)).map((n) => [n.key, n]));
  const g = knnGraph(neighbors, new Set(byKey.keys()));
  const countryOf = communities(g, (k) => byKey.get(k)?.mass ?? 1);
  const count = Math.max(-1, ...countryOf.values()) + 1;

  const members: NodeKey[][] = Array.from({ length: count }, () => []);
  for (const [k, c] of countryOf) members[c].push(k);
  const named = members.map((ks) => {
    const tags = new Map<string, number>();
    const groups = new Map<string, number>();
    let mass = 0;
    let colored = 0;
    for (const k of ks) {
      const n = byKey.get(k)!;
      mass += n.mass;
      for (const [t, s] of Object.entries(n.mix ?? {})) {
        tags.set(t, (tags.get(t) ?? 0) + n.mass * s);
        colored += n.mass * s;
      }
      for (const [gid, s] of Object.entries(n.groups)) groups.set(gid, (groups.get(gid) ?? 0) + n.mass * s);
    }
    const byShare = <T>(m: Map<T, number>) => [...m].sort((a, b) => b[1] - a[1] || (String(a[0]) < String(b[0]) ? -1 : 1));
    const t = byShare(tags);
    const hueOf = (id: string) => palette?.find((p) => p.id === id);
    const top = t[0] && colored >= 0.4 * mass ? hueOf(t[0][0]) : undefined;
    const grp = byShare(groups)[0];
    const heaviest = [...ks].sort((a, b) => byKey.get(b)!.mass - byKey.get(a)!.mass || (a < b ? -1 : 1))[0];
    const name = top?.label ?? (grp ? groupNames[grp[0]] : undefined) ?? byKey.get(heaviest)!.label;
    return { name, hue: top?.hue ?? null, mass, members: ks };
  });
  // Realms: countries with one genre name share it (Louvain splits a big scene
  // into several communities; the map names the scene once). Each country in a
  // shared realm is a province, named by its most central artists.
  const realmOfName = new Map<string, number>();
  const realms: Realm[] = [];
  named.forEach((c, id) => {
    let r = realmOfName.get(c.name);
    if (r == null) {
      r = realms.length;
      realmOfName.set(c.name, r);
      realms.push({ id: r, name: c.name, hue: c.hue, countries: [], mass: 0 });
    }
    realms[r].countries.push(id);
    realms[r].mass += c.mass;
  });
  const central = (ks: NodeKey[]) => {
    const own = new Set(ks);
    const score = (k: NodeKey) => {
      let d = 0;
      for (const [o, w] of g.get(k) ?? []) if (own.has(o)) d += w;
      return d * (0.5 + Math.sqrt(byKey.get(k)!.mass));
    };
    const labels: string[] = [];
    for (const k of [...ks].sort((a, b) => score(b) - score(a) || byKey.get(b)!.mass - byKey.get(a)!.mass || (a < b ? -1 : 1))) {
      const l = byKey.get(k)!.label;
      if (!labels.includes(l)) labels.push(l);
    }
    return labels;
  };
  const sub = new Array<string | null>(named.length).fill(null);
  for (const r of realms) {
    if (r.countries.length < 2) continue;
    const ranked = r.countries.map((id) => central(named[id].members));
    // One artist each, a second where two provinces would otherwise share a name.
    r.countries.forEach((id, i) => {
      const first = ranked[i][0];
      const clash = ranked.some((o, j) => j !== i && o[0] === first);
      sub[id] = clash && ranked[i][1] ? `${first} · ${ranked[i][1]}` : first;
    });
    r.countries.sort((a, b) => named[b].mass - named[a].mass || a - b);
  }
  const countries: Country[] = named.map((c, id) => ({
    id,
    name: c.name,
    sub: sub[id],
    realm: realmOfName.get(c.name)!,
    hue: c.hue,
    members: c.members,
    mass: c.mass,
  }));

  // Bundled links.
  const linkW = new Map<string, number>();
  for (const [a, m] of g)
    for (const [b, w] of m) {
      const ca = countryOf.get(a)!;
      const cbb = countryOf.get(b)!;
      if (a < b && ca !== cbb) {
        const id = ca < cbb ? `${ca}|${cbb}` : `${cbb}|${ca}`;
        linkW.set(id, (linkW.get(id) ?? 0) + w);
      }
    }
  const links = [...linkW].map(([id, w]) => {
    const [a, b] = id.split('|').map(Number);
    return { a, b, w };
  });

  // Bridges.
  const bc = betweenness(g);
  const bridges = new Map<NodeKey, Bridge>();
  [...bc]
    .filter(([, s]) => s >= BRIDGE_MIN)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .forEach(([k, score]) => {
      if (bridges.size >= MAX_BRIDGES) return;
      const own = countryOf.get(k)!;
      const reach = new Map<number, number>();
      for (const [o, w] of g.get(k)!) {
        const c = countryOf.get(o)!;
        if (c !== own) reach.set(c, (reach.get(c) ?? 0) + w);
      }
      if (!reach.size) return;
      const others = [...reach].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
      bridges.set(k, { key: k, score, countries: [own, ...others] });
    });

  return { countryOf, countries, realms, bridges, links };
}

export interface RegionPoint {
  x: number;
  y: number;
  w: number;
  country: number;
}

/** Per country, f_c over the grid (row-major, row 0 at y0); f_c > 0 is its territory. */
export function regionFields(
  points: RegionPoint[],
  grid: { x0: number; y0: number; cell: number; nx: number; ny: number },
  bandwidth: number,
  count: number,
  minDensity = REGION_MIN_DENSITY,
): Float64Array[] {
  const { x0, y0, cell, nx, ny } = grid;
  const K = Array.from({ length: count }, () => new Float64Array(nx * ny));
  const h2 = 2 * bandwidth * bandwidth;
  const reach = Math.ceil((3 * bandwidth) / cell);
  for (const p of points) {
    if (!(p.w > 0) || p.country < 0 || p.country >= count) continue;
    const ci = Math.round((p.x - x0) / cell);
    const cj = Math.round((p.y - y0) / cell);
    const field = K[p.country];
    for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j++) {
      const dy = y0 + j * cell - p.y;
      for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
        const dx = x0 + i * cell - p.x;
        field[j * nx + i] += p.w * Math.exp(-(dx * dx + dy * dy) / h2);
      }
    }
  }
  const out = K.map(() => new Float64Array(nx * ny));
  for (let c = 0; c < nx * ny; c++) {
    let d = 0;
    let first = -1;
    let second = -1;
    for (let k = 0; k < count; k++) {
      const v = K[k][c];
      d += v;
      if (first < 0 || v > K[first][c]) {
        second = first;
        first = k;
      } else if (second < 0 || v > K[second][c]) second = k;
    }
    for (let k = 0; k < count; k++) {
      const rival = k === first ? (second >= 0 ? K[second][c] : 0) : K[first][c];
      out[k][c] = Math.min(K[k][c] - rival, d - minDensity);
    }
  }
  return out;
}
