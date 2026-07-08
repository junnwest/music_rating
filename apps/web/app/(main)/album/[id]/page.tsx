'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Plus,
  ArrowUpDown,
  Trash2,
  ChevronRight,
  ListMusic,
  Star,
} from 'lucide-react';
import Cover from '../../../../components/sj/Cover';
import FlowerGlyph from '../../../../components/sj/FlowerGlyph';
import ManualRateModal from '../../../../components/sj/ManualRateModal';
import InstinctModal from '../../../../components/sj/InstinctModal';
import ScoreBadge from '../../../../components/sj/ScoreBadge';
import RatingHistogram from '../../../../components/sj/RatingHistogram';
import { useSession } from '../../../../components/sj/SessionContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { eloToScore } from '../../../../lib/elo';
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
  position: number;
  title: string;
  durationMs: number | null;
  artists: string | null;
}

interface PostRow {
  id: string;
  user_id: string;
  score: number | null;
  elo_score: number | null;
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

  const [release, setRelease] = useState<SJRelease | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [credits, setCredits] = useState<ReleaseGroupCreditRPC[]>([]);
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [trackRatings, setTrackRatings] = useState<Record<string, number>>({});
  const [eloRatedTracks, setEloRatedTracks] = useState<Set<string>>(new Set());
  const [communityAvg, setCommunityAvg] = useState<number | null>(null);
  const [communityCount, setCommunityCount] = useState(0);
  const [scoreDist, setScoreDist] = useState<number[]>([]);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [userElo, setUserElo] = useState<number | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [publicMixes, setPublicMixes] = useState<PublicMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [showManual, setShowManual] = useState(false);
  const [showInstinct, setShowInstinct] = useState(false);
  const [trackManualTarget, setTrackManualTarget] = useState<TrackEntry | null>(null);
  const [trackInstinctTarget, setTrackInstinctTarget] = useState<TrackEntry | null>(null);
  const [confirmDeleteRanking, setConfirmDeleteRanking] = useState(false);

  const ratingMode = profile?.rating_mode ?? 'manual';
  const ratingStep = profile?.manual_rating_step ?? 0.5;

  const loadRatings = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('ratings')
      .select('score, elo_score, user_id')
      .eq('release_group_id', releaseGroupId);
    const rows = (data as { score: number | null; elo_score: number | null; user_id: string }[] | null) ?? [];
    setCommunityCount(rows.length);
    const scored = rows
      .map((r) => (r.score != null ? r.score : r.elo_score != null ? eloToScore(r.elo_score) : null))
      .filter((s): s is number => s != null);
    setCommunityAvg(scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null);
    // Distribution: ten 0.5-wide buckets (0.5 … 5.0)
    const dist = new Array(10).fill(0) as number[];
    for (const s of scored) {
      dist[Math.min(Math.max(Math.round(s * 2) - 1, 0), 9)] += 1;
    }
    setScoreDist(dist);
    if (userId) {
      const mine = rows.find((r) => r.user_id === userId);
      setUserScore(mine?.score ?? null);
      setUserElo(mine?.elo_score ?? null);
    }
  }, [releaseGroupId, userId]);

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
          'id, user_id, score, elo_score, created_at, profiles(username, display_name, avatar_url)',
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
          .select('id, name, profiles(id, username, display_name)')
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
          .order('position');
        if (cancelled) return;
        const loaded: TrackEntry[] = ((rows as any[] | null) ?? []).map((r) => ({
          recordingId: r.recordings.id,
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
    if (score != null) {
      await supabase
        .from('ratings')
        .upsert(
          { user_id: userId, release_group_id: releaseGroupId, score },
          { onConflict: 'user_id,release_group_id' },
        );
    } else {
      await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', releaseGroupId);
    }
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

  async function deleteInstinctRating() {
    if (!supabase || !userId) return;
    setUserElo(null);
    setConfirmDeleteRanking(false);
    await supabase
      .from('ratings')
      .delete()
      .eq('user_id', userId)
      .eq('release_group_id', releaseGroupId);
    await loadRatings();
  }

  if (notFound) {
    return (
      <div className="py-32 text-center text-muted text-[15px]">{t('sj.album.notFound')}</div>
    );
  }

  if (loading || !release) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-8 flex gap-10 animate-pulse">
        <div className="w-64 h-64 rounded-2xl bg-surface border border-divider/60 hidden md:block" />
        <div className="flex-1 space-y-4">
          <div className="h-8 w-2/3 rounded bg-surface" />
          <div className="h-4 w-1/3 rounded bg-surface" />
          <div className="h-40 rounded-2xl bg-surface" />
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
          <Cover
            url={release.coverUrl}
            thumb={false}
            className="w-28 h-28 md:w-64 md:h-64"
            rounded="rounded-2xl"
          />
          <div className="min-w-0">
            <h1 className="text-[20px] md:text-[22px] font-bold text-ink leading-snug">
              {title}
            </h1>
            <p className="mt-1 text-[14px] leading-relaxed">
              {credits.length === 0 ? (
                <Link
                  href={`/artist/${encodeURIComponent(release.artist)}`}
                  className="text-muted hover:text-ink hover:underline"
                >
                  {displayName(release.artist, release.artistNative)}
                </Link>
              ) : (
                credits.map((c) => (
                  <span key={c.position}>
                    <Link
                      href={`/artist/${c.artist_id}`}
                      className="text-accent hover:underline"
                    >
                      {c.credited_as}
                    </Link>
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
              <p className="mt-2.5 text-[12px] text-muted">{genres.join(' · ')}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: rating + tracklist + community ── */}
      <div className="flex-1 min-w-0">
        {/* Rating section (mode-aware) */}
        <section className="rounded-2xl bg-surface border border-divider/60 p-5">
          <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-4">
            {ratingMode === 'instinct' ? t('sj.album.yourInstinct') : t('sj.album.yourRating')}
          </h2>

          {!userId ? (
            <Link
              href="/login"
              className="block w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold text-center hover:opacity-90 transition"
            >
              {t('sj.album.signInToRate')}
            </Link>
          ) : ratingMode === 'instinct' ? (
            userElo != null ? (
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setShowInstinct(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-accent/10 hover:bg-accent/[0.16] transition"
                >
                  <FlowerGlyph size={14} className="text-accent" />
                  <span className="text-[18px] font-bold text-accent tabular-nums">
                    {eloToScore(userElo).toFixed(1)}
                  </span>
                </button>
                <span className="text-[12px] text-muted">{t('sj.album.instinctScore')}</span>
                <span className="flex-1" />
                <button
                  onClick={() => setShowInstinct(true)}
                  className="text-[13px] font-semibold text-accent hover:opacity-80"
                >
                  {t('sj.album.rerank')}
                </button>
                <button
                  onClick={() => setConfirmDeleteRanking(true)}
                  aria-label={t('sj.album.deleteRanking')}
                  className="p-1.5 text-muted hover:text-red-500 transition"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowInstinct(true)}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 transition"
              >
                <ArrowUpDown size={16} />
                {t('sj.album.addToRankings')}
              </button>
            )
          ) : userScore != null ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowManual(true)}
                className="flex items-center gap-2.5 group"
              >
                <span className="flex items-center gap-0.5 text-accent">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={20}
                      className={
                        userScore >= s
                          ? 'fill-current'
                          : userScore >= s - 0.5
                            ? 'fill-current opacity-50'
                            : 'opacity-25'
                      }
                    />
                  ))}
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/10 group-hover:bg-accent/[0.16] transition">
                  <FlowerGlyph size={12} className="text-accent" />
                  <span className="text-[14px] font-bold text-accent">
                    {formatScore(userScore)}
                  </span>
                </span>
              </button>
              <span className="flex-1" />
              <button
                onClick={() => setShowManual(true)}
                className="text-[13px] font-semibold text-accent hover:opacity-80"
              >
                {t('sj.common.edit')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 transition"
            >
              <Plus size={16} />
              {t('sj.album.rateThisAlbum')}
            </button>
          )}

          {confirmDeleteRanking && (
            <div className="flex items-center justify-between gap-3 mt-3 px-3.5 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
              <p className="text-[12.5px] text-ink">{t('sj.album.deleteRankingConfirm')}</p>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setConfirmDeleteRanking(false)}
                  className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-muted hover:text-ink"
                >
                  {t('sj.common.cancel')}
                </button>
                <button
                  onClick={deleteInstinctRating}
                  className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:opacity-90"
                >
                  {t('sj.common.delete')}
                </button>
              </div>
            </div>
          )}

          {communityCount > 0 && (
            <div className="flex gap-2.5 mt-4">
              {communityAvg != null && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
                  <FlowerGlyph size={12} className="text-accent" />
                  <div>
                    <p className="text-[15px] font-bold text-ink leading-tight">
                      {communityAvg.toFixed(1)}
                    </p>
                    <p className="text-[10px] text-muted">{t('sj.album.communityAvg')}</p>
                  </div>
                </div>
              )}
              <div className="px-3.5 py-2.5 rounded-[10px] bg-page border border-divider">
                <p className="text-[15px] font-bold text-ink leading-tight">{communityCount}</p>
                <p className="text-[10px] text-muted">{t('sj.album.ratings')}</p>
              </div>
            </div>
          )}

          {scoreDist.some((n) => n > 0) && (
            <RatingHistogram
              dist={scoreDist}
              userBucket={
                userScore != null
                  ? Math.min(Math.max(Math.round(userScore * 2) - 1, 0), 9)
                  : userElo != null
                    ? Math.min(Math.max(Math.round(eloToScore(userElo) * 2) - 1, 0), 9)
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
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {tracks.map((track) => {
                const trackScore = trackRatings[track.recordingId];
                const isEloRated = eloRatedTracks.has(track.recordingId);
                return (
                  <div
                    key={track.recordingId}
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
                    ) : isEloRated ? (
                      <span className="flex w-[26px] h-[26px] rounded-full bg-accent/10 items-center justify-center">
                        <ArrowUpDown size={11} className="text-accent" />
                      </span>
                    ) : userId ? (
                      <button
                        onClick={() =>
                          ratingMode === 'instinct'
                            ? setTrackInstinctTarget(track)
                            : setTrackManualTarget(track)
                        }
                        aria-label={`${t('sj.album.rateTrack')} ${track.title}`}
                        className="flex w-[26px] h-[26px] rounded-full bg-accent/10 items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                      >
                        <Plus size={12} strokeWidth={2.6} className="text-accent" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Ratings & reviews */}
        {posts.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1">
              {t('sj.album.ratingsReviews')}
            </h2>
            <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {posts.map((post) => {
                const score = displayScore(post.score, post.elo_score);
                const handle =
                  post.profiles?.username ?? post.profiles?.display_name ?? 'someone';
                return (
                  <div key={post.id} className="flex items-center gap-3 px-4 py-3">
                    <Link
                      href={`/profile/${post.profiles?.username ?? ''}`}
                      className="flex items-center gap-3 min-w-0 flex-1 group"
                    >
                      <span className="flex w-8 h-8 rounded-full bg-accent-soft text-accent-deep items-center justify-center text-[12px] font-bold shrink-0">
                        {handle.slice(0, 1).toUpperCase()}
                      </span>
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
      <ManualRateModal
        open={showManual}
        onClose={() => setShowManual(false)}
        release={release}
        existingScore={userScore}
        ratingStep={ratingStep}
        onSave={setRating}
      />
      <InstinctModal
        open={showInstinct}
        onClose={() => {
          setShowInstinct(false);
          loadRatings();
        }}
        release={release}
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
          ratingStep={0.5}
          onSave={(score) => rateTrack(trackManualTarget.recordingId, score)}
        />
      )}
      {trackInstinctTarget && (
        <InstinctModal
          open
          onClose={() => setTrackInstinctTarget(null)}
          release={release}
          track={{
            recordingId: trackInstinctTarget.recordingId,
            title: trackInstinctTarget.title,
          }}
          onRated={(id) =>
            setEloRatedTracks((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
