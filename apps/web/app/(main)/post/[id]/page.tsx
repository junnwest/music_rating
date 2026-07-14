'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import ProfilePostCard from '../../../../components/sj/ProfilePostCard';
import ProfileSongPostCard from '../../../../components/sj/ProfileSongPostCard';
import type { ProfileRatingItem } from '../../../../components/sj/ProfileView';
import { useSession } from '../../../../components/sj/SessionContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName } from '../../../../lib/sj/display';
import { RG_EMBED_NATIVE } from '../../../../lib/sj/data';

/**
 * Single-post view -- web sibling of iOS AlbumPostDetailView/SongPostDetailView. Exists so a
 * like/comment notification can link to the actual post (with its own review text and
 * like/comment thread) instead of the bare album/song page, which only shows aggregate
 * community stats. `?song=1` selects the track_ratings path; otherwise this is a `ratings` id.
 * A notification's rating_id/track_rating_id always belongs to the CURRENT signed-in user (the
 * notify triggers set the recipient to the row's owner and exclude self-notifications), so a
 * plain id-keyed fetch is safe here without an extra ownership check -- same invariant iOS's
 * comment on this pattern documents.
 */
export default function PostPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const isSong = searchParams.get('song') === '1';
  const { userId: myId, ready, requireAuth } = useSession();

  const [item, setItem] = useState<ProfileRatingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [instinctCount, setInstinctCount] = useState(0);
  const [likesCount, setLikesCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!ready || !supabase || !myId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (isSong) {
        const { data: raw } = await supabase!
          .from('track_ratings')
          .select(
            'id, recording_id, score, elo_score, review_text, created_at, recordings(id, title, artist_display)',
          )
          .eq('id', params.id)
          .maybeSingle();
        if (cancelled) return;
        if (!raw) {
          setItem(null);
          setLoading(false);
          return;
        }
        const r = raw as any;
        const { data: coverRows } = await supabase!
          .from('release_tracks')
          .select('releases(is_canonical, release_groups(id, title, artist_display, cover_url))')
          .eq('recording_id', r.recording_id);
        let rg: any = null;
        for (const row of (coverRows as any[] | null) ?? []) {
          const candidate = row.releases?.release_groups;
          if (!candidate) continue;
          if (row.releases?.is_canonical || !rg) rg = candidate;
        }
        if (cancelled) return;
        setItem({
          ratingId: r.id,
          key: `s-${r.recording_id}`,
          isSong: true,
          recordingId: r.recording_id,
          releaseGroupId: rg?.id ?? null,
          title: r.recordings?.title ?? 'Unknown Track',
          artistLine: `${rg?.title ?? ''} · ${rg?.artist_display ?? r.recordings?.artist_display ?? ''}`,
          coverUrl: rg?.cover_url ?? null,
          releaseType: null,
          score: r.score,
          eloScore: r.elo_score,
          reviewText: r.review_text,
          createdAt: r.created_at,
          releaseTitle: rg?.title ?? '',
          releaseArtist: rg?.artist_display ?? '',
        });

        const [{ count: total }, { count: likes }, { count: comments }, { data: myLike }] =
          await Promise.all([
            supabase!.from('track_ratings').select('*', { count: 'exact', head: true }).eq('user_id', myId),
            supabase!
              .from('track_rating_likes')
              .select('*', { count: 'exact', head: true })
              .eq('track_rating_id', params.id),
            supabase!
              .from('track_rating_comments')
              .select('*', { count: 'exact', head: true })
              .eq('track_rating_id', params.id),
            supabase!
              .from('track_rating_likes')
              .select('track_rating_id')
              .eq('user_id', myId)
              .eq('track_rating_id', params.id),
          ]);
        if (cancelled) return;
        setInstinctCount(total ?? 0);
        setLikesCount(likes ?? 0);
        setCommentsCount(comments ?? 0);
        setIsLiked(((myLike as any[] | null) ?? []).length > 0);
      } else {
        const { data: raw } = await supabase!
          .from('ratings')
          .select(`id, score, elo_score, review_text, created_at, ${RG_EMBED_NATIVE}`)
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
          coverUrl: rg?.cover_url ?? null,
          releaseType: rg?.release_group_type ?? null,
          score: r.score,
          eloScore: r.elo_score,
          reviewText: r.review_text,
          createdAt: r.created_at,
          releaseTitle: rg?.title ?? '',
          releaseArtist: rg?.artist_display ?? '',
        });

        const [{ count: total }, { count: likes }, { count: comments }, { data: myLike }] =
          await Promise.all([
            supabase!.from('ratings').select('*', { count: 'exact', head: true }).eq('user_id', myId),
            supabase!.from('rating_likes').select('*', { count: 'exact', head: true }).eq('rating_id', params.id),
            supabase!
              .from('rating_comments')
              .select('*', { count: 'exact', head: true })
              .eq('rating_id', params.id),
            supabase!.from('rating_likes').select('rating_id').eq('user_id', myId).eq('rating_id', params.id),
          ]);
        if (cancelled) return;
        setInstinctCount(total ?? 0);
        setLikesCount(likes ?? 0);
        setCommentsCount(comments ?? 0);
        setIsLiked(((myLike as any[] | null) ?? []).length > 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, myId, params.id, isSong]);

  async function toggleLike() {
    if (!supabase || !item) return;
    if (!requireAuth() || !myId) return;
    const wasLiked = isLiked;
    setIsLiked(!wasLiked);
    setLikesCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    const table = isSong ? 'track_rating_likes' : 'rating_likes';
    const col = isSong ? 'track_rating_id' : 'rating_id';
    if (wasLiked) {
      await supabase.from(table).delete().eq('user_id', myId).eq(col, item.ratingId);
    } else {
      await supabase.from(table).insert({ user_id: myId, [col]: item.ratingId });
    }
  }

  async function deleteAndReturn() {
    if (!supabase || !myId || !item) return;
    if (isSong && item.recordingId) {
      await supabase.from('track_ratings').delete().eq('user_id', myId).eq('recording_id', item.recordingId);
    } else {
      await supabase.from('ratings').delete().eq('id', item.ratingId);
    }
    router.replace('/profile');
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-7">
      {loading ? (
        <div className="h-40 rounded-2xl bg-surface animate-pulse" />
      ) : !item ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <AlertCircle size={38} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.notifications.postUnavailable')}</p>
        </div>
      ) : item.isSong ? (
        <ProfileSongPostCard
          item={item}
          instinctSongCount={instinctCount}
          likesCount={likesCount}
          commentsCount={commentsCount}
          isLiked={isLiked}
          onLike={toggleLike}
          onDelete={deleteAndReturn}
        />
      ) : (
        <ProfilePostCard
          item={item}
          instinctAlbumCount={instinctCount}
          likesCount={likesCount}
          commentsCount={commentsCount}
          isLiked={isLiked}
          onLike={toggleLike}
          onDelete={deleteAndReturn}
        />
      )}
    </div>
  );
}
