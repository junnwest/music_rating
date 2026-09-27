import { supabase } from '../supabaseClient';

/**
 * Mix posts — `mix_shares` (migration 20260706000015): a public mix posted to
 * the feed with an optional caption, with its own like/comment threads. Web
 * mirror of iOS HomeViewModel's mix-share fetches + MixShareComposerView.
 */

export interface MixSharePost {
  id: string;
  userId: string;
  mixId: string;
  caption: string | null;
  createdAt: string;
  mixName: string;
  mixDescription: string | null;
  mixIsDefault: boolean;
  profile: { username: string | null; display_name: string | null } | null;
  coverUrls: string[];
}

export const MIX_SHARE_CAPTION_MAX = 500;

const SELECT =
  'id, user_id, mix_id, caption, created_at, mixes(id, name, description, is_default), profiles!mix_shares_user_id_fkey(username, display_name)';

type Err = { message: string } | null;

/** Newest mix posts — all, or only by `userIds`. Covers resolved in one RPC. */
export async function loadMixShares(opts: {
  userIds?: string[];
  limit?: number;
}): Promise<{ data: MixSharePost[] | null; error: Err }> {
  if (!supabase) return { data: null, error: { message: 'no client' } };
  if (opts.userIds && opts.userIds.length === 0) return { data: [], error: null };
  let q = supabase
    .from('mix_shares')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.userIds) q = q.in('user_id', opts.userIds);
  const { data, error } = await q;
  if (error) return { data: null, error };
  // A share whose mix went private (or was deleted) embeds as null under RLS —
  // there's nothing to show, so it drops out.
  const rows = ((data as any[]) ?? []).filter((r) => r.mixes);
  const mixIds = Array.from(new Set(rows.map((r) => r.mix_id as string)));
  const byMix: Record<string, string[]> = {};
  if (mixIds.length) {
    const { data: covers, error: cErr } = await supabase.rpc('get_mix_covers', {
      p_mix_ids: mixIds,
      p_limit: 4,
    });
    if (cErr) console.error('[mixShares] covers failed:', cErr.message);
    for (const c of (covers as { mix_id: string; cover_url: string | null }[] | null) ?? []) {
      if (c.cover_url) (byMix[c.mix_id] ??= []).push(c.cover_url);
    }
  }
  return {
    data: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      mixId: r.mix_id,
      caption: r.caption,
      createdAt: r.created_at,
      mixName: r.mixes.name,
      mixDescription: r.mixes.description ?? null,
      mixIsDefault: !!r.mixes.is_default,
      profile: r.profiles ?? null,
      coverUrls: byMix[r.mix_id] ?? [],
    })),
    error: null,
  };
}

/** Like/comment counts for a set of posts, plus which ones `userId` liked. */
export async function loadMixShareSocial(
  shareIds: string[],
  userId: string | null | undefined,
): Promise<{ likes: Record<string, number>; comments: Record<string, number>; liked: Set<string> }> {
  const likes: Record<string, number> = {};
  const comments: Record<string, number> = {};
  const liked = new Set<string>();
  if (!supabase || shareIds.length === 0) return { likes, comments, liked };
  const [l, c, mine] = await Promise.all([
    supabase.from('mix_share_likes').select('mix_share_id').in('mix_share_id', shareIds),
    supabase.from('mix_share_comments').select('mix_share_id').in('mix_share_id', shareIds),
    userId
      ? supabase
          .from('mix_share_likes')
          .select('mix_share_id')
          .eq('user_id', userId)
          .in('mix_share_id', shareIds)
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of (l.data as { mix_share_id: string }[] | null) ?? [])
    likes[r.mix_share_id] = (likes[r.mix_share_id] ?? 0) + 1;
  for (const r of (c.data as { mix_share_id: string }[] | null) ?? [])
    comments[r.mix_share_id] = (comments[r.mix_share_id] ?? 0) + 1;
  for (const r of (mine.data as { mix_share_id: string }[] | null) ?? []) liked.add(r.mix_share_id);
  return { likes, comments, liked };
}

export async function setMixShareLike(
  userId: string,
  shareId: string,
  like: boolean,
): Promise<{ error: Err }> {
  if (!supabase) return { error: { message: 'no client' } };
  const { error } = like
    ? await supabase.from('mix_share_likes').insert({ user_id: userId, mix_share_id: shareId })
    : await supabase
        .from('mix_share_likes')
        .delete()
        .eq('user_id', userId)
        .eq('mix_share_id', shareId);
  if (error) console.error('[mixShares] like failed:', error.message);
  return { error };
}

/** Post a (public) mix to the feed. RLS rejects private mixes. */
export async function postMix(
  userId: string,
  mixId: string,
  caption: string,
): Promise<{ error: Err }> {
  if (!supabase) return { error: { message: 'no client' } };
  const trimmed = caption.trim().slice(0, MIX_SHARE_CAPTION_MAX);
  const { error } = await supabase
    .from('mix_shares')
    .insert({ user_id: userId, mix_id: mixId, caption: trimmed === '' ? null : trimmed });
  return { error };
}
