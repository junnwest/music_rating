/**
 * A hand-built TasteMapPayload fixture for the Phase 2 viewer shell
 * (`/taste/map`, dev-only) — renders before `/api/taste/map` exists.
 *
 * Four groups clustered in [-1, 1]^3: J-Rock ("Yorushika world"), Britpop/UK,
 * pop-rock and K-hiphop, with a few bridge nodes (Bastille 0.6/0.4 sits between
 * pop-rock and Britpop) and Coldplay split into two era nodes joined by a trail
 * (early near Britpop, later near pop). Positions are jittered with a fixed
 * seed, so the fixture is deterministic. `pos2d` is a fixed linear projection of
 * `pos` (≈ its x/y plane), standing in for the engine's principal plane.
 * Neighbors are the 5 nearest nodes in 3D with made-up but plausible `why`
 * shares. Not a real user's data.
 */

import type {
  Contribution,
  Neighbor,
  NodeKey,
  TasteMapGroup,
  TasteMapPayload,
  TasteMapPayloadNode,
  Vec2,
  Vec3,
} from './types';

const GROUPS: TasteMapGroup[] = [
  { id: 'g-jrock', name: 'J-Rock · Yorushika world', color: '#e0567a', seedWorld: 'j-rock' },
  { id: 'g-britpop', name: 'Britpop / UK', color: '#3f7fd9', seedWorld: 'britpop' },
  { id: 'g-poprock', name: 'Pop-Rock', color: '#e0a21b', seedWorld: 'pop-rock' },
  { id: 'g-khiphop', name: 'K-Hip-Hop', color: '#2fae7d', seedWorld: 'korean-hip-hop' },
];

const CENTERS: Record<string, Vec3> = {
  'g-jrock': [-0.62, 0.34, 0.18],
  'g-britpop': [0.52, 0.42, -0.22],
  'g-poprock': [0.42, -0.36, 0.3],
  'g-khiphop': [-0.44, -0.52, -0.36],
};

/** Tag-ish labels a pair inside a group plausibly shares. */
const GROUP_TAGS: Record<string, string[]> = {
  'g-jrock': ['J-Rock', 'J-Pop', 'Japanese Indie'],
  'g-britpop': ['Britpop', 'Alternative Rock', 'UK Indie'],
  'g-poprock': ['Pop Rock', 'Indie Pop', 'Synth-Pop'],
  'g-khiphop': ['Korean Hip-Hop', 'K-R&B', 'Boom Bap'],
};
const BLOCK_LABELS = ['described alike', 'listeners overlap', 'same era'];

interface Seed {
  slug: string;
  label: string;
  groups: Record<string, number>;
  score: number | null;
  mass: number;
  albums: string[];
  eraLabel?: string | null;
  /** Override the jittered group-centroid position. */
  at?: Vec3;
  /** Era nodes share an artist id: `e:<artistId>:<firstAlbumId>`. */
  artist?: string;
}

const J = { 'g-jrock': 1 };
const B = { 'g-britpop': 1 };
const P = { 'g-poprock': 1 };
const K = { 'g-khiphop': 1 };

const SEEDS: Seed[] = [
  // ── J-Rock "Yorushika world"
  { slug: 'yorushika', label: 'Yorushika', groups: J, score: 4.7, mass: 7.5, albums: ['Elma', 'Plagiarism', 'Magic Lantern'] },
  { slug: 'zutomayo', label: 'ZUTOMAYO', groups: J, score: 4.4, mass: 5.2, albums: ['Gusare', 'Ultra Hanaya'] },
  { slug: 'yoasobi', label: 'YOASOBI', groups: { 'g-jrock': 0.8, 'g-poprock': 0.2 }, score: 4.0, mass: 4.1, albums: ['THE BOOK', 'THE BOOK 2'] },
  { slug: 'king-gnu', label: 'King Gnu', groups: J, score: 4.3, mass: 4.6, albums: ['Sympa', 'CEREMONY'] },
  { slug: 'kenshi-yonezu', label: 'Kenshi Yonezu', groups: J, score: 4.5, mass: 5.8, albums: ['Bootleg', 'STRAY SHEEP', 'LOST CORNER'] },
  { slug: 'aimer', label: 'Aimer', groups: J, score: 3.8, mass: 2.4, albums: ['Walpurgis'] },
  { slug: 'back-number', label: 'back number', groups: J, score: 3.6, mass: 2.0, albums: ['MAGIC'] },
  { slug: 'radwimps', label: 'RADWIMPS', groups: J, score: 4.2, mass: 4.4, albums: ['Zettai Zetsumei', 'Your Name.'] },
  { slug: 'higedan', label: 'Official HIGE DANdism', groups: { 'g-jrock': 0.85, 'g-poprock': 0.15 }, score: 3.9, mass: 3.1, albums: ['Traveler', 'Editorial'] },
  { slug: 'eve', label: 'Eve', groups: J, score: 4.1, mass: 2.2, albums: ['Smile'] },
  { slug: 'kana-boon', label: 'KANA-BOON', groups: J, score: 3.4, mass: 1.2, albums: ['DOPPEL'] },

  // ── Britpop / UK
  { slug: 'oasis', label: 'Oasis', groups: B, score: 4.6, mass: 6.4, albums: ["Definitely Maybe", "(What's the Story) Morning Glory?"] },
  { slug: 'blur', label: 'Blur', groups: B, score: 4.3, mass: 4.9, albums: ['Parklife', 'The Great Escape', '13'] },
  { slug: 'radiohead', label: 'Radiohead', groups: B, score: 4.8, mass: 7.0, albums: ['The Bends', 'OK Computer', 'In Rainbows'] },
  { slug: 'pulp', label: 'Pulp', groups: B, score: 4.1, mass: 2.6, albums: ['Different Class'] },
  { slug: 'suede', label: 'Suede', groups: B, score: 3.7, mass: 1.8, albums: ['Suede'] },
  { slug: 'the-verve', label: 'The Verve', groups: B, score: 4.0, mass: 2.3, albums: ['Urban Hymns'] },
  { slug: 'travis', label: 'Travis', groups: B, score: 3.5, mass: 1.6, albums: ['The Man Who'] },
  { slug: 'keane', label: 'Keane', groups: { 'g-britpop': 0.7, 'g-poprock': 0.3 }, score: 3.9, mass: 2.1, albums: ['Hopes and Fears'] },
  { slug: 'arctic-monkeys', label: 'Arctic Monkeys', groups: { 'g-britpop': 0.8, 'g-poprock': 0.2 }, score: 4.4, mass: 4.8, albums: ['Whatever People Say I Am, That\'s What I\'m Not', 'AM'] },

  // ── Coldplay, two eras with a trail
  {
    slug: 'coldplay-early', artist: 'coldplay', label: 'Coldplay', eraLabel: '2000–2008',
    groups: { 'g-britpop': 0.75, 'g-poprock': 0.25 }, score: 4.5, mass: 5.0,
    albums: ['Parachutes', 'A Rush of Blood to the Head', 'X&Y', 'Viva la Vida'],
    at: [0.66, 0.2, -0.12],
  },
  {
    slug: 'coldplay-later', artist: 'coldplay', label: 'Coldplay', eraLabel: '2011–2024',
    groups: { 'g-poprock': 0.7, 'g-britpop': 0.3 }, score: 3.2, mass: 3.4,
    albums: ['Mylo Xyloto', 'A Head Full of Dreams', 'Music of the Spheres'],
    at: [0.5, -0.2, 0.22],
  },

  // ── Pop-rock
  { slug: '5sos', label: '5 Seconds of Summer', groups: P, score: 3.9, mass: 3.6, albums: ['Youngblood', 'CALM'] },
  { slug: 'fritz', label: 'Fritz', groups: P, score: 3.6, mass: 1.4, albums: ['Pastel'] },
  { slug: 'walk-the-moon', label: 'Walk the Moon', groups: P, score: 3.8, mass: 2.2, albums: ['Talking Is Hard'] },
  { slug: 'the-1975', label: 'The 1975', groups: { 'g-poprock': 0.8, 'g-britpop': 0.2 }, score: 4.2, mass: 4.5, albums: ['I like it when you sleep…', 'A Brief Inquiry into Online Relationships'] },
  { slug: 'imagine-dragons', label: 'Imagine Dragons', groups: P, score: 2.8, mass: 2.9, albums: ['Night Visions', 'Evolve'] },
  { slug: 'onerepublic', label: 'OneRepublic', groups: P, score: 3.1, mass: 1.9, albums: ['Native'] },
  {
    slug: 'bastille', label: 'Bastille', groups: { 'g-poprock': 0.6, 'g-britpop': 0.4 }, score: 3.7, mass: 2.5,
    albums: ['Bad Blood', 'Wild World'],
    at: [0.48, 0.02, 0.05],
  },
  { slug: 'the-killers', label: 'The Killers', groups: { 'g-poprock': 0.75, 'g-britpop': 0.25 }, score: 4.0, mass: 3.0, albums: ['Hot Fuss', "Sam's Town"] },

  // ── K-Hip-Hop
  { slug: 'epik-high', label: 'Epik High', groups: K, score: 4.6, mass: 6.0, albums: ['Remapping the Human Soul', 'Shoebox', 'Sleepless in __________'] },
  { slug: 'dynamic-duo', label: 'Dynamic Duo', groups: K, score: 4.1, mass: 3.7, albums: ['Taxi Driver', 'Grand Carnival'] },
  { slug: 'zico', label: 'Zico', groups: { 'g-khiphop': 0.8, 'g-poprock': 0.2 }, score: 3.8, mass: 2.6, albums: ['Thinking'] },
  { slug: 'bewhy', label: 'BewhY', groups: K, score: 4.3, mass: 3.2, albums: ['The Time Is Now', 'The Movie Star'] },
  { slug: 'swings', label: 'Swings', groups: K, score: 3.5, mass: 1.7, albums: ['Upgrade IV'] },
  { slug: 'nafla', label: 'Nafla', groups: K, score: 3.9, mass: 1.9, albums: ['Loyalty'] },
  { slug: 'jay-park', label: 'Jay Park', groups: { 'g-khiphop': 0.7, 'g-poprock': 0.3 }, score: 3.3, mass: 2.4, albums: ['Everything You Wanted', 'The Road Less Traveled'] },
  { slug: 'ph-1', label: 'pH-1', groups: K, score: 4.0, mass: 2.0, albums: ['X'] },
  { slug: 'beenzino', label: 'Beenzino', groups: K, score: 4.4, mass: 2.8, albums: ['12', 'NOWITZKI'] },
  { slug: 'unrated-crush', label: 'Crush', groups: { 'g-khiphop': 0.6, 'g-poprock': 0.2 }, score: null, mass: 0.6, albums: ['From Midnight to Sunrise'] },
];

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function build(): TasteMapPayload {
  const rand = rng(20261103);
  const jitter = (s: number) => (rand() * 2 - 1) * s;

  const nodes: TasteMapPayloadNode[] = SEEDS.map((s) => {
    let pos: Vec3;
    if (s.at) {
      pos = s.at;
    } else {
      // Membership-weighted blend of group centers, then jitter; heavier nodes
      // sit nearer the core so each cluster has a readable middle.
      const c: Vec3 = [0, 0, 0];
      let wsum = 0;
      for (const [g, w] of Object.entries(s.groups)) {
        const gc = CENTERS[g];
        c[0] += gc[0] * w;
        c[1] += gc[1] * w;
        c[2] += gc[2] * w;
        wsum += w;
      }
      const spread = 0.34 - Math.min(s.mass, 7) * 0.025;
      pos = [c[0] / wsum + jitter(spread), c[1] / wsum + jitter(spread), c[2] / wsum + jitter(spread)];
    }
    pos = [round(pos[0]), round(pos[1]), round(pos[2])];
    const pos2d: Vec2 = [round(pos[0] + 0.12 * pos[2]), round(pos[1] - 0.08 * pos[2])];
    const artistId = `mock-${s.artist ?? s.slug}`;
    const albumIds = s.albums.map((_, i) => `mock-rg-${s.slug}-${i}`);
    const key: NodeKey = s.artist ? `e:${artistId}:${albumIds[0]}` : `a:${artistId}`;
    return {
      key,
      artistId,
      label: s.label,
      eraLabel: s.eraLabel ?? null,
      mass: s.mass,
      avgScore: s.score,
      covers: s.albums.map((title, i) => ({ id: albumIds[i], title, coverUrl: null })),
      groups: s.groups,
      pos,
      pos2d,
      pinned: false,
    };
  });

  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const topGroup = (n: TasteMapPayloadNode) =>
    Object.entries(n.groups).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;

  const neighbors: Record<NodeKey, Neighbor[]> = {};
  for (const n of nodes) {
    const near = nodes
      .filter((m) => m.key !== n.key)
      .map((m) => ({ m, d: dist(n.pos, m.pos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    neighbors[n.key] = near.map(({ m, d }) => {
      const g = topGroup(n) === topGroup(m) ? topGroup(n) : topGroup(m);
      const tags = g ? GROUP_TAGS[g] : [];
      const raw: Contribution[] = [
        { label: tags[0] ?? 'Rock', share: 0.25 + rand() * 0.25 },
        { label: tags[1 + Math.floor(rand() * 2)] ?? 'Pop', share: 0.08 + rand() * 0.12 },
        ...BLOCK_LABELS.map((label) => ({ label, share: 0.05 + rand() * 0.25 })),
      ];
      if (m.artistId === n.artistId) raw.push({ label: 'same artist', share: 0.4 });
      const total = raw.reduce((s, c) => s + c.share, 0);
      const why = raw
        .map((c) => ({ label: c.label, share: round(c.share / total) }))
        .sort((a, b) => b.share - a.share);
      return { key: m.key, sim: round(Math.max(0.05, 1 - d / 1.6)), why };
    });
  }

  const byArtist = new Map<string, TasteMapPayloadNode[]>();
  for (const n of nodes) {
    if (!n.key.startsWith('e:')) continue;
    const list = byArtist.get(n.artistId) ?? [];
    list.push(n);
    byArtist.set(n.artistId, list);
  }
  const trails = Array.from(byArtist.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([artistId, list]) => ({ artistId, keys: list.map((n) => n.key) }));

  return { version: 1, nodes, groups: GROUPS, trails, neighbors };
}

export const MOCK_TASTE_MAP: TasteMapPayload = build();
