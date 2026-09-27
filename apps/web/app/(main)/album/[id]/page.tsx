'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Check,
  ChevronRight,
  ExternalLink,
  ListMusic,
} from 'lucide-react';
import AlbumRateButton from '../../../../components/sj/AlbumRateButton';
import ArtistLink from '../../../../components/sj/ArtistLink';
import Cover from '../../../../components/sj/Cover';
import FlowerGlyph from '../../../../components/sj/FlowerGlyph';
import InlineRatingEditor from '../../../../components/sj/InlineRatingEditor';
import Tracklist from '../../../../components/sj/Tracklist';
import CommentsSection from '../../../../components/sj/CommentsSection';
import SaveToMixButton from '../../../../components/sj/SaveToMixButton';
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
import { albumCommunityScores } from '../../../../lib/sj/communityScores';
import { useLanguage } from '../../../../lib/i18n';
import {
  displayName,
  typeLabelKey,
  yearOf,
} from '../../../../lib/sj/display';
import type { SJRelease } from '../../../../lib/sj/data';
import {
  loadAlbumTracks,
  loadMyTrackScores,
  loadTrackStats,
  type TrackEntry,
  type TrackStats,
} from '../../../../lib/sj/tracks';
import { saveTrackRating } from '../../../../lib/sj/trackRatings';
import type { ReleaseGroupCreditRPC } from '../../../../lib/db/types';

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
  const [trackScoresLoading, setTrackScoresLoading] = useState(true);
  const [trackStats, setTrackStats] = useState<Record<string, TrackStats> | null>(null);
  const [communityAvg, setCommunityAvg] = useState<number | null>(null);
  const [communitySD, setCommunitySD] = useState<number | null>(null);
  const [communityCount, setCommunityCount] = useState(0);
  const [scoreDist, setScoreDist] = useState<number[]>([]);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [publicMixes, setPublicMixes] = useState<PublicMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Inline comment (review_text on the user's rating row). Two states: editing
  // (textarea + Save) and saved (a read-only card with a check; click to edit).
  const [reviewDraft, setReviewDraft] = useState('');
  const [savedReview, setSavedReview] = useState<string | null>(null);
  const [reviewEditing, setReviewEditing] = useState(true);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewJustSaved, setReviewJustSaved] = useState(false);
  const myReviewRef = useRef<string | null>(null);
  const reviewBoxRef = useRef<HTMLTextAreaElement>(null);

  const ratingStep = profile?.manual_rating_step ?? 0.5;

  const loadRatings = useCallback(async () => {
    if (!supabase) return;
    // Community numbers from the anonymous-scores RPC (private accounts still
    // count); my own row is read directly.
    const [rows, mineRes] = await Promise.all([
      albumCommunityScores([releaseGroupId]),
      userId
        ? supabase
            .from('ratings')
            .select('score, review_text')
            .eq('user_id', userId)
            .eq('release_group_id', releaseGroupId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
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
      const mine = mineRes.data as { score: number | null; review_text: string | null } | null;
      setUserScore(mine?.score ?? null);
      // Keep the app-wide store in sync so every other surface for this album
      // (feed, charts, artist…) reflects edits made here, and vice-versa.
      applyLocal(releaseGroupId, mine?.score ?? null);
      myReviewRef.current = mine?.review_text ?? null;
      setSavedReview(mine?.review_text ?? null);
      // Don't clobber in-progress typing
      if (document.activeElement !== reviewBoxRef.current) {
        setReviewDraft(mine?.review_text ?? '');
        setReviewEditing(!mine?.review_text);
      }
    }
  }, [releaseGroupId, userId, applyLocal]);

  /** Writes review_text; resolves false if the write failed. */
  const saveReview = useCallback(
    async (text: string) => {
      if (!supabase || !userId) return false;
      const next = text.trim() || null;
      if (next === myReviewRef.current) return true;
      const prev = myReviewRef.current;
      myReviewRef.current = next;
      const { error } = await supabase
        .from('ratings')
        .update({ review_text: next })
        .eq('user_id', userId)
        .eq('release_group_id', releaseGroupId);
      if (error) {
        console.error('[album] comment save failed:', error.message);
        myReviewRef.current = prev;
        return false;
      }
      setSavedReview(next);
      return true;
    },
    [userId, releaseGroupId],
  );

  /** Save: the box settles into its saved state (unless the comment is now empty). */
  async function commitReview() {
    if (reviewSaving) return;
    setReviewSaving(true);
    const ok = await saveReview(reviewDraft);
    setReviewSaving(false);
    if (!ok) return;
    if (reviewDraft.trim() === '') {
      setReviewDraft('');
      return;
    }
    setReviewDraft(reviewDraft.trim());
    setReviewEditing(false);
    setReviewJustSaved(true);
  }

  // The comment box grows with its lines (CSS max-h caps it, then it scrolls).
  // Layout effect so the resize lands before paint — no one-frame jump.
  useLayoutEffect(() => {
    const el = reviewBoxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [reviewDraft, reviewEditing, savedReview, userScore]);

  /** Back to the textarea, caret at the end. */
  function editReview() {
    setReviewEditing(true);
    setReviewJustSaved(false);
    requestAnimationFrame(() => {
      const el = reviewBoxRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
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

      // Parallel: credits, ratings, mixes, tracklist
      const creditsP = supabase!
        .rpc('get_release_group_credits', { p_release_group_id: releaseGroupId })
        .then(({ data }) => {
          if (!cancelled) setCredits((data as ReleaseGroupCreditRPC[] | null) ?? []);
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
        const loaded = await loadAlbumTracks(releaseGroupId);
        if (cancelled) return;
        const list = loaded ?? [];
        setTracks(list);
        const ids = list.map((tr) => tr.recordingId);
        // Your scores and the community's load side by side; each column keeps
        // a skeleton until its own data lands, so the rows never shift.
        await Promise.all([
          (async () => {
            const mine = userId ? await loadMyTrackScores(userId, ids) : {};
            if (cancelled) return;
            setTrackRatings(mine);
            setTrackScoresLoading(false);
          })(),
          (async () => {
            const st = await loadTrackStats(ids);
            if (!cancelled) setTrackStats(st ?? {});
          })(),
        ]);
      })();

      await Promise.all([creditsP, mixesP, tracksP, loadRatings()]);
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
    if (!userId) return;
    const prev = trackRatings[recordingId];
    const put = (v: number | null | undefined) =>
      setTrackRatings((cur) => {
        const next = { ...cur };
        if (v == null) delete next[recordingId];
        else next[recordingId] = v;
        return next;
      });
    put(score);
    const { error } = await saveTrackRating(userId, recordingId, score);
    if (error) {
      put(prev);
      return;
    }
    // Refresh just this track's community average.
    const st = await loadTrackStats([recordingId]);
    if (st)
      setTrackStats((cur) => {
        const next = { ...(cur ?? {}) };
        if (st[recordingId]) next[recordingId] = st[recordingId];
        else delete next[recordingId];
        return next;
      });
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
            <SaveToMixButton
              item={{ kind: 'album', releaseGroupId }}
              meta={{ coverUrl: release.coverUrl, title: release.title }}
              variant="inline"
              size={30}
              className="-my-1.5"
            />
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
          {userId &&
            userScore != null &&
            (reviewEditing || !savedReview ? (
              <div className="relative mt-4">
                <textarea
                  ref={reviewBoxRef}
                  value={reviewDraft}
                  onChange={(e) => setReviewDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void commitReview();
                    } else if (e.key === 'Escape' && savedReview) {
                      // Drop the unsaved changes and settle back on the saved comment.
                      setReviewDraft(savedReview);
                      setReviewEditing(false);
                    }
                  }}
                  // Leaving the box still keeps what was typed (it just stays editable).
                  onBlur={() => void saveReview(reviewDraft)}
                  placeholder={t('sj.rate.addComment')}
                  rows={2}
                  // Grows with its content (see the reviewDraft layout effect); scrolls past max-h.
                  className="block w-full max-h-80 pl-3.5 pr-20 py-2.5 rounded-xl bg-page border border-divider text-[13.5px] leading-relaxed text-ink placeholder-placeholder outline-none focus:border-accent/60 transition-[border-color] resize-none overflow-y-auto"
                />
                {(reviewDraft.trim() !== '' || savedReview) && (
                  <button
                    type="button"
                    // Keep the textarea focused so its blur-save doesn't race this one.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitReview()}
                    disabled={reviewSaving}
                    className="absolute right-2 bottom-2 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-accent text-white text-[12px] font-semibold hover:opacity-90 disabled:opacity-60 transition sj-pop-in"
                  >
                    <Check size={13} strokeWidth={3} />
                    {t('sj.rate.saveComment')}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={editReview}
                aria-label={t('sj.rate.editComment')}
                title={t('sj.rate.editComment')}
                className="group relative block w-full mt-4 pl-3.5 pr-9 py-2.5 rounded-xl bg-accent/[0.05] border border-accent/25 text-left hover:border-accent/50 transition sj-pop-in"
              >
                <span className="block text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                  {savedReview}
                </span>
                <span
                  className={`absolute right-1.5 top-1.5 grid place-items-center w-5 h-5 rounded-full bg-accent text-white ${
                    reviewJustSaved ? 'sj-heart-pop' : ''
                  }`}
                  aria-hidden
                >
                  <Check size={11} strokeWidth={3} />
                </span>
              </button>
            ))}

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
        {tracks.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.album.tracklist')}
            </h2>
            <Tracklist
              tracks={tracks}
              release={release}
              myScores={trackRatings}
              stats={trackStats}
              scoresLoading={!!userId && trackScoresLoading}
              onRate={rateTrack}
            />
          </section>
        )}

        {/* Ratings — ranked server-side (get_album_ratings), commented ones
            first; yours pinned first */}
        <CommentsSection
          kind="album"
          parentId={releaseGroupId}
          mine={
            userId && userScore != null
              ? {
                  score: userScore,
                  text: savedReview ?? '',
                  onEdit: () => {
                    editReview();
                    requestAnimationFrame(() =>
                      reviewBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                    );
                  },
                }
              : null
          }
        />

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

    </div>
  );
}
