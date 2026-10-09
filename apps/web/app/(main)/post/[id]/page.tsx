'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import ProfilePostCard from '../../../../components/sj/ProfilePostCard';
import ProfileRatingEditor from '../../../../components/sj/ProfileRatingEditor';
import type { ProfileRatingItem } from '../../../../components/sj/ProfileView';
import { useSession } from '../../../../components/sj/SessionContext';
import { SkeletonBlock } from '../../../../components/sj/Loading';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName } from '../../../../lib/sj/display';
import { RG_EMBED_NATIVE } from '../../../../lib/sj/data';

/**
 * Single-post view -- web sibling of iOS AlbumPostDetailView. Exists so a like/comment
 * notification can link to the actual post (with its own review text and like/comment thread)
 * instead of the bare album page, which only shows aggregate community stats. The id is a
 * `ratings` id; song ratings stopped being posts on 2026-10-06, so there's no song variant.
 * A notification's rating_id always belongs to the CURRENT signed-in user (the
 * notify triggers set the recipient to the row's owner and exclude self-notifications), so a
 * plain id-keyed fetch is safe here without an extra ownership check -- same invariant iOS's
 * comment on this pattern documents.
 */
export default function PostPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { userId: myId, profile, ready, requireAuth } = useSession();

  const [item, setItem] = useState<ProfileRatingItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [likesCount, setLikesCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!ready || !supabase || !myId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: raw } = await supabase!
        .from('ratings')
        .select(`id, score, review_text, created_at, ${RG_EMBED_NATIVE}`)
        .eq('id', params.id)
        .maybeSingle();
      if (cancelled) return;
      if (!raw) {
        setItem(null);
        setLoading(false);
        return;
      }
      const r = raw as any;
      const rg = r.release_groups;
      setItem({
        ratingId: r.id,
        key: `a-${r.id}`,
        isSong: false,
        recordingId: null,
        releaseGroupId: rg?.id ?? null,
        title: rg ? displayName(rg.title, rg.native_title) : '',
        artistLine: rg ? displayName(rg.artist_display, rg.artists?.name_native) : '',
        artistId: rg?.primary_artist_id ?? null,
        artistName: rg ? displayName(rg.artist_display, rg.artists?.name_native) : '',
        coverUrl: rg?.cover_url ?? null,
        releaseType: rg?.release_group_type ?? null,
        score: r.score,
        reviewText: r.review_text,
        createdAt: r.created_at,
        releaseTitle: rg?.title ?? '',
        releaseArtist: rg?.artist_display ?? '',
      });

      const [{ count: likes }, { count: comments }, { data: myLike }] =
        await Promise.all([
          supabase!.from('rating_likes').select('*', { count: 'exact', head: true }).eq('rating_id', params.id),
          supabase!
            .from('rating_comments')
            .select('*', { count: 'exact', head: true })
            .eq('rating_id', params.id),
          supabase!.from('rating_likes').select('rating_id').eq('user_id', myId).eq('rating_id', params.id),
        ]);
      if (cancelled) return;
      setLikesCount(likes ?? 0);
      setCommentsCount(comments ?? 0);
      setIsLiked(((myLike as any[] | null) ?? []).length > 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, myId, params.id]);

  async function toggleLike() {
    if (!supabase || !item) return;
    if (!requireAuth() || !myId) return;
    const wasLiked = isLiked;
    setIsLiked(!wasLiked);
    setLikesCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    if (wasLiked) {
      await supabase.from('rating_likes').delete().eq('user_id', myId).eq('rating_id', item.ratingId);
    } else {
      await supabase.from('rating_likes').insert({ user_id: myId, rating_id: item.ratingId });
    }
  }

  async function deleteAndReturn() {
    if (!supabase || !myId || !item) return;
    await supabase.from('ratings').delete().eq('id', item.ratingId);
    router.replace('/profile');
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-7">
      {loading ? (
        <SkeletonBlock className="h-40" />
      ) : !item ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <AlertCircle size={38} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.notifications.postUnavailable')}</p>
        </div>
      ) : (
        <ProfilePostCard
          item={item}
          userId={myId!}
          likesCount={likesCount}
          commentsCount={commentsCount}
          isLiked={isLiked}
          onLike={toggleLike}
          onDelete={deleteAndReturn}
          onEdit={() => setEditing(true)}
        />
      )}
      <ProfileRatingEditor
        item={editing ? item : null}
        step={profile?.manual_rating_step ?? 0.5}
        onClose={() => setEditing(false)}
        onChange={setItem}
        onDelete={() => { setEditing(false); void deleteAndReturn(); }}
      />
    </div>
  );
}
