import { describe, expect, it } from 'vitest';
import { membershipOverflows, parseAdopt, parseGroupCreate, parseGroupPatch, parseMembersPut } from './groupsLogic';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const keyA = `a:${A}`;
const keyE = `e:${A}:${B}`;

describe('parseGroupCreate / parseGroupPatch', () => {
  it('trims names and checks colors', () => {
    expect(parseGroupCreate({ name: '  Britpop  ', color: '#AbC123' })).toEqual({ ok: true, value: { name: 'Britpop', color: '#AbC123' } });
    expect(parseGroupCreate({ name: '   ', color: '#ABC123' }).ok).toBe(false);
    expect(parseGroupCreate({ name: 'x'.repeat(61), color: '#ABC123' }).ok).toBe(false);
    expect(parseGroupCreate({ name: 'x'.repeat(60), color: '#ABC123' }).ok).toBe(true);
    expect(parseGroupCreate({ name: 'ok', color: 'red' }).ok).toBe(false);
    expect(parseGroupCreate({ name: 'ok', color: '#ABC12' }).ok).toBe(false);
    expect(parseGroupCreate(null).ok).toBe(false);
  });

  it('patch needs at least one valid field and drops extras', () => {
    expect(parseGroupPatch({}).ok).toBe(false);
    expect(parseGroupPatch({ name: ' New ' })).toEqual({ ok: true, value: { name: 'New' } });
    expect(parseGroupPatch({ color: '#000000', user_id: 'x' })).toEqual({ ok: true, value: { color: '#000000' } });
    expect(parseGroupPatch({ name: '' }).ok).toBe(false);
  });
});

describe('parseMembersPut', () => {
  it('validates keys and weights, defaults manual to true', () => {
    const r = parseMembersPut({ members: [{ key: keyA, weight: 0.4 }, { key: keyE, weight: 1, manual: false }] });
    expect(r).toEqual({
      ok: true,
      value: [
        { key: keyA, weight: 0.4, manual: true },
        { key: keyE, weight: 1, manual: false },
      ],
    });
    expect(parseMembersPut({ members: [{ key: keyA, weight: 1.5 }] }).ok).toBe(false);
    expect(parseMembersPut({ members: [{ key: keyA, weight: -0.1 }] }).ok).toBe(false);
    expect(parseMembersPut({ members: [{ key: 'a:not-a-uuid', weight: 0.5 }] }).ok).toBe(false);
    expect(parseMembersPut({ members: [{ key: keyA, weight: 0.5 }, { key: keyA, weight: 0.2 }] }).ok).toBe(false);
    expect(parseMembersPut({ members: 'x' }).ok).toBe(false);
  });
});

describe('membershipOverflows', () => {
  const existing = [
    { groupId: 'g1', key: keyA, weight: 0.6 },
    { groupId: 'g2', key: keyA, weight: 0.3 },
    { groupId: 'g2', key: keyE, weight: 0.9 },
  ];
  it('counts the user’s other groups plus the new members', () => {
    expect(membershipOverflows(existing, 'g3', [{ key: keyA, weight: 0.1 }])).toEqual([]);
    const over = membershipOverflows(existing, 'g3', [{ key: keyA, weight: 0.2 }]);
    expect(over).toHaveLength(1);
    expect(over[0].key).toBe(keyA);
    expect(over[0].sum).toBeCloseTo(1.1);
  });
  it('ignores the group being replaced', () => {
    // g2 currently holds keyE at 0.9; replacing g2 with keyE at 1 is fine.
    expect(membershipOverflows(existing, 'g2', [{ key: keyE, weight: 1 }])).toEqual([]);
    expect(membershipOverflows(existing, 'g2', [{ key: keyA, weight: 0.4 }])).toEqual([]);
    expect(membershipOverflows(existing, 'g2', [{ key: keyA, weight: 0.41 }])).toHaveLength(1);
  });
  it('allows float slack up to 1e-6', () => {
    expect(membershipOverflows([{ groupId: 'g1', key: keyA, weight: 0.7 }], 'g2', [{ key: keyA, weight: 0.3000005 }])).toEqual([]);
  });
});

describe('parseAdopt', () => {
  const g = (id: string, members: unknown[] = []) => ({ id, name: `G ${id}`, color: '#112233', seedWorld: 'rock', members });
  it('accepts seed groups and keeps seed member flags', () => {
    const r = parseAdopt({ groups: [g('w:rock', [{ key: keyA, weight: 0.5 }]), g('w:pop', [{ key: keyA, weight: 0.5 }])] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].members[0].manual).toBe(false);
  });
  it('rejects empty, duplicate ids and sums over 1 across the set', () => {
    expect(parseAdopt({ groups: [] }).ok).toBe(false);
    expect(parseAdopt({ groups: [g('w:a'), g('w:a')] }).ok).toBe(false);
    expect(parseAdopt({ groups: [g('w:a', [{ key: keyA, weight: 0.6 }]), g('w:b', [{ key: keyA, weight: 0.5 }])] }).ok).toBe(false);
    expect(parseAdopt({ groups: Array.from({ length: 41 }, (_, i) => g(`w:${i}`)) }).ok).toBe(false);
  });
});
