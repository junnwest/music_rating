import { describe, expect, it } from 'vitest';
import { LIMITS, type TasteMapExport } from './apiTypes';
import {
  isHexColor,
  isNodeKey,
  isUuid,
  isVec3,
  validateEras,
  validateExport,
  validateGroups,
  validateLayoutBody,
  validateMetric,
  validatePins,
  validatePinsBody,
  validatePositions,
} from './validate';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const kA = `a:${A}`;
const kB = `a:${B}`;
const kE = `e:${A}:${R}`;

function goodExport(): TasteMapExport {
  return {
    kind: 'sillajuku.tasteMap',
    version: 1,
    exportedAt: '2026-11-03T00:00:00.000Z',
    lens: 'sound',
    pins: [{ key: kA, pos: [0.1, 0.2, 0.3] }],
    groups: [
      { id: 'g1', name: 'Britpop', color: '#AABBCC', seedWorld: null, members: [{ key: kA, weight: 0.6, manual: true }] },
      { id: 'g2', name: 'Indie', color: '#112233', seedWorld: 'rock', members: [{ key: kA, weight: 0.4, manual: false }] },
    ],
    eras: [{ artistId: A, splitAlbumIds: [R] }],
    metric: { block: { tags: 1, text: 1, graph: 1, era: 0.5 }, tagDims: { rock: 1.2 } },
    layout: { [kA]: [0, 0, 0], [kE]: [1, -1, 0.5] },
  };
}

describe('building blocks', () => {
  it('isUuid / isNodeKey', () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isNodeKey(kA)).toBe(true);
    expect(isNodeKey(kE)).toBe(true);
    expect(isNodeKey(`a:${A}:${R}`)).toBe(false);
    expect(isNodeKey(`e:${A}`)).toBe(false);
    expect(isNodeKey('a:c0n0')).toBe(false);
    expect(isNodeKey(`a:${A} `)).toBe(false);
    expect(isNodeKey(42)).toBe(false);
  });
  it('isVec3 bounds and finiteness', () => {
    expect(isVec3([0, 1, -1])).toBe(true);
    expect(isVec3([0, 1])).toBe(false);
    expect(isVec3([0, 1, NaN])).toBe(false);
    expect(isVec3([0, 1, Infinity])).toBe(false);
    expect(isVec3([0, 1, LIMITS.coord + 1])).toBe(false);
    expect(isVec3([0, 1, '2'])).toBe(false);
  });
  it('isHexColor', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });
});

describe('validatePins', () => {
  it('normalizes and drops extra fields', () => {
    const r = validatePinsBody({ pins: [{ key: kA, pos: [1, 2, 3], softZ: true, user_id: 'x' }, { key: kB, pos: [0, 0, 0], softZ: false }] });
    expect(r).toEqual({ ok: true, value: [{ key: kA, pos: [1, 2, 3], softZ: true }, { key: kB, pos: [0, 0, 0] }] });
  });
  it('rejects bad input', () => {
    expect(validatePinsBody(null).ok).toBe(false);
    expect(validatePinsBody({}).ok).toBe(false);
    expect(validatePins([{ key: 'a:bad', pos: [0, 0, 0] }]).ok).toBe(false);
    expect(validatePins([{ key: kA, pos: [0, 0] }]).ok).toBe(false);
    expect(validatePins([{ key: kA, pos: [0, 0, 1e9] }]).ok).toBe(false);
    expect(validatePins([{ key: kA, pos: [0, 0, 0], softZ: 'yes' }]).ok).toBe(false);
    const dup = validatePins([{ key: kA, pos: [0, 0, 0] }, { key: kA, pos: [1, 0, 0] }]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/duplicate/);
    const many = Array.from({ length: LIMITS.nodes + 1 }, () => ({ key: kA, pos: [0, 0, 0] }));
    expect(validatePins(many).ok).toBe(false);
  });
});

describe('validatePositions', () => {
  it('accepts a keyed record', () => {
    expect(validateLayoutBody({ positions: { [kA]: [0, 1, 2], [kE]: [-1, 0, 0] } }).ok).toBe(true);
  });
  it('rejects bad keys, coords, and too many', () => {
    expect(validatePositions([]).ok).toBe(false);
    expect(validatePositions({ 'a:x': [0, 0, 0] }).ok).toBe(false);
    expect(validatePositions({ [kA]: [0, 0, 101] }).ok).toBe(false);
    expect(validatePositions({ [kA]: [0, 0, null] }).ok).toBe(false);
    const big: Record<string, number[]> = {};
    for (let i = 0; i <= LIMITS.nodes; i++) big[`a:${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`] = [0, 0, 0];
    expect(validatePositions(big).ok).toBe(false);
  });
});

describe('validateGroups', () => {
  const g = (over: Record<string, unknown> = {}) => ({ id: 'g', name: 'G', color: '#000000', seedWorld: null, members: [], ...over });
  it('accepts and trims', () => {
    const r = validateGroups([g({ name: '  Rock  ', members: [{ key: kA, weight: 1 }] })]);
    expect(r.ok && r.value[0]).toEqual({ id: 'g', name: 'Rock', color: '#000000', seedWorld: null, members: [{ key: kA, weight: 1, manual: false }] });
  });
  it('rejects colors, names, weights, sums, duplicates', () => {
    expect(validateGroups([g({ color: '#FFF' })]).ok).toBe(false);
    expect(validateGroups([g({ name: '' })]).ok).toBe(false);
    expect(validateGroups([g({ name: 'x'.repeat(61) })]).ok).toBe(false);
    expect(validateGroups([g({ members: [{ key: kA, weight: 1.5 }] })]).ok).toBe(false);
    expect(validateGroups([g({ members: [{ key: kA, weight: -0.1 }] })]).ok).toBe(false);
    expect(validateGroups([g({ members: [{ key: kA, weight: 0.5 }, { key: kA, weight: 0.5 }] })]).ok).toBe(false);
    expect(validateGroups([g(), g()]).ok).toBe(false);
    const over = validateGroups([g({ id: 'a', members: [{ key: kA, weight: 0.7 }] }), g({ id: 'b', members: [{ key: kA, weight: 0.4 }] })]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/sum to more than 1/);
    expect(validateGroups(Array.from({ length: LIMITS.groups + 1 }, (_, i) => g({ id: `g${i}` }))).ok).toBe(false);
  });
  it('allows round-off on the membership sum', () => {
    const r = validateGroups([
      g({ id: 'a', members: [{ key: kA, weight: 0.1 + 0.2 }] }),
      g({ id: 'b', members: [{ key: kA, weight: 0.7 }] }),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('validateEras / validateMetric', () => {
  it('eras', () => {
    expect(validateEras([{ artistId: A, splitAlbumIds: [R] }]).ok).toBe(true);
    expect(validateEras([{ artistId: A, splitAlbumIds: [] }]).ok).toBe(true);
    expect(validateEras([{ artistId: 'x', splitAlbumIds: [] }]).ok).toBe(false);
    expect(validateEras([{ artistId: A, splitAlbumIds: ['x'] }]).ok).toBe(false);
    expect(validateEras([{ artistId: A, splitAlbumIds: [R, R] }]).ok).toBe(false);
    expect(validateEras([{ artistId: A, splitAlbumIds: [] }, { artistId: A, splitAlbumIds: [] }]).ok).toBe(false);
    expect(validateEras([{ artistId: A, splitAlbumIds: Array.from({ length: LIMITS.splitsPerArtist + 1 }, () => R) }]).ok).toBe(false);
  });
  it('metric', () => {
    expect(validateMetric(null)).toEqual({ ok: true, value: null });
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1, era: 0.5 }, tagDims: null }).ok).toBe(true);
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1 } }).ok).toBe(false);
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1, era: -1 } }).ok).toBe(false);
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1, era: 1, mood: 1 } }).ok).toBe(false);
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1, era: 1 }, tagDims: [1, 2] }).ok).toBe(false);
    expect(validateMetric({ block: { tags: 1, text: 1, graph: 1, era: 1 }, tagDims: { rock: 'x' } }).ok).toBe(false);
  });
});

describe('validateExport', () => {
  it('accepts a good export', () => {
    const r = validateExport(goodExport(), 'sound');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(goodExport());
  });
  it('rejects kind, version, lens, and nested problems', () => {
    const bad = (mut: (e: Record<string, unknown>) => void) => {
      const e = goodExport() as unknown as Record<string, unknown>;
      mut(e);
      return validateExport(e, 'sound').ok;
    };
    expect(bad((e) => (e.kind = 'other'))).toBe(false);
    expect(bad((e) => (e.version = 2))).toBe(false);
    expect(bad((e) => (e.lens = 'mood'))).toBe(false);
    expect(bad((e) => (e.pins = 'x'))).toBe(false);
    expect(bad((e) => ((e.groups as { color: string }[])[0].color = 'blue'))).toBe(false);
    expect(bad((e) => ((e.eras as { artistId: string }[])[0].artistId = 'nope'))).toBe(false);
    expect(bad((e) => (e.layout = { [kA]: [0, 0, 'x'] }))).toBe(false);
    expect(bad((e) => (e.layout = null))).toBe(true);
    expect(bad((e) => (e.metric = null))).toBe(true);
  });
});
