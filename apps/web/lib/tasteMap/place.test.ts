import { describe, expect, it } from 'vitest';
import { buildFeatureSpace, DEFAULT_METRIC, explain } from './features';
import { solveLayout } from './layout';
import { metricToRow } from './metricStore';
import { asCandidate, onMapKeys, placeArtist, placeSentence } from './place';
import { artistByName, COLDPLAY_MYLO_XYLOTO, mergedInput, withoutArtist } from './phase4Fixtures';
import type { NodeKey, Vec3 } from './types';

const full = mergedInput();
const { input, candidate } = withoutArtist(full, 'Coldplay');
const space = buildFeatureSpace(input);
const layout = solveLayout(space, { weights: DEFAULT_METRIC, explain: (a, b) => explain(a, b, space, DEFAULT_METRIC) });

describe('placeArtist (Coldplay as an unrated candidate on the real fixtures)', () => {
  it('places it at the similarity-weighted barycentre of its anchors, with a sentence', () => {
    const res = placeArtist({ input, candidate, overrides: [], positions: layout.positions, metricRow: null });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const r = res.response;
    expect(r.artistId).toBe(candidate.id);
    expect(r.label).toBe('Coldplay');
    expect(r.anchors.length).toBe(5);
    expect(r.anchors.every((a) => layout.positions[a.key])).toBe(true);
    // Barycentre of the anchors (all sims positive here).
    const tot = r.anchors.reduce((s, a) => s + Math.max(a.sim, 0), 0);
    const exp = [0, 1, 2].map((d) => r.anchors.reduce((s, a) => s + Math.max(a.sim, 0) * layout.positions[a.key][d], 0) / tot);
    r.pos.forEach((v, d) => expect(v).toBeCloseTo(exp[d], 9));
    // Britpop/rock neighbours: Oasis or Bastille should be among the anchors.
    const names = r.anchors.map((a) => space.nodes.find((n) => n.key === a.key)!.label);
    expect(names.some((n) => n === 'Oasis' || n === 'Bastille' || n === 'Owl City')).toBe(true);
    expect(r.explanation.startsWith('Placed near ')).toBe(true);
    expect(r.explanation).toContain(names[0]);
    expect(r.anchors[0].why.length).toBeGreaterThan(0);
  });

  it('uses the stored metric through metricFromRow (block weights change the anchors’ sims)', () => {
    const row = metricToRow({ block: { tags: 1, text: 0, graph: 0, era: 0 }, tagDims: null }, space);
    const a = placeArtist({ input, candidate, overrides: [], positions: layout.positions, metricRow: null });
    const b = placeArtist({ input, candidate, overrides: [], positions: layout.positions, metricRow: row });
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');
    expect(b.response.anchors.map((x) => x.sim)).not.toEqual(a.response.anchors.map((x) => x.sim));
    expect(b.response.anchors.every((x) => x.why.every((c) => c.label !== 'described alike'))).toBe(true);
  });

  it('candidate eras: picks the era with the most albums when an override splits it', () => {
    const res = placeArtist({
      input,
      candidate,
      overrides: [{ artistId: candidate.id, splitAlbumIds: [COLDPLAY_MYLO_XYLOTO] }],
      positions: layout.positions,
      metricRow: null,
    });
    expect(res.kind).toBe('ok');
  });

  it('is on-map (with its key) when the user rated the artist', () => {
    const coldplay = artistByName(full, 'Coldplay');
    expect(onMapKeys(full, coldplay.id)).toEqual([`a:${coldplay.id}`]);
    const res = placeArtist({ input: full, candidate, overrides: [], positions: layout.positions, metricRow: null });
    expect(res).toEqual({ kind: 'on-map', keys: [`a:${coldplay.id}`] });
    expect(onMapKeys(full, coldplay.id, [{ artistId: coldplay.id, splitAlbumIds: [COLDPLAY_MYLO_XYLOTO] }])).toHaveLength(2);
  });

  it('no-data when nothing in the catalog counts for the map', () => {
    const comp = { ...candidate, albums: candidate.albums.map((a) => ({ ...a, type: 'compilation' })) };
    expect(placeArtist({ input, candidate: comp, overrides: [], positions: layout.positions, metricRow: null }).kind).toBe('no-data');
  });

  it('ignores stored positions for the candidate’s own keys and does not mutate inputs', () => {
    const before = JSON.stringify({ input, candidate });
    const positions: Record<NodeKey, Vec3> = { ...layout.positions, [`a:${candidate.id}`]: [9, 9, 9] };
    const res = placeArtist({ input, candidate, overrides: [], positions, metricRow: null });
    if (res.kind !== 'ok') throw new Error('expected ok');
    expect(res.response.anchors.some((a) => a.key.includes(candidate.id))).toBe(false);
    expect(JSON.stringify({ input, candidate })).toBe(before);
  });
});

describe('asCandidate / placeSentence', () => {
  it('rates counted albums only', () => {
    const c = asCandidate({ ...candidate, albums: [{ ...candidate.albums[0], type: 'live' }, ...candidate.albums.slice(1)] });
    expect(c.albums[0].rated).toBe(false);
    expect(c.albums.slice(1).every((a) => a.rated && a.score === null)).toBe(true);
  });

  it('names the top 3 anchors with up to 2 reasons each', () => {
    const node = (label: string, eraLabel: string | null = null) => ({ label, eraLabel }) as never;
    const nodes: Record<string, never> = { k1: node('Oasis'), k2: node('Blur', '1994–1997'), k3: node('Pulp'), k4: node('Suede') };
    const s = placeSentence(
      [
        { key: 'k1', sim: 0.9, why: [{ label: 'Britpop', share: 0.5 }, { label: 'listeners overlap', share: 0.3 }, { label: 'rock', share: 0.1 }] },
        { key: 'k2', sim: 0.8, why: [{ label: 'Britpop', share: 0.6 }] },
        { key: 'k3', sim: 0.7, why: [] },
        { key: 'k4', sim: 0.6, why: [{ label: 'x', share: 1 }] },
      ],
      (k) => nodes[k],
    );
    expect(s).toBe('Placed near Oasis (Britpop, listeners overlap), Blur 1994–1997 (Britpop) and Pulp.');
    expect(placeSentence([], () => undefined)).toMatch(/middle/);
  });
});
