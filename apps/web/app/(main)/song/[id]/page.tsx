'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  BookmarkPlus,
  ChevronRight,
  Disc3,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Music2,
} from 'lucide-react';
import AlbumPeek from '../../../../components/sj/AlbumPeek';
import ArtistLink from '../../../../components/sj/ArtistLink';
import Cover from '../../../../components/sj/Cover';
import FlowerGlyph from '../../../../components/sj/FlowerGlyph';
import FlowerRateControl from '../../../../components/sj/FlowerRateControl';
import InlineRatingEditor from '../../../../components/sj/InlineRatingEditor';
import ManualRateModal from '../../../../components/sj/ManualRateModal';
import RatingHistogram from '../../../../components/sj/RatingHistogram';
import SaveToMixButton from '../../../../components/sj/SaveToMixButton';
import Tracklist from '../../../../components/sj/Tracklist';
import CommentsSection from '../../../../components/sj/CommentsSection';
import { OverflowMenuSurface } from '../../../../components/sj/AlbumOverflowMenu';
import { openInNewTab } from '../../../../components/sj/ContextMenu';
import { Skeleton, SkeletonBlock, SkeletonLine, SkeletonRows } from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { useMixTarget } from '../../../../components/sj/MixTargetContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName, typeLabelKey, yearOf } from '../../../../lib/sj/display';
import { releaseFromEmbed, type SJRelease, RG_COLS } from '../../../../lib/sj/data';
import {
  formatDuration,
  loadAlbumTracks,
  loadMyTrackScores,
  loadTrackStats,
  type TrackEntry,
  type TrackStats,
} from '../../../../lib/sj/tracks';
import { saveTrackRating } from '../../../../lib/sj/trackRatings';

/**
 * Song (recording) page — P7 redesign, the album page's sibling: a sticky
 * cover/meta column with the rate + save actions, then your rating (with an
 * inline comment, which is what makes a song "post"), community stats, ranked
 * comments, the rest of the album, other releases, and more by the artist.
 *
 * `?rg=` pins which release the recording is shown in (a recording can sit on
 * several); without it the canonical edition wins.
 */
export default function SongPage() {
  return (
    <Suspense>
      <SongPageInner />
    </Suspense>
  );
}

interface SongInfo {
  title: string;
  credit: string | null;
  primaryArtistId: string | null;
  primaryArtistName: string | null;
  durationMs: number | null;
  position: number | null;
}

interface OtherRelease {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseType: string | null;
  year: string | null;
}

interface ArtistSong {
  recordingId: string;
  title: string;
  releaseGroupId: string;
  coverUrl: string | null;
  albumTitle: string;
  stats: TrackStats | null;
}

function SongPageInner() {
  const params = useParams<{ id: string }>();
  const recordingId = params.id;
  const searchParams = useSearchParams();
  const rgHint = searchParams.get('rg');
  const router = useRouter();
  const { t } = useLanguage();
  const { userId, profile, requireAuth } = useSession();
  const { openChange } = useMixTarget();
  const ratingStep = profile?.manual_rating_step ?? 0.5;

  const [song, setSong] = useState<SongInfo | null>(null);
  const [release, setRelease] = useState<SJRelease | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [others, setOthers] = useState<OtherRelease[]>([]);
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [albumScores, setAlbumScores] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [review, setReview] = useState('');
  const savedReview = useRef<string | null>(null);
  const reviewBoxRef = useRef<HTMLTextAreaElement>(null);
  const reviewTimer = useRef<ReturnType<typeof setTimeout>>();
  const [moreByArtist, setMoreByArtist] = useState<ArtistSong[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const refreshStats = useCallback(async () => {
    const st = await loadTrackStats([recordingId]);
    if (st) setStats(st[recordingId] ?? null);
    setStatsLoaded(true);
  }, [recordingId]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setFailed(false);
      setMoreByArtist(null);

      const { data: rec, error: recErr } = await supabase!
        .from('recordings')
        .select('id, title, artist_display, duration_ms, primary_artist_id, artists(name)')
        .eq('id', recordingId)
        .maybeSingle();
      if (cancelled) return;
      if (recErr) {
        console.error('[song] recording failed:', recErr.message);
        setFailed(true);
        setLoading(false);
        return;
      }
      if (!rec) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const r = rec as any;

      // Every release this recording sits on → the one to show (hint, then
      // canonical) + the rest as "also on".
      const { data: rtRows } = await supabase!
        .from('release_tracks')
        .select(`position, releases(is_canonical, release_groups(${RG_COLS}, genres))`)
        .eq('recording_id', recordingId)
        .limit(40);
      if (cancelled) return;
      const rows = ((rtRows as any[] | null) ?? []).filter((x) => x.releases?.release_groups);
      const preferred =
        rows.find((x) => rgHint && x.releases.release_groups.id === rgHint) ??
        rows.find((x) => x.releases.is_canonical) ??
        rows[0];
      const rg = preferred ? releaseFromEmbed(preferred.releases.release_groups) : null;

      const seen = new Set<string>(rg ? [rg.id] : []);
      const otherList: OtherRelease[] = [];
      for (const x of rows) {
        const g = x.releases.release_groups;
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        otherList.push({
          id: g.id,
          title: displayName(g.title, g.native_title),
          coverUrl: g.cover_url,
          releaseType: g.release_group_type,
          year: yearOf(g.first_release_date),
        });
      }

      const primaryName: string | null = r.artists?.name ?? null;
      const credit: string | null = r.artist_display ?? primaryName;
      setSong({
        title: r.title,
        credit,
        primaryArtistId: r.primary_artist_id ?? null,
        primaryArtistName: primaryName,
        durationMs: r.duration_ms,
        position: preferred?.position ?? null,
      });
      setRelease(rg);
      setGenres(((preferred?.releases.release_groups.genres as string[] | null) ?? []).slice(0, 4));
      setOthers(otherList);

      // Your rating + comment, community stats, and the album's tracks — in parallel.
      const mineP = (async () => {
        if (!userId) return;
        const { data } = await supabase!
          .from('track_ratings')
          .select('score, review_text')
          .eq('user_id', userId)
          .eq('recording_id', recordingId)
          .maybeSingle();
        if (cancelled) return;
        const m = data as { score: number | null; review_text: string | null } | null;
        setUserScore(m?.score ?? null);
        savedReview.current = m?.review_text ?? null;
        setReview(m?.review_text ?? '');
      })();
      const albumP = (async () => {
        if (!rg) return;
        const list = (await loadAlbumTracks(rg.id)) ?? [];
        if (cancelled) return;
        setTracks(list);
        if (userId && list.length) {
          const mine = await loadMyTrackScores(userId, list.map((tr) => tr.recordingId));
          if (!cancelled) setAlbumScores(mine);
        }
      })();
      await Promise.all([mineP, albumP, refreshStats()]);
      if (!cancelled) setLoading(false);

      // "More by this artist" is below the fold — load it after the page shows.
      if (r.primary_artist_id)
        void loadMoreByArtist(r.primary_artist_id, rg?.id ?? null, r.title, () => cancelled);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, rgHint, userId, reloadKey]);

  async function loadMoreByArtist(
    artistId: string,
    currentRg: string | null,
    currentTitle: string,
    isCancelled: () => boolean,
  ) {
    if (!supabase) return;
    const { data: recs } = await supabase
      .from('recordings')
      .select('id, title')
      .eq('primary_artist_id', artistId)
      .neq('id', recordingId)
      .limit(60);
    const list = (recs as { id: string; title: string }[] | null) ?? [];
    if (isCancelled() || list.length === 0) {
      if (!isCancelled()) setMoreByArtist([]);
      return;
    }
    const st = (await loadTrackStats(list.map((x) => x.id))) ?? {};
    // Rated songs first (most-rated, then best), a title only once; then fill.
    const byTitle = new Set<string>([currentTitle.toLowerCase()]);
    const ranked = list
      .map((x) => ({ ...x, st: st[x.id] ?? null }))
      .sort((a, b) => (b.st?.count ?? 0) - (a.st?.count ?? 0) || (b.st?.avg ?? 0) - (a.st?.avg ?? 0))
      .filter((x) => {
        const k = x.title.toLowerCase();
        if (byTitle.has(k)) return false;
        byTitle.add(k);
        return true;
      })
      .slice(0, 12);
    const { data: rt } = await supabase
      .from('release_tracks')
      .select('recording_id, releases(is_canonical, release_groups(id, title, native_title, cover_url))')
      .in('recording_id', ranked.map((x) => x.id));
    if (isCancelled()) return;
    const rgBy: Record<string, any> = {};
    for (const row of (rt as any[] | null) ?? []) {
      const g = row.releases?.release_groups;
      if (!g) continue;
      if (row.releases.is_canonical || !rgBy[row.recording_id]) rgBy[row.recording_id] = g;
    }
    setMoreByArtist(
      ranked
        .filter((x) => rgBy[x.id] && rgBy[x.id].id !== currentRg)
        .slice(0, 6)
        .map((x) => ({
          recordingId: x.id,
          title: x.title,
          releaseGroupId: rgBy[x.id].id,
          coverUrl: rgBy[x.id].cover_url,
          albumTitle: displayName(rgBy[x.id].title, rgBy[x.id].native_title),
          stats: x.st,
        })),
    );
  }

  async function rate(score: number | null) {
    if (!requireAuth() || !userId) return;
    const prev = userScore;
    setUserScore(score);
    setAlbumScores((cur) => {
      const next = { ...cur };
      if (score == null) delete next[recordingId];
      else next[recordingId] = score;
      return next;
    });
    const { error } = await saveTrackRating(userId, recordingId, score);
    if (error) {
      setUserScore(prev);
      return;
    }
    if (score == null) {
      savedReview.current = null;
      setReview('');
    }
    void refreshStats();
  }

  // The album tracklist on this page rates other tracks of the same album.
  async function rateAlbumTrack(id: string, score: number | null) {
    if (id === recordingId) return rate(score);
    if (!userId) return;
    setAlbumScores((cur) => {
      const next = { ...cur };
      if (score == null) delete next[id];
      else next[id] = score;
      return next;
    });
    await saveTrackRating(userId, id, score);
  }

  const saveReview = useCallback(
    async (text: string) => {
      if (!supabase || !userId) return;
      const next = text.trim() || null;
      if (next === savedReview.current) return;
      savedReview.current = next;
      const { error } = await supabase
        .from('track_ratings')
        .update({ review_text: next })
        .eq('user_id', userId)
        .eq('recording_id', recordingId);
      if (error) console.error('[song] review save failed:', error.message);
    },
    [userId, recordingId],
  );

  if (notFound) {
    return (
      <div className="py-32 flex flex-col items-center gap-3 text-center px-6">
        <Music2 size={36} className="text-divider" />
        <p className="text-[15px] text-muted">{t('sj.song.notFound')}</p>
        <Link href="/search" className="text-[13px] font-semibold text-accent hover:underline">
          {t('sj.song.searchInstead')}
        </Link>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="py-32 flex flex-col items-center gap-3">
        <p className="text-[14.5px] text-muted">{t('sj.common.loadError')}</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="px-4 py-2 rounded-full bg-surface border border-divider/60 text-[13px] font-semibold text-ink hover:opacity-80 transition"
        >
          {t('sj.common.retry')}
        </button>
      </div>
    );
  }

  // Same shape as the loaded page, so nothing jumps — and no raw ids meanwhile.
  if (loading || !song) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 flex flex-col md:flex-row gap-8 md:gap-10">
        <div className="md:w-64 shrink-0 flex md:flex-col gap-4">
          <Skeleton className="w-28 h-28 md:w-64 md:h-64 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2.5">
            <SkeletonLine w="w-3/4" h="h-6" />
            <SkeletonLine w="w-1/2" h="h-4" />
            <SkeletonLine w="w-2/3" h="h-3" />
          </div>
        </div>
        <div className="flex-1 space-y-4">
          <SkeletonBlock className="h-36" />
          <SkeletonRows count={5} />
        </div>
      </div>
    );
  }

  const item = release
    ? { kind: 'song' as const, recordingId, releaseGroupId: release.id }
    : null;
  const meta = { coverUrl: release?.coverUrl ?? null, title: song.title };
  const songUrl = `/song/${recordingId}${release ? `?rg=${release.id}` : ''}`;

  // "IU feat. SUGA" → link "IU" to the artist, keep " feat. SUGA" as text.
  const primary = song.primaryArtistName;
  const rest =
    primary && song.credit && song.credit.toLowerCase().startsWith(primary.toLowerCase())
      ? song.credit.slice(primary.length)
      : null;

  const menuItems = [
    ...(item
      ? [
          {
            key: 'save-other',
            label: t('sj.mix.saveToAnother'),
            icon: <BookmarkPlus size={15} />,
            onSelect: () => moreBtnRef.current && openChange(item, moreBtnRef.current, meta),
          },
        ]
      : []),
    ...(release
      ? [
          {
            key: 'open-album',
            label: t('sj.context.openAlbum'),
            icon: <Disc3 size={15} />,
            onSelect: () => router.push(`/album/${release.id}`),
          },
        ]
      : []),
    {
      key: 'copy-link',
      label: t('sj.context.copyLink'),
      icon: <Link2 size={15} />,
      onSelect: () => {
        void navigator.clipboard
          ?.writeText(`${window.location.origin}${songUrl}`)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => {});
      },
    },
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(songUrl),
    },
  ];

  const bucket = userScore != null ? Math.min(Math.max(Math.round(userScore * 2) - 1, 0), 9) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 flex flex-col md:flex-row gap-8 md:gap-10">
      {/* ── Left: cover + meta + actions (sticky on desktop) ── */}
      <div className="md:w-64 shrink-0">
        <div className="md:sticky md:top-[76px] flex md:flex-col gap-4">
          <div className="relative shrink-0 w-28 h-28 md:w-64 md:h-64">
            {release ? (
              <AlbumPeek
                releaseId={release.id}
                title={displayName(release.title, release.titleNative)}
                artist={displayName(release.artist, release.artistNative)}
                release={release}
                className="block w-full h-full"
              >
                <Link href={`/album/${release.id}`} aria-label={displayName(release.title, release.titleNative)}>
                  <Cover url={release.coverUrl} thumb={false} className="w-full h-full" rounded="rounded-2xl" />
                </Link>
              </AlbumPeek>
            ) : (
              <Cover url={null} className="w-full h-full" rounded="rounded-2xl" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted">
              {t('sj.type.song')}
            </p>
            <h1 className="text-[20px] md:text-[22px] font-bold text-ink leading-snug break-words">
              {song.title}
            </h1>
            <p className="mt-1 text-[14px] leading-relaxed">
              {song.primaryArtistId && primary ? (
                <>
                  <ArtistLink
                    href={`/artist/${song.primaryArtistId}`}
                    className="text-accent hover:underline"
                  >
                    {rest != null ? song.credit!.slice(0, primary.length) : primary}
                  </ArtistLink>
                  {rest && <span className="text-muted">{rest}</span>}
                  {rest == null && song.credit && song.credit !== primary && (
                    <span className="block text-[12.5px] text-muted">{song.credit}</span>
                  )}
                </>
              ) : (
                <span className="text-muted">{song.credit}</span>
              )}
            </p>
            {release && (
              <Link
                href={`/album/${release.id}`}
                className="mt-1.5 flex items-center gap-1 text-[12.5px] text-muted hover:text-ink transition group"
              >
                <span className="truncate">
                  {t('sj.song.fromAlbum')
                    .replace('{album}', displayName(release.title, release.titleNative))}
                  {song.position != null && ` · ${t('sj.song.trackN').replace('{n}', String(song.position))}`}
                  {yearOf(release.releaseDate) && ` · ${yearOf(release.releaseDate)}`}
                </span>
                <ChevronRight size={13} className="shrink-0 opacity-60 group-hover:opacity-100" />
              </Link>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {formatDuration(song.durationMs) && (
                <span className="px-2.5 py-1 rounded-full bg-muted/10 text-muted text-[11px] font-semibold tabular-nums">
                  {formatDuration(song.durationMs)}
                </span>
              )}
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

            {/* Actions: rate · save · more */}
            <div className="flex items-center gap-2 mt-4">
              <FlowerRateControl
                ariaLabel={t('sj.song.rateThisTrack')}
                currentScore={userScore}
                onRate={(s) => void rate(s)}
                onRequestPrecise={() => requireAuth() && setShowManual(true)}
                size={44}
                ratingStep={ratingStep}
              />
              {item && (
                <SaveToMixButton
                  item={item}
                  meta={meta}
                  variant="inline"
                  size={40}
                  className="border border-divider bg-surface"
                />
              )}
              <button
                ref={moreBtnRef}
                type="button"
                onClick={() => {
                  const r = moreBtnRef.current?.getBoundingClientRect();
                  if (r) setMenuAt(menuAt ? null : { x: r.right, y: r.bottom + 6 });
                }}
                aria-label={t('sj.common.moreOptions')}
                aria-haspopup="menu"
                className="grid place-items-center w-10 h-10 rounded-lg border border-divider bg-surface text-muted hover:text-ink transition"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
            {copied && (
              <p role="status" className="mt-2 text-[12px] text-accent sj-fade-in">
                {t('sj.context.linkCopied')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Right ── */}
      <div className="flex-1 min-w-0">
        {/* Your rating (+ comment — the song's "post") */}
        <section className="rounded-2xl bg-surface border border-divider/60 p-5">
          <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-4">
            {t('sj.album.yourRating')}
          </h2>
          {!userId ? (
            <Link
              href="/login"
              className="block w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold text-center hover:opacity-90 transition"
            >
              {t('sj.album.signInToRate')}
            </Link>
          ) : (
            <InlineRatingEditor score={userScore} step={ratingStep} onSave={rate} />
          )}
          {userId && userScore != null && (
            <textarea
              ref={reviewBoxRef}
              value={review}
              onChange={(e) => {
                const text = e.target.value;
                setReview(text);
                clearTimeout(reviewTimer.current);
                reviewTimer.current = setTimeout(() => saveReview(text), 1000);
              }}
              onBlur={() => {
                clearTimeout(reviewTimer.current);
                void saveReview(review);
              }}
              placeholder={t('sj.song.addComment')}
              rows={2}
              className="w-full mt-4 px-3.5 py-2.5 rounded-xl bg-page border border-divider text-[13.5px] leading-relaxed text-ink placeholder-placeholder outline-none focus:border-accent/60 transition resize-none"
            />
          )}

          {/* Community */}
          <div className="flex gap-2.5 mt-4">
            <div className="flex flex-1 items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
              <FlowerGlyph size={12} className="text-accent shrink-0" />
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-ink leading-tight">
                  {!statsLoaded ? '…' : stats?.avg != null ? stats.avg.toFixed(1) : '—'}
                </p>
                <p className="text-[10px] text-muted truncate">{t('sj.album.communityAvg')}</p>
              </div>
            </div>
            <div className="flex-1 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
              <p className="text-[15px] font-bold text-ink leading-tight">
                {!statsLoaded ? '…' : stats?.count ?? 0}
              </p>
              <p className="text-[10px] text-muted truncate">{t('sj.album.ratings')}</p>
            </div>
          </div>
          {stats && stats.dist.some((n) => n > 0) && <RatingHistogram dist={stats.dist} userBucket={bucket} />}
        </section>

        {/* Comments (track ratings with text), ranked like the album page */}
        <CommentsSection
          kind="song"
          parentId={recordingId}
          mine={
            userId && userScore != null && review.trim() !== ''
              ? {
                  score: userScore,
                  text: review,
                  onEdit: () => {
                    reviewBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    reviewBoxRef.current?.focus();
                  },
                }
              : null
          }
        />

        {/* The rest of the album, this track highlighted */}
        {release && tracks.length > 1 && (
          <section className="mt-6">
            <h2 className="flex items-center justify-between text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              <span>{t('sj.song.onThisAlbum')}</span>
              <Link href={`/album/${release.id}`} className="normal-case tracking-normal text-[12px] font-semibold text-accent hover:underline">
                {t('sj.song.openAlbum')}
              </Link>
            </h2>
            <Tracklist
              compact
              tracks={tracks}
              release={release}
              myScores={albumScores}
              stats={{}}
              onRate={rateAlbumTrack}
              currentRecordingId={recordingId}
            />
          </section>
        )}

        {/* Other releases carrying this recording */}
        {others.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.song.alsoOn')}
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {others.map((o) => (
                <Link
                  key={o.id}
                  href={`/song/${recordingId}?rg=${o.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-page/60 transition"
                >
                  <Cover url={o.coverUrl} className="w-10 h-10" rounded="rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-ink truncate">{o.title}</span>
                    <span className="block text-[12px] text-muted">
                      {t(typeLabelKey(o.releaseType))}
                      {o.year && ` · ${o.year}`}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-muted" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* More by this artist */}
        {song.primaryArtistId && (moreByArtist === null || moreByArtist.length > 0) && (
          <section className="mt-6 pb-4">
            <h2 className="flex items-center justify-between text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              <span>{t('sj.song.moreBy').replace('{artist}', primary ?? '')}</span>
              <Link
                href={`/artist/${song.primaryArtistId}`}
                className="normal-case tracking-normal text-[12px] font-semibold text-accent hover:underline"
              >
                {t('sj.song.seeArtist')}
              </Link>
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {moreByArtist === null
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5" aria-hidden>
                      <span className="w-10 h-10 rounded-md bg-divider/50 animate-pulse" />
                      <span className="h-3 w-40 rounded bg-divider/50 animate-pulse" />
                    </div>
                  ))
                : moreByArtist.map((s) => (
                    <Link
                      key={s.recordingId}
                      href={`/song/${s.recordingId}?rg=${s.releaseGroupId}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-page/60 transition"
                    >
                      <Cover url={s.coverUrl} className="w-10 h-10" rounded="rounded-md" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold text-ink truncate">{s.title}</span>
                        <span className="block text-[12px] text-muted truncate">{s.albumTitle}</span>
                      </span>
                      {s.stats?.avg != null && (
                        <span className="text-[12px] text-muted tabular-nums shrink-0">
                          {s.stats.avg.toFixed(1)} · {s.stats.count}
                        </span>
                      )}
                    </Link>
                  ))}
            </div>
          </section>
        )}
      </div>

      {menuAt && (
        <OverflowMenuSurface x={menuAt.x} y={menuAt.y} items={menuItems} onClose={() => setMenuAt(null)} />
      )}

      {release && showManual && (
        <ManualRateModal
          open
          onClose={() => setShowManual(false)}
          release={release}
          track={{ recordingId, title: song.title }}
          existingScore={userScore}
          ratingStep={ratingStep}
          onSave={rate}
        />
      )}
    </div>
  );
}
