'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Plus,
  ChevronRight,
  ExternalLink,
  ListMusic,
  Bookmark,
} from 'lucide-react';
import AlbumRateButton from '../../../../components/sj/AlbumRateButton';
import ArtistLink from '../../../../components/sj/ArtistLink';
import Avatar from '../../../../components/sj/Avatar';
import Cover from '../../../../components/sj/Cover';
import { useContextMenuFor, openInNewTab } from '../../../../components/sj/ContextMenu';
import FlowerGlyph from '../../../../components/sj/FlowerGlyph';
import ManualRateModal from '../../../../components/sj/ManualRateModal';
import InlineRatingEditor from '../../../../components/sj/InlineRatingEditor';
import MixPickerModal from '../../../../components/sj/MixPickerModal';
import ScoreBadge from '../../../../components/sj/ScoreBadge';
import RatingHistogram from '../../../../components/sj/RatingHistogram';
import {
  Skeleton,
  SkeletonBlock,
  SkeletonLine,
  SkeletonRows,
} from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { useRatings } from '../../../../components/sj/RatingsStore';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import {
  displayName,
  displayScore,
  formatScore,
  relativeTime,
  typeLabelKey,
  yearOf,
} from '../../../../lib/sj/display';
import type { SJRelease } from '../../../../lib/sj/data';
import type { ReleaseGroupCreditRPC } from '../../../../lib/db/types';

interface TrackEntry {
  recordingId: string;
  discNumber: number;
  position: number;
  title: string;
  durationMs: number | null;
  artists: string | null;
}

interface PostRow {
  id: string;
  user_id: string;
  score: number | null;
  review_text: string | null;
  created_at: string;
  profiles: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface PublicMix {
  id: string;
  name: string;
  authorHandle: string;
  authorUsername: string | null;
}

/**
 * Album (release group) page — web sibling of iOS AlbumDetailView, laid out
 * for desktop: sticky cover/meta column on the left, rating + tracklist +
 * community on the right.
 */
export default function AlbumPage() {
  const params = useParams<{ id: string }>();
  const releaseGroupId = params.id;
  const { t, lang } = useLanguage();
  const { userId, profile } = useSession();
  const { applyLocal } = useRatings();

  const [release, setRelease] = useState<SJRelease | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [credits, setCredits] = useState<ReleaseGroupCreditRPC[]>([]);
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [trackRatings, setTrackRatings] = useState<Record<string, number>>({});
  const [communityAvg, setCommunityAvg] = useState<number | null>(null);
  const [communitySD, setCommunitySD] = useState<number | null>(null);
  const [communityCount, setCommunityCount] = useState(0);
  const [scoreDist, setScoreDist] = useState<number[]>([]);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [publicMixes, setPublicMixes] = useState<PublicMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [showMixPicker, setShowMixPicker] = useState(false);
  const [trackManualTarget, setTrackManualTarget] = useState<TrackEntry | null>(null);

  // Inline comment (review_text on the user's rating row)
  const [reviewDraft, setReviewDraft] = useState('');
  const myReviewRef = useRef<string | null>(null);
  const reviewBoxRef = useRef<HTMLTextAreaElement>(null);
  const reviewTimer = useRef<ReturnType<typeof setTimeout>>();

  const ratingStep = profile?.manual_rating_step ?? 0.5;

  // Right-click menu for the tracklist. One instance for the whole list — each
  // row hands itself in as the subject (see `useContextMenuFor`).
  const { onContextMenu: onTrackContextMenu, menu: trackContextMenu } =
    useContextMenuFor<TrackEntry>((track) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(`/song/${track.recordingId}?rg=${releaseGroupId}`),
      },
      ...(userId
        ? [
            {
              key: 'rate',
              label: t('sj.context.rate'),
              icon: <FlowerGlyph size={14} src="/icon-flower.svg" />,
              onSelect: () => setTrackManualTarget(track),
            },
          ]
        : []),
    ]);

  const loadRatings = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('ratings')
      .select('score, user_id, review_text')
      .eq('release_group_id', releaseGroupId);
    const rows =
      (data as
        | { score: number | null; user_id: string; review_text: string | null }[]
        | null) ?? [];
    setCommunityCount(rows.length);
    const scored = rows.map((r) => r.score).filter((s): s is number => s != null);
    setCommunityAvg(scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null);
    // "Split" (편차): population SD of the same scored array as the average.
    // Nil below 3 scores, where a deviation is statistically meaningless.
    if (scored.length >= 3) {
      const mean = scored.reduce((a, b) => a + b, 0) / scored.length;
      const variance = scored.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scored.length;
      setCommunitySD(Math.sqrt(variance));
    } else {
      setCommunitySD(null);
    }
    // Distribution: ten 0.5-wide buckets (0.5 … 5.0)
    const dist = new Array(10).fill(0) as number[];
    for (const s of scored) {
      dist[Math.min(Math.max(Math.round(s * 2) - 1, 0), 9)] += 1;
    }
    setScoreDist(dist);
    if (userId) {
      const mine = rows.find((r) => r.user_id === userId);
      setUserScore(mine?.score ?? null);
      // Keep the app-wide store in sync so every other surface for this album
      // (feed, charts, artist…) reflects edits made here, and vice-versa.
      applyLocal(releaseGroupId, mine?.score ?? null);
      myReviewRef.current = mine?.review_text ?? null;
      // Don't clobber in-progress typing
      if (document.activeElement !== reviewBoxRef.current) {
        setReviewDraft(mine?.review_text ?? '');
      }
    }
  }, [releaseGroupId, userId, applyLocal]);

  const saveReview = useCallback(
    async (text: string) => {
      if (!supabase || !userId) return;
      const next = text.trim() || null;
      if (next === myReviewRef.current) return;
      myReviewRef.current = next;
      await supabase
        .from('ratings')
        .update({ review_text: next })
        .eq('user_id', userId)
        .eq('release_group_id', releaseGroupId);
    },
    [userId, releaseGroupId],
  );

  function onReviewChange(text: string) {
    setReviewDraft(text);
    clearTimeout(reviewTimer.current);
    reviewTimer.current = setTimeout(() => saveReview(text), 1000);
  }

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Core release group
      const { data: rg } = await supabase!
        .from('release_groups')
        .select(
          'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, genres, artists!release_groups_primary_artist_id_fkey(name_native)',
        )
        .eq('id', releaseGroupId)
        .maybeSingle();
      if (cancelled) return;
      if (!rg) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const rgAny = rg as any;
      setRelease({
        id: rgAny.id,
        title: rgAny.title,
        artist: rgAny.artist_display,
        coverUrl: rgAny.cover_url,
        releaseType: rgAny.release_group_type,
        releaseDate: rgAny.first_release_date,
        titleNative: rgAny.native_title,
        artistNative: rgAny.artists?.name_native ?? null,
      });
      setGenres(((rgAny.genres as string[] | null) ?? []).slice(0, 4));

      // Parallel: credits, ratings, posts, mixes, tracklist
      const creditsP = supabase!
        .rpc('get_release_group_credits', { p_release_group_id: releaseGroupId })
        .then(({ data }) => {
          if (!cancelled) setCredits((data as ReleaseGroupCreditRPC[] | null) ?? []);
        });

      const postsP = supabase!
        .from('ratings')
        .select(
          'id, user_id, score, review_text, created_at, profiles(username, display_name, avatar_url)',
        )
        .eq('release_group_id', releaseGroupId)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (!cancelled) setPosts((data as unknown as PostRow[] | null) ?? []);
        });

      const mixesP = (async () => {
        const { data: refs } = await supabase!
          .from('mix_items')
          .select('mix_id')
          .eq('release_group_id', releaseGroupId)
          .limit(50);
        const mixIds = Array.from(
          new Set(((refs as { mix_id: string }[] | null) ?? []).map((r) => r.mix_id)),
        );
        if (mixIds.length === 0) return;
        const { data: mixRows } = await supabase!
          .from('mixes')
          // Same PGRST201 ambiguity as the mix page: `mix_likes` is a second
          // mixes↔profiles path, so the embed needs the FK hint or the whole
          // query fails and this section silently renders empty.
          .select('id, name, profiles!mixes_user_id_fkey(id, username, display_name)')
          .in('id', mixIds)
          .eq('is_public', true)
          .limit(10);
        if (cancelled) return;
        setPublicMixes(
          ((mixRows as any[] | null) ?? []).map((m) => ({
            id: m.id,
            name: m.name,
            authorHandle: m.profiles?.username
              ? `@${m.profiles.username}`
              : m.profiles?.display_name ?? 'someone',
            authorUsername: m.profiles?.username ?? null,
          })),
        );
      })();

      const tracksP = (async () => {
        const { data: canonical } = await supabase!
          .from('releases')
          .select('id')
          .eq('release_group_id', releaseGroupId)
          .eq('is_canonical', true)
          .limit(1);
        const canonicalId = (canonical as { id: string }[] | null)?.[0]?.id;
        if (!canonicalId) return;
        const { data: rows } = await supabase!
          .from('release_tracks')
          .select('position, disc_number, recordings(id, title, duration_ms, artist_display)')
          .eq('release_id', canonicalId)
          // Positions restart on every disc, so disc_number has to lead the sort —
          // ordering by position alone interleaves disc 2 into disc 1 and renders
          // as duplicate track numbers.
          .order('disc_number')
          .order('position');
        if (cancelled) return;
        const loaded: TrackEntry[] = ((rows as any[] | null) ?? []).map((r) => ({
          recordingId: r.recordings.id,
          discNumber: r.disc_number ?? 1,
          position: r.position,
          title: r.recordings.title,
          durationMs: r.recordings.duration_ms,
          artists: r.recordings.artist_display,
        }));
        setTracks(loaded);
        // Per-track user ratings
        if (userId && loaded.length > 0) {
          const { data: trs } = await supabase!
            .from('track_ratings')
            .select('recording_id, score')
            .eq('user_id', userId)
            .in('recording_id', loaded.map((tr) => tr.recordingId));
          if (cancelled) return;
          const map: Record<string, number> = {};
          for (const r of (trs as { recording_id: string; score: number | null }[] | null) ?? []) {
            if (r.score != null) map[r.recording_id] = r.score;
          }
          setTrackRatings(map);
        }
      })();

      await Promise.all([creditsP, postsP, mixesP, tracksP, loadRatings()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [releaseGroupId, userId, loadRatings]);

  async function setRating(score: number | null) {
    if (!supabase || !userId) return;
    let error;
    if (score != null) {
      ({ error } = await supabase
        .from('ratings')
        .upsert(
          { user_id: userId, release_group_id: releaseGroupId, score },
          { onConflict: 'user_id,release_group_id' },
        ));
    } else {
      ({ error } = await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', releaseGroupId));
    }
    if (error) console.error('[album setRating] rating write failed', { releaseGroupId, score, error });
    await loadRatings();
  }

  async function rateTrack(recordingId: string, score: number | null) {
    if (!supabase || !userId) return;
    if (score != null) {
      await supabase
        .from('track_ratings')
        .upsert(
          { user_id: userId, recording_id: recordingId, score },
          { onConflict: 'user_id,recording_id' },
        );
      setTrackRatings((prev) => ({ ...prev, [recordingId]: score }));
    } else {
      await supabase
        .from('track_ratings')
        .delete()
        .eq('user_id', userId)
        .eq('recording_id', recordingId);
      setTrackRatings((prev) => {
        const next = { ...prev };
        delete next[recordingId];
        return next;
      });
    }
  }

  if (notFound) {
    return (
      <div className="py-32 text-center text-muted text-[15px]">{t('sj.album.notFound')}</div>
    );
  }

  if (loading || !release) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 flex gap-10">
        <Skeleton className="w-64 h-64 shrink-0 rounded-2xl bg-surface border border-divider/60 hidden md:block" />
        <div className="flex-1 space-y-4">
          <SkeletonLine w="w-2/3" h="h-8" className="rounded-lg" />
          <SkeletonLine w="w-1/3" h="h-4" />
          <SkeletonBlock className="h-40" />
          <SkeletonRows count={4} className="pt-2" />
        </div>
      </div>
    );
  }

  const title = displayName(release.title, release.titleNative);
  const year = yearOf(release.releaseDate);

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 flex flex-col md:flex-row gap-8 md:gap-10">
      {/* ── Left: cover + meta (sticky on desktop) ── */}
      <div className="md:w-64 shrink-0">
        <div className="md:sticky md:top-[76px] flex md:flex-col gap-4">
          {/* Cover + quick-rate flower overlapping its bottom-right corner */}
          <div className="relative shrink-0 w-28 h-28 md:w-64 md:h-64">
            <Cover
              url={release.coverUrl}
              thumb={false}
              className="w-full h-full"
              rounded="rounded-2xl"
            />
            {userId && (
              <AlbumRateButton
                release={release}
                score={userScore}
                onScoreChange={() => void loadRatings()}
                size={32}
                className="absolute bottom-1.5 right-1.5 md:bottom-2.5 md:right-2.5"
              />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] md:text-[22px] font-bold text-ink leading-snug">
              {title}
            </h1>
            <p className="mt-1 text-[14px] leading-relaxed">
              {credits.length === 0 ? (
                <ArtistLink
                  href={`/artist/${encodeURIComponent(release.artist)}`}
                  className="text-muted hover:text-ink hover:underline"
                >
                  {displayName(release.artist, release.artistNative)}
                </ArtistLink>
              ) : (
                credits.map((c) => (
                  <span key={c.position}>
                    <ArtistLink
                      href={`/artist/${c.artist_id}`}
                      className="text-accent hover:underline"
                    >
                      {c.credited_as}
                    </ArtistLink>
                    {c.join_phrase && <span className="text-muted">{c.join_phrase}</span>}
                  </span>
                ))
              )}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <span className="px-2.5 py-1 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">
                {t(typeLabelKey(release.releaseType))}
              </span>
              {year && (
                <span className="px-2.5 py-1 rounded-full bg-muted/10 text-muted text-[11px] font-semibold">
                  {year}
                </span>
              )}
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {genres.map((g) => (
                  <Link
                    key={g}
                    href={`/charts/ranking?genre=${encodeURIComponent(g)}`}
                    className="px-2 py-0.5 rounded-full border border-divider text-[11px] text-muted hover:text-accent hover:border-accent/50 transition"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}

            {/* Listen on … (search deep-links; no stored platform preference post-renovation) */}
            <div className="mt-4">
              <p className="text-[10px] font-semibold tracking-[0.05em] uppercase text-muted mb-1.5">
                {t('sj.album.listenOn')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['Spotify', `https://open.spotify.com/search/${encodeURIComponent(`${release.artist} ${release.title}`)}`],
                    ['Apple Music', `https://music.apple.com/search?term=${encodeURIComponent(`${release.artist} ${release.title}`)}`],
                    ['YouTube Music', `https://music.youtube.com/search?q=${encodeURIComponent(`${release.artist} ${release.title}`)}`],
                  ] as [string, string][]
                ).map(([name, url]) => (
                  <a
                    key={name}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface border border-divider text-[11.5px] font-medium text-mid hover:text-ink hover:border-muted transition"
                  >
                    {name}
                    <ExternalLink size={10} className="text-muted" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: rating + tracklist + community ── */}
      <div className="flex-1 min-w-0">
        {/* Rating section (mode-aware) */}
        <section className="rounded-2xl bg-surface border border-divider/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted">
              {t('sj.album.yourRating')}
            </h2>
            {userId && (
              <button
                onClick={() => setShowMixPicker(true)}
                aria-label={t('sj.rate.addToList')}
                className="p-1.5 -my-1.5 rounded-lg text-muted hover:text-accent hover:bg-page transition"
              >
                <Bookmark size={17} />
              </button>
            )}
          </div>

          {!userId ? (
            <Link
              href="/login"
              className="block w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold text-center hover:opacity-90 transition"
            >
              {t('sj.album.signInToRate')}
            </Link>
          ) : (
            <InlineRatingEditor score={userScore} step={ratingStep} onSave={setRating} />
          )}

          {/* Inline comment — visible whenever the user has a rating row */}
          {userId && userScore != null && (
            <textarea
              ref={reviewBoxRef}
              value={reviewDraft}
              onChange={(e) => onReviewChange(e.target.value)}
              onBlur={() => {
                clearTimeout(reviewTimer.current);
                saveReview(reviewDraft);
              }}
              placeholder={t('sj.rate.addComment')}
              rows={2}
              className="w-full mt-4 px-3.5 py-2.5 rounded-xl bg-page border border-divider text-[13.5px] leading-relaxed text-ink placeholder-placeholder outline-none focus:border-accent/60 transition resize-none"
            />
          )}

          {communityCount > 0 && (
            /* Three equal columns: Avg | Ratings | Split (±population SD; "—" under 3 scores) */
            <div className="flex gap-2.5 mt-4">
              <div className="flex flex-1 items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
                <FlowerGlyph size={12} className="text-accent shrink-0" />
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink leading-tight">
                    {communityAvg != null ? communityAvg.toFixed(1) : '—'}
                  </p>
                  <p className="text-[10px] text-muted truncate">{t('sj.album.communityAvg')}</p>
                </div>
              </div>
              <div className="flex-1 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
                <p className="text-[15px] font-bold text-ink leading-tight">{communityCount}</p>
                <p className="text-[10px] text-muted truncate">{t('sj.album.ratings')}</p>
              </div>
              <div className="flex-1 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
                <p className="text-[15px] font-bold text-ink leading-tight">
                  {communitySD != null ? `±${communitySD.toFixed(1)}` : '—'}
                </p>
                <p className="text-[10px] text-muted truncate">{t('sj.album.split')}</p>
              </div>
            </div>
          )}

          {scoreDist.some((n) => n > 0) && (
            <RatingHistogram
              dist={scoreDist}
              userBucket={
                userScore != null
                  ? Math.min(Math.max(Math.round(userScore * 2) - 1, 0), 9)
                  : null
              }
            />
          )}
        </section>

        {/* Tracklist */}
        {tracks.length > 0 && (() => {
          const multiDisc = tracks.some((tr) => tr.discNumber !== tracks[0].discNumber);
          return (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.album.tracklist')}
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {tracks.map((track, i) => {
                const trackScore = trackRatings[track.recordingId];
                // Multi-disc releases restart numbering per disc — label each one so
                // the repeated track numbers read as "Disc 2, track 1", not a duplicate.
                const showDiscHeader =
                  multiDisc && (i === 0 || tracks[i - 1].discNumber !== track.discNumber);
                return (
                  <Fragment key={track.recordingId}>
                  {showDiscHeader && (
                    <div className="px-4 py-1.5 bg-page/40 text-[11px] font-semibold tracking-[0.06em] uppercase text-muted">
                      {t('sj.album.discN').replace('{n}', String(track.discNumber))}
                    </div>
                  )}
                  <div
                    onContextMenu={(e) => onTrackContextMenu(e, track)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-page/60 transition group"
                  >
                    <span className="w-6 text-right text-[13px] text-muted tabular-nums">
                      {track.position}
                    </span>
                    <Link
                      href={`/song/${track.recordingId}?rg=${releaseGroupId}`}
                      className="flex-1 min-w-0 text-[14px] text-ink truncate hover:underline"
                    >
                      {track.title}
                    </Link>
                    {track.durationMs != null && track.durationMs > 0 && (
                      <span className="text-[12px] text-muted tabular-nums">
                        {Math.floor(track.durationMs / 60000)}:
                        {String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, '0')}
                      </span>
                    )}
                    {trackScore != null ? (
                      <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[11px] font-bold tabular-nums">
                        {formatScore(trackScore)}
                      </span>
                    ) : userId ? (
                      <button
                        onClick={() => setTrackManualTarget(track)}
                        aria-label={`${t('sj.album.rateTrack')} ${track.title}`}
                        className="flex w-[26px] h-[26px] rounded-full bg-accent/10 items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                      >
                        <Plus size={12} strokeWidth={2.6} className="text-accent" />
                      </button>
                    ) : null}
                  </div>
                  </Fragment>
                );
              })}
            </div>
            {trackContextMenu}
          </section>
          );
        })()}

        {/* Ratings & reviews */}
        {posts.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.album.ratingsReviews')}
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {posts.map((post) => {
                const score = displayScore(post.score);
                const handle =
                  post.profiles?.username ?? post.profiles?.display_name ?? 'someone';
                return (
                  <div key={post.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/profile/${post.profiles?.username ?? ''}`}
                        className="flex items-center gap-3 min-w-0 flex-1 group"
                      >
                        <Avatar url={null} size={32} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink truncate group-hover:underline">
                            @{handle}
                          </span>
                          <span className="block text-[11px] text-muted">
                            {relativeTime(post.created_at, lang)}
                          </span>
                        </span>
                      </Link>
                      {score != null && <ScoreBadge score={score} size={34} ringStroke={2.5} />}
                    </div>
                    {post.review_text && (
                      <p className="mt-2 ml-11 text-[13px] leading-relaxed text-ink/90 whitespace-pre-wrap break-words">
                        {post.review_text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Public mixes */}
        {publicMixes.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.album.inPublicMixes')}
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {publicMixes.map((mix) => (
                <Link
                  key={mix.id}
                  href={`/mix/${mix.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-page/60 transition"
                >
                  <ListMusic size={16} className="text-accent shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink truncate">
                      {mix.name}
                    </span>
                    <span className="block text-[12px] text-muted">{mix.authorHandle}</span>
                  </span>
                  <ChevronRight size={14} className="text-muted" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Modals ── */}
      <MixPickerModal
        open={showMixPicker}
        onClose={() => setShowMixPicker(false)}
        releaseGroupId={releaseGroupId}
      />
      {trackManualTarget && (
        <ManualRateModal
          open
          onClose={() => setTrackManualTarget(null)}
          release={release}
          track={{
            recordingId: trackManualTarget.recordingId,
            title: trackManualTarget.title,
          }}
          existingScore={trackRatings[trackManualTarget.recordingId] ?? null}
          ratingStep={ratingStep}
          onSave={(score) => rateTrack(trackManualTarget.recordingId, score)}
        />
      )}
    </div>
  );
}
