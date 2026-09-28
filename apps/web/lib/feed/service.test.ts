import { describe, expect, it, vi } from 'vitest';
vi.mock('../cache', () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => {}) }));
import { decodeCursor, readSnapshot, homeFeed } from './service';
import { cacheGet } from '../cache';
import { entryKey } from './types';

describe('feed sessions', () => {
  it('rejects malformed, oversized and negative-offset cursors', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of ['garbage', 'x'.repeat(1201), encode({ session: 'not-a-uuid', offset: 0 }),
      encode({ session: '12345678-1234-1234-1234-123456789abc', offset: -1 }),
      encode({ session: '12345678-1234-1234-1234-123456789abc', offset: 1, before: 'invalid' })]) {
      expect(() => decodeCursor(cursor)).toThrow('Invalid feed cursor');
    }
  });
  it('validates cursors and fails explicitly when a session expires', async () => {
    const input = { session: '12345678-1234-1234-1234-123456789abc', offset: 20 };
    expect(decodeCursor(Buffer.from(JSON.stringify(input)).toString('base64url'))).toEqual(input);
    await expect(readSnapshot(input.session, null)).rejects.toMatchObject({ status: 410 });
  });
  it('never queries followed content for an anonymous viewer', async () => {
    const db = { from: vi.fn(), rpc: vi.fn() };
    const page = await homeFeed(db as never, null, 'following', null);
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('does not let one viewer resume another viewer’s session', async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ viewer: 'owner', tab: 'explore', createdAt: Date.now(), refs: [] });
    await expect(readSnapshot('12345678-1234-1234-1234-123456789abc', 'other')).rejects.toMatchObject({ status: 403 });
  });
  it('rehydrates cursor pages and removes newly private/deleted content without moving other positions', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, user_id: `author-${i}`,
      created_at: new Date(Date.now() - i * 3600000).toISOString(), score: 4, review_text: 'Review',
      profiles: { profile_visibility: 'Public', is_bot: false, deactivated_at: null },
      release_groups: { id: `album-${i}`, title: '', artist_display: '', primary_artist_id: `artist-${i}`, genres: [] },
    }));
    const db = {
      rpc: vi.fn(async (name: string) => ({ error: null, data: name === 'get_home_feed_candidates'
        ? rows.map(r => ({ kind: 'rating', id: r.id, created_at: r.created_at })) : [] })),
      from: (table: string) => {
        let ids: string[] | undefined;
        const q: any = {
          select: () => q, eq: () => q, limit: () => q,
          in: (_: string, value: string[]) => { ids = value; return q; },
          then: (resolve: (v: unknown) => void) => resolve({ error: null, data: table === 'ratings' ? rows.filter(r => !ids || ids.includes(r.id)) : [] }),
        };
        return q;
      },
    };
    const first = await homeFeed(db as never, null, 'explore', null);
    expect(first.entries).toHaveLength(20);
    const next = await homeFeed(db as never, null, 'explore', first.nextCursor);
    expect(next.entries).toHaveLength(20);
    const hiddenId = next.entries[0].kind === 'rating' ? next.entries[0].item.id : '';
    rows.find(r => r.id === hiddenId)!.profiles.profile_visibility = 'Private';
    const retry = await homeFeed(db as never, null, 'explore', first.nextCursor);
    expect(retry.entries.map(entryKey)).toEqual(next.entries.slice(1).map(entryKey));
    expect(retry.positions).toEqual(next.positions);
    expect(retry.nextCursor).toBe(next.nextCursor);
    expect(retry.entries.some(e => first.entries.map(entryKey).includes(entryKey(e)))).toBe(false);
  });
});
