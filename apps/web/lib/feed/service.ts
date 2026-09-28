import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheGet, cacheSet } from '../cache';
import type { FeedItemRow, ReleaseGroupEmbed } from '../sj/data';
import { buildFeedTaste, type TasteRating } from './taste';
import { FEED_VERSION, rankExplore } from './ranking';
import { entryAuthor, entryKey, entryTime, type Candidate, type FeedEntry, type FeedTab, type HomeFeedPage, type RankedRef } from './types';

const PAGE_SIZE = 20;
const SESSION_TTL = 30 * 60;
const ALBUM = 'id,title,artist_display,primary_artist_id,genres,first_release_date,cover_url,release_group_type,native_title,artists!release_groups_primary_artist_id_fkey(name_native,country)';
const PROFILE = 'username,display_name,avatar_url,is_bot,is_verified,badge_color,founding_number,profile_visibility,deactivated_at';
const RATING = `id,user_id,score,review_text,created_at,release_groups(${ALBUM}),profiles!ratings_user_id_fkey!inner(${PROFILE})`;
const SHARE = `id,user_id,mix_id,caption,created_at,profiles!mix_shares_user_id_fkey!inner(${PROFILE}),mixes!inner(id,name,description,is_default,is_public,mix_items(release_groups(${ALBUM})),mix_song_items(release_groups(${ALBUM})))`;
interface Ref { kind: 'rating' | 'mix'; id: string; created_at: string }
interface Snapshot {
  viewer: string | null;
  tab: FeedTab;
  createdAt: number;
  refs: RankedRef[];
}
interface Cursor { session: string; offset: number; before?: string; key?: string }
const localSnapshots = new Map<string, Snapshot>();
export class FeedError extends Error { constructor(public status: number, message: string) { super(message); } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 1200) throw new Error();
    const c = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (!uuid.test(c.session) || !Number.isInteger(c.offset) || c.offset < 0 || c.offset > 10000) throw new Error();
    if (c.before != null && (!Number.isFinite(Date.parse(c.before)) || !c.key || !/^(rating|mix):[0-9a-f-]{36}$/.test(c.key))) throw new Error();
    return c;
  } catch { throw new FeedError(400, 'Invalid feed cursor'); }
}
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
async function saveSnapshot(id: string, snapshot: Snapshot) {
  for (const [key, value] of localSnapshots) if (Date.now() - value.createdAt > SESSION_TTL * 1000) localSnapshots.delete(key);
  if (localSnapshots.size >= 100) localSnapshots.delete(localSnapshots.keys().next().value!);
  localSnapshots.set(id, snapshot);
  await cacheSet(`feed:session:${id}`, snapshot, SESSION_TTL);
}
export async function readSnapshot(id: string, viewer: string | null) {
  if (!uuid.test(id)) throw new FeedError(400, 'Invalid feed session');
  const snapshot = await cacheGet<Snapshot>(`feed:session:${id}`) ?? localSnapshots.get(id);
  if (!snapshot || Date.now() - snapshot.createdAt > SESSION_TTL * 1000) throw new FeedError(410, 'Feed session expired');
  if (snapshot.viewer !== viewer) throw new FeedError(403, 'Feed session belongs to another viewer');
  return snapshot;
}

async function loadEntries(db: SupabaseClient, refs: RankedRef[], tab: FeedTab, viewer: string | null, blocked: Set<string>, dismissed: Set<string>) {
  const ratings = refs.filter(r => r.key.startsWith('rating:')).map(r => r.key.slice(7));
  const shares = refs.filter(r => r.key.startsWith('mix:')).map(r => r.key.slice(4));
  const entries: FeedEntry[] = [];
  const albums = new Map<string, ReleaseGroupEmbed[]>();
  const mayShow = (row: any) => row.profiles && !row.profiles.deactivated_at && !blocked.has(row.user_id)
    && (tab === 'following' || (row.profiles.profile_visibility === 'Public' && row.profiles.is_bot === false && row.user_id !== viewer));
  // Chunks keep PostgREST URLs below proxy limits. Inner joins + the caller's
  // JWT recheck deletion, privacy and deactivation on EVERY cursor request.
  for (let offset = 0; offset < Math.max(ratings.length, shares.length); offset += 100) {
    const ratingIds = ratings.slice(offset, offset + 100);
    const shareIds = shares.slice(offset, offset + 100);
    const [rr, ss] = await Promise.all([
      ratingIds.length ? db.from('ratings').select(RATING).in('id', ratingIds) : Promise.resolve({ data: [], error: null }),
      shareIds.length ? db.from('mix_shares').select(SHARE).in('id', shareIds).eq('mixes.is_public', true)
        .limit(12, { referencedTable: 'mixes.mix_items' }).limit(12, { referencedTable: 'mixes.mix_song_items' })
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const row of checked(rr) as any[]) {
      if (!mayShow(row) || !row.release_groups || (tab === 'explore' && dismissed.has(row.release_groups.id))) continue;
      entries.push({ kind: 'rating', item: row as FeedItemRow });
      albums.set(`rating:${row.id}`, [row.release_groups]);
    }
    for (const row of checked(ss) as any[]) {
      if (!mayShow(row) || !row.mixes?.is_public) continue;
      const members = [...(row.mixes.mix_items ?? []), ...(row.mixes.mix_song_items ?? [])]
        .map((m: any) => m.release_groups as ReleaseGroupEmbed).filter(Boolean);
      const unique = [...new Map<string, ReleaseGroupEmbed>(members.map(m => [m.id, m])).values()].slice(0, 12);
      if (tab === 'explore' && unique.length && unique.every(a => dismissed.has(a.id))) continue;
      albums.set(`mix:${row.id}`, unique);
      entries.push({ kind: 'mix', post: { id: row.id, userId: row.user_id, mixId: row.mix_id,
        caption: row.caption, createdAt: row.created_at, mixName: row.mixes.name,
        mixDescription: row.mixes.description, mixIsDefault: row.mixes.is_default,
        profile: row.profiles, coverUrls: unique.map(a => a.cover_url).filter((s): s is string => !!s).slice(0, 4) } });
    }
  }
  return { entries, albums };
}

async function social(db: SupabaseClient, entries: FeedEntry[], viewer: string | null) {
  const likes: Record<string, number> = {}, comments: Record<string, number> = {};
  const participants: Record<string, number> = {};
  const likedKeys: string[] = [];
  const affinity = new Map<string, number>();
  // Aggregation executes under RLS and excludes synthetic/deactivated actors.
  const result = checked(await db.rpc('get_home_feed_social', {
    p_rating_ids: entries.filter(e => e.kind === 'rating').map(e => e.item.id),
    p_share_ids: entries.filter(e => e.kind === 'mix').map(e => e.post.id),
  })) as { post_key: string; likes: number; comments: number; participants: number; liked: boolean }[];
  for (const r of result) {
    likes[r.post_key] = Number(r.likes); comments[r.post_key] = Number(r.comments);
    participants[r.post_key] = Number(r.participants);
    if (r.liked) likedKeys.push(r.post_key);
  }
  if (viewer) for (const entry of entries) if (likedKeys.includes(entryKey(entry))) {
    affinity.set(entryAuthor(entry), Math.min(0.6, (affinity.get(entryAuthor(entry)) ?? 0) + 0.15));
  }
  return { likes, comments, participants, likedKeys, affinity };
}

export async function homeFeed(db: SupabaseClient, viewer: string | null, tab: FeedTab, rawCursor: string | null): Promise<HomeFeedPage> {
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  const sessionId = cursor?.session ?? randomUUID();
  const snapshot = cursor ? await readSnapshot(sessionId, viewer) : { viewer, tab, createdAt: Date.now(), refs: [] } as Snapshot;
  if (snapshot.tab !== tab) throw new FeedError(400, 'Cursor belongs to another feed');
  if (tab === 'following' && !viewer) return { entries: [], nextCursor: null, sessionId, version: FEED_VERSION, positions: {}, reasons: {}, likeCounts: {}, commentCounts: {}, likedKeys: [] };
  const [blocksRes, dismissRes, followsRes] = await Promise.all([
    viewer ? db.from('blocked_users').select('blocked_id').eq('blocker_id', viewer) : Promise.resolve({ data: [], error: null }),
    viewer && tab === 'explore' ? db.from('not_interested').select('release_group_id').eq('user_id', viewer) : Promise.resolve({ data: [], error: null }),
    viewer ? db.from('follows').select('following_id').eq('follower_id', viewer) : Promise.resolve({ data: [], error: null }),
  ]);
  const blocked = new Set<string>((checked(blocksRes) as any[]).map(r => r.blocked_id));
  const dismissed = new Set<string>((checked(dismissRes) as any[]).map(r => r.release_group_id));
  const following = new Set<string>((checked(followsRes) as any[]).map(r => r.following_id));
  let nextCursor: string | null = null;
  let pageRefs: RankedRef[];
  const offset = cursor?.offset ?? 0;
  if (offset > snapshot.refs.length || offset % PAGE_SIZE !== 0) throw new FeedError(400, 'Invalid feed position');
  if (cursor && tab === 'following' && (!cursor.before || cursor.key !== snapshot.refs[offset - 1]?.key)) {
    throw new FeedError(400, 'Invalid following cursor');
  }
  if (tab === 'following') {
    const refs = checked(await db.rpc('get_home_feed_candidates', { p_tab: tab,
      p_before: cursor?.before ?? new Date(snapshot.createdAt).toISOString(), p_before_key: cursor?.key ?? null, p_limit: PAGE_SIZE + 1 })) as Ref[];
    const page = refs.slice(0, PAGE_SIZE);
    pageRefs = page.map(r => ({ key: `${r.kind}:${r.id}`, bucket: 'following' }));
    // Retry of a cursor is idempotent; never shift already recorded positions.
    snapshot.refs.splice(offset, PAGE_SIZE, ...pageRefs);
    if (refs.length > PAGE_SIZE) {
      const last = page.at(-1)!;
      nextCursor = encodeCursor({ session: sessionId, offset: offset + PAGE_SIZE, before: last.created_at, key: `${last.kind}:${last.id}` });
    }
  } else {
    if (!cursor) {
      const [ratingResult, profileResult, seenResult] = await Promise.all([
        viewer ? db.from('ratings').select(`score,created_at,release_groups(${ALBUM})`).eq('user_id', viewer).order('created_at', { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
        viewer ? db.from('profiles').select('recommendation_adventurousness').eq('id', viewer).single() : Promise.resolve({ data: null, error: null }),
        viewer ? db.from('feed_impressions').select('post_key').eq('viewer_id', viewer).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
      ]);
      const taste = buildFeedTaste(checked(ratingResult) as unknown as TasteRating[], snapshot.createdAt);
      const profile = checked(profileResult) as { recommendation_adventurousness: number } | null;
      const seen = new Set<string>((checked(seenResult) as any[]).map(r => r.post_key));
      const refs = checked(await db.rpc('get_home_feed_candidates', { p_tab: tab, p_artists: taste.artistIds, p_genres: taste.genres, p_before: new Date(snapshot.createdAt).toISOString() })) as Ref[];
      const loaded = await loadEntries(db, refs.map(r => ({ key: `${r.kind}:${r.id}`, bucket: 'exploration' })), tab, viewer, blocked, dismissed);
      const signals = await social(db, loaded.entries, viewer);
      const candidates: Candidate[] = loaded.entries.map(entry => {
        const key = entryKey(entry), author = entryAuthor(entry), albums = loaded.albums.get(key) ?? [];
        return { key, author, createdAt: entryTime(entry), albums,
          format: entry.kind === 'mix' ? 'mix' : entry.item.review_text?.trim() ? 'review' : 'rating',
          text: entry.kind === 'mix' ? `${entry.post.caption ?? ''} ${entry.post.mixDescription ?? ''}` : entry.item.review_text ?? '',
          relevance: albums.length ? albums.reduce((sum, a) => sum + taste.score(a), 0) / albums.length : 0.5,
          authorAffinity: following.has(author) ? 1 : signals.affinity.get(author) ?? 0,
          // Cold-start bounded evidence; do not pretend raw counts are impression-normalized rates.
          response: 1 - Math.exp(-(signals.participants[key] ?? 0) / 10),
          seen: seen.has(key), knownArtist: albums.some(taste.knownArtist), followed: following.has(author) };
      });
      snapshot.refs = rankExplore(candidates, profile?.recommendation_adventurousness ?? 50, snapshot.createdAt);
    }
    pageRefs = snapshot.refs.slice(offset, offset + PAGE_SIZE);
    if (offset + PAGE_SIZE < snapshot.refs.length) nextCursor = encodeCursor({ session: sessionId, offset: offset + PAGE_SIZE });
  }
  const loaded = await loadEntries(db, pageRefs, tab, viewer, blocked, dismissed);
  const byKey = new Map(loaded.entries.filter(e => tab !== 'following' || following.has(entryAuthor(e))).map(e => [entryKey(e), e]));
  const entries = pageRefs.flatMap(ref => byKey.has(ref.key) ? [byKey.get(ref.key)!] : []);
  const signals = await social(db, entries, viewer);
  await saveSnapshot(sessionId, snapshot);
  return { entries, nextCursor, sessionId, version: FEED_VERSION,
    positions: Object.fromEntries(pageRefs.map((r, i) => [r.key, offset + i])),
    reasons: Object.fromEntries(pageRefs.map(r => [r.key, r.bucket])),
    likeCounts: signals.likes, commentCounts: signals.comments, likedKeys: signals.likedKeys };
}
