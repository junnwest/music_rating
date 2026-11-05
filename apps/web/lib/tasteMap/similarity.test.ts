import { describe, expect, it } from 'vitest';
import { packSimilarity } from './payload';
import { similarityLookup } from './similarity';

describe('similarityLookup', () => {
  it('round-trips the packed upper triangle', () => {
    const keys = ['a', 'b', 'c', 'd'];
    const S = new Float64Array([1, 0.1, 0.2, 0.3, 0.1, 1, 0.4, 0.5, 0.2, 0.4, 1, 0.6, 0.3, 0.5, 0.6, 1]);
    const look = similarityLookup({ similarity: packSimilarity(keys, S), neighbors: {} });
    expect(look.get('a', 'd')).toBe(0.3);
    expect(look.get('d', 'b')).toBe(0.5);
    expect(look.get('c', 'c')).toBe(1);
    expect(look.get('a', 'zz')).toBeNull();
    expect([...look.row('c')]).toEqual([['a', 0.2], ['b', 0.4], ['d', 0.6]]);
  });

  it('falls back to neighbor lists', () => {
    const look = similarityLookup({ neighbors: { a: [{ key: 'b', sim: 0.7, why: [] }] } });
    expect(look.get('b', 'a')).toBe(0.7);
    expect(look.get('a', 'c')).toBeNull();
  });
});
