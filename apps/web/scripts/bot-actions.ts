/**
 * Run actions as the silla_bot test account.
 * Service role key bypasses RLS so no sign-in needed.
 *
 * Usage:
 *   npx ts-node --skip-project scripts/bot-actions.ts follow <target-username>
 *   npx ts-node --skip-project scripts/bot-actions.ts unfollow <target-username>
 *   npx ts-node --skip-project scripts/bot-actions.ts rate <spotify-album-id> <score>
 *   npx ts-node --skip-project scripts/bot-actions.ts status
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BOT_USERNAME = 'silla_bot';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getBotId(): Promise<string> {
  const { data, error } = await db.from('profiles').select('id').eq('username', BOT_USERNAME).maybeSingle();
  if (error || !data) { console.error('Bot user not found — run create-bot-user.ts first'); process.exit(1); }
  return data.id;
}

async function getUserId(username: string): Promise<string> {
  const { data, error } = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  if (error || !data) { console.error(`User @${username} not found`); process.exit(1); }
  return data.id;
}

async function follow(targetUsername: string) {
  const [botId, targetId] = await Promise.all([getBotId(), getUserId(targetUsername)]);
  const { error } = await db.from('follows').insert({ follower_id: botId, following_id: targetId });
  if (error) { console.error('Follow error:', error.message); process.exit(1); }
  console.log(`✓ @${BOT_USERNAME} is now following @${targetUsername}`);
}

async function unfollow(targetUsername: string) {
  const [botId, targetId] = await Promise.all([getBotId(), getUserId(targetUsername)]);
  const { error } = await db.from('follows').delete().eq('follower_id', botId).eq('following_id', targetId);
  if (error) { console.error('Unfollow error:', error.message); process.exit(1); }
  console.log(`✓ @${BOT_USERNAME} unfollowed @${targetUsername}`);
}

async function rate(albumId: string, score: number) {
  if (score < 1 || score > 10) { console.error('Score must be 1–10'); process.exit(1); }
  const botId = await getBotId();
  const { error } = await db.from('ratings').upsert(
    { user_id: botId, release_id: albumId, score },
    { onConflict: 'user_id,release_id' }
  );
  if (error) { console.error('Rate error:', error.message); process.exit(1); }
  console.log(`✓ @${BOT_USERNAME} rated album ${albumId} → ★${score}`);
}

async function comment(albumId: string, body: string) {
  const botId = await getBotId();
  const { error } = await db.from('reviews').insert({
    release_id: albumId,
    user_id: botId,
    username: BOT_USERNAME,
    body,
    visibility: 'public',
  });
  if (error) { console.error('Comment error:', error.message); process.exit(1); }
  console.log(`✓ @${BOT_USERNAME} commented on ${albumId}: "${body}"`);
}

async function status() {
  const botId = await getBotId();
  const [{ count: following }, { count: followers }, { count: ratings }] = await Promise.all([
    db.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', botId),
    db.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', botId),
    db.from('ratings').select('*', { count: 'exact', head: true }).eq('user_id', botId),
  ]);
  console.log(`\n── @${BOT_USERNAME} status ─────────────`);
  console.log(`  Following: ${following ?? 0}`);
  console.log(`  Followers: ${followers ?? 0}`);
  console.log(`  Ratings:   ${ratings ?? 0}`);
  console.log('──────────────────────────────────────\n');
}

const [,, cmd, arg1, arg2] = process.argv;

switch (cmd) {
  case 'follow':   follow(arg1); break;
  case 'unfollow': unfollow(arg1); break;
  case 'rate':     rate(arg1, parseInt(arg2)); break;
  case 'comment':  comment(arg1, arg2); break;
  case 'status':   status(); break;
  default:
    console.log('Commands: follow <username> | unfollow <username> | rate <albumId> <score> | comment <albumId> "<text>" | status');
}
