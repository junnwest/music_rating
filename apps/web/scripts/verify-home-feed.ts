/** Read-only smoke test against the configured project's anonymous RLS.
 * Run after applying 20260928000002_home_feed.sql:
 * npx tsx --env-file=.env.local scripts/verify-home-feed.ts
 */
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { homeFeed } from '../lib/feed/service';
import { entryKey } from '../lib/feed/types';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert(url && key, 'Supabase URL and anon key are required');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const start = Date.now();
  const first = await homeFeed(db, null, 'explore', null);
  assert(first.entries.length > 0, 'Expected public feed candidates in this project');
  assert(first.entries.length <= 20);
  const keys = new Set(first.entries.map(entryKey));
  assert.equal(keys.size, first.entries.length);
  for (const entry of first.entries) {
    const profile = (entry.kind === 'rating' ? entry.item.profiles : entry.post.profile) as unknown as Record<string, unknown>;
    assert.equal(profile.is_bot, false);
    assert.equal(profile.profile_visibility, 'Public');
    assert.equal(profile.deactivated_at, null);
  }
  let secondCount = 0;
  if (first.nextCursor) {
    const next = await homeFeed(db, null, 'explore', first.nextCursor);
    const retry = await homeFeed(db, null, 'explore', first.nextCursor);
    assert.deepEqual(next.entries.map(entryKey), retry.entries.map(entryKey), 'Cursor retries must preserve order');
    assert(next.entries.every(entry => !keys.has(entryKey(entry))), 'Pages must not repeat posts');
    assert.equal(next.sessionId, first.sessionId);
    secondCount = next.entries.length;
  }
  const following = await homeFeed(db, null, 'following', null);
  assert.equal(following.entries.length, 0);
  console.log(JSON.stringify({ ok: true, firstPage: first.entries.length, secondPage: secondCount,
    formats: first.entries.map(e => e.kind), durationMs: Date.now() - start }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
