'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThumbsDown, Minus, ThumbsUp, Check, Music } from 'lucide-react';
import Modal from './Modal';
import Cover from './Cover';
import FlowerGlyph from './FlowerGlyph';
import PostRatingOptions from './PostRatingOptions';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import {
  seedElo,
  kFactor,
  expectedScore,
  eloToScore,
  INSTINCT_REVEAL_THRESHOLD,
  type Sentiment,
} from '../../lib/elo';
import { releaseDisplayArtist, releaseDisplayTitle, type SJRelease } from '../../lib/sj/data';
import { typeLabelKey } from '../../lib/sj/display';

/**
 * Instinct rating flow — the web mirror of iOS InstinctRatingView /
 * InstinctTrackRatingView. bucket (soft Elo seed) → post-rating options →
 * ≤3 binary-search comparisons against the user's ranked list → done
 * (score revealed once ≥5 rated). Works for albums (ratings /
 * pairwise_comparisons) and tracks (track_ratings / track_pairwise_comparisons).
 */

interface Opponent {
  id: string; // release_group_id or recording_id
  title: string;
  artist: string;
  coverUrl: string | null;
  eloScore: number;
  eloGames: number;
}

type Phase = 'bucket' | 'postRating' | 'comparing' | 'done';

export default function InstinctModal({
  open,
  onClose,
  release,
  track,
  onRated,
}: {
  open: boolean;
  onClose: () => void;
  release: SJRelease;
  /** Rate this track (recording) instead of the album. */
  track?: { recordingId: string; title: string } | null;
  onRated?: (id: string) => void;
}) {
  const { t } = useLanguage();
  const isTrack = !!track;
  const subjectId = isTrack ? track!.recordingId : release.id;
  const table = isTrack ? 'track_ratings' : 'ratings';
  const keyCol = isTrack ? 'recording_id' : 'release_group_id';
  const compTable = isTrack ? 'track_pairwise_comparisons' : 'pairwise_comparisons';

  const [phase, setPhase] = useState<Phase>('bucket');
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(0);
  const [comparisonIndex, setComparisonIndex] = useState(0);
  const [totalComparisons, setTotalComparisons] = useState(0);
  const [newElo, setNewElo] = useState(1500);
  const [newEloGames, setNewEloGames] = useState(0);
  const [pendingReview, setPendingReview] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [ratedCount, setRatedCount] = useState(0);
  const [selectedSide, setSelectedSide] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Reset + load opponents when opened
  useEffect(() => {
    if (!open || !supabase) return;
    setPhase('bucket');
    setComparisonIndex(0);
    setSelectedSide(null);
    setFinalScore(null);
    setPendingReview(null);
    setNewEloGames(0);

    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase!.auth.getUser();
      const uid = userData.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      if (!uid) return;

      let loaded: Opponent[] = [];
      if (isTrack) {
        const { data } = await supabase!
          .from('track_ratings')
          .select('recording_id, elo_score, elo_games, recordings(title, artist_display)')
          .eq('user_id', uid)
          .not('elo_score', 'is', null)
          .neq('recording_id', subjectId)
          .order('elo_score', { ascending: false });
        loaded = ((data as any[] | null) ?? []).map((r) => ({
          id: r.recording_id,
          title: r.recordings?.title ?? '',
          artist: r.recordings?.artist_display ?? '',
          coverUrl: null,
          eloScore: r.elo_score,
          eloGames: r.elo_games ?? 0,
        }));
      } else {
        const { data } = await supabase!
          .from('ratings')
          .select(
            'release_group_id, elo_score, elo_games, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native))',
          )
          .eq('user_id', uid)
          .not('elo_score', 'is', null)
          .neq('release_group_id', subjectId)
          .order('elo_score', { ascending: false });
        loaded = ((data as any[] | null) ?? []).map((r) => ({
          id: r.release_group_id,
          title: r.release_groups?.native_title ?? r.release_groups?.title ?? '',
          artist:
            r.release_groups?.artists?.name_native ??
            r.release_groups?.artist_display ??
            '',
          coverUrl: r.release_groups?.cover_url ?? null,
          eloScore: r.elo_score,
          eloGames: r.elo_games ?? 0,
        }));
      }
      if (cancelled) return;
      const n = loaded.length;
      setOpponents(loaded);
      setLo(0);
      setHi(n);
      setRatedCount(n);
      setTotalComparisons(n > 0 ? Math.min(3, Math.ceil(Math.log2(n + 1))) : 0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectId]);

  const currentOpponent = (() => {
    const mid = Math.floor((lo + hi) / 2);
    if (lo >= hi || mid >= opponents.length) return null;
    return opponents[mid];
  })();

  async function updateEloRow(id: string, elo: number, games: number) {
    if (!supabase || !userId) return;
    await supabase
      .from(table)
      .update({ elo_score: elo, elo_games: games })
      .eq('user_id', userId)
      .eq(keyCol, id);
  }

  async function writeScoreRow(id: string, score: number) {
    if (!supabase || !userId) return;
    await supabase.from(table).update({ score }).eq('user_id', userId).eq(keyCol, id);
  }

  const finalize = useCallback(
    async (elo: number, reviewText: string | null, oppCount: number) => {
      const count = oppCount + 1;
      setRatedCount(count);
      if (count >= INSTINCT_REVEAL_THRESHOLD) {
        const score = eloToScore(elo);
        setFinalScore(score);
        await writeScoreRow(subjectId, score);
      }
      if (reviewText && !isTrack && supabase && userId) {
        const { data } = await supabase
          .from('ratings')
          .select('id')
          .eq('user_id', userId)
          .eq('release_group_id', subjectId)
          .maybeSingle();
        const rid = (data as { id: string } | null)?.id;
        if (rid) {
          await supabase.from('ratings').update({ review_text: reviewText }).eq('id', rid);
        }
      }
      setPhase('done');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectId, isTrack, userId],
  );

  async function pickBucket(sentiment: Sentiment) {
    setNewElo(seedElo(sentiment));
    setNewEloGames(0);
    setPhase('postRating');
    onRated?.(subjectId);
  }

  async function continueFromPostRating(reviewText: string | null) {
    if (!supabase || !userId) return;
    setPendingReview(reviewText);
    await supabase
      .from(table)
      .upsert(
        { user_id: userId, [keyCol]: subjectId, elo_score: newElo, elo_games: newEloGames },
        { onConflict: `user_id,${keyCol}` },
      );
    if (opponents.length > 0 && lo < hi && totalComparisons > 0) {
      setPhase('comparing');
    } else {
      await finalize(newElo, reviewText, opponents.length);
    }
  }

  async function vote(newWon: boolean) {
    if (!supabase || !userId) return;
    const opp = currentOpponent;
    if (!opp || lo >= hi) {
      await finalize(newElo, pendingReview, opponents.length);
      return;
    }

    // Narrow binary search
    const mid = Math.floor((lo + hi) / 2);
    const nextLo = newWon ? lo : mid + 1;
    const nextHi = newWon ? mid : hi;
    const nextIndex = comparisonIndex + 1;

    // Elo update (mirrors iOS Elo.update; unrounded like Swift)
    const exp = newWon
      ? expectedScore(newElo, opp.eloScore)
      : expectedScore(opp.eloScore, newElo);
    let subjectNewElo: number;
    let oppNewElo: number;
    if (newWon) {
      subjectNewElo = newElo + kFactor(newEloGames) * (1 - exp);
      oppNewElo = opp.eloScore + kFactor(opp.eloGames) * (0 - (1 - exp));
    } else {
      oppNewElo = opp.eloScore + kFactor(opp.eloGames) * (1 - exp);
      subjectNewElo = newElo + kFactor(newEloGames) * (0 - (1 - exp));
    }
    const subjectGames = newEloGames + 1;

    setLo(nextLo);
    setHi(nextHi);
    setComparisonIndex(nextIndex);
    setNewElo(subjectNewElo);
    setNewEloGames(subjectGames);
    setSelectedSide(null);

    await Promise.all([
      updateEloRow(subjectId, subjectNewElo, subjectGames),
      updateEloRow(opp.id, oppNewElo, opp.eloGames + 1),
      supabase.from(compTable).insert({
        user_id: userId,
        winner_id: newWon ? subjectId : opp.id,
        loser_id: newWon ? opp.id : subjectId,
      }),
      opponents.length + 1 >= INSTINCT_REVEAL_THRESHOLD
        ? writeScoreRow(opp.id, eloToScore(oppNewElo))
        : Promise.resolve(),
    ]);

    if (nextLo >= nextHi || nextIndex >= totalComparisons) {
      await finalize(subjectNewElo, pendingReview, opponents.length);
    }
  }

  const subjectTitle = isTrack ? track!.title : releaseDisplayTitle(release);
  const subjectArtist = releaseDisplayArtist(release);
  const chipLabel = isTrack ? t('sj.type.song') : t(typeLabelKey(release.releaseType));

  const buckets: { sentiment: Sentiment; label: string; icon: typeof ThumbsUp; color: string; bg: string }[] = [
    { sentiment: 'bad', label: t('sj.instinct.bad'), icon: ThumbsDown, color: 'text-red-500', bg: 'bg-red-500/[0.08] hover:bg-red-500/[0.14]' },
    { sentiment: 'neutral', label: t('sj.instinct.neutral'), icon: Minus, color: 'text-muted', bg: 'bg-muted/[0.08] hover:bg-muted/[0.14]' },
    { sentiment: 'good', label: t('sj.instinct.good'), icon: ThumbsUp, color: 'text-accent', bg: 'bg-accent/[0.08] hover:bg-accent/[0.14]' },
  ];

  return (
    <Modal open={open} onClose={onClose} showClose={phase !== 'done'} maxWidth="max-w-md">
      {phase === 'bucket' && (
        <div className="px-5 pt-4 pb-6">
          <div className="flex items-center gap-3">
            <Cover url={release.coverUrl} className="w-[52px] h-[52px]" rounded="rounded-lg" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink line-clamp-2">{subjectTitle}</p>
              <p className="flex items-center gap-1.5 text-[12px] text-muted truncate">
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium shrink-0">
                  {chipLabel}
                </span>
                {subjectArtist}
              </p>
            </div>
          </div>
          <div className="h-px bg-divider my-4" />
          <p className="text-center text-[11px] font-semibold tracking-[0.08em] uppercase text-muted mb-3">
            {t('sj.instinct.howWasIt')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {buckets.map(({ sentiment, label, icon: Icon, color, bg }) => (
              <button
                key={sentiment}
                onClick={() => pickBucket(sentiment)}
                className={`flex flex-col items-center gap-1.5 py-3.5 rounded-[10px] transition ${bg}`}
              >
                <Icon size={20} className={color} />
                <span className={`text-[10px] font-semibold tracking-[0.05em] uppercase ${color}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'postRating' && (
        <PostRatingOptions
          release={release}
          onBack={() => setPhase('bucket')}
          onContinue={continueFromPostRating}
        />
      )}

      {phase === 'comparing' && currentOpponent && (
        <div className="px-5 pt-4 pb-6">
          {totalComparisons > 0 && (
            <div className="flex gap-1.5 px-4 mb-4">
              {Array.from({ length: totalComparisons }).map((_, i) => (
                <span
                  key={i}
                  className={`h-[3px] flex-1 rounded-full ${
                    i < comparisonIndex ? 'bg-accent' : 'bg-divider'
                  }`}
                />
              ))}
            </div>
          )}
          <p className="text-center text-[14px] font-bold text-ink mb-3.5">
            {t('sj.instinct.whichPrefer')}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <CompareCard
              title={subjectTitle}
              artist={subjectArtist}
              coverUrl={release.coverUrl}
              isNew
              newLabel={t('sj.instinct.new')}
              selected={selectedSide === true}
              onClick={() => setSelectedSide(true)}
            />
            <CompareCard
              title={currentOpponent.title}
              artist={currentOpponent.artist}
              coverUrl={currentOpponent.coverUrl}
              isNew={false}
              newLabel=""
              selected={selectedSide === false}
              onClick={() => setSelectedSide(false)}
            />
          </div>
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={() => {
                setPhase('bucket');
                setSelectedSide(null);
              }}
              className="flex-1 py-2.5 rounded-[10px] bg-divider/60 text-[13px] font-semibold text-muted hover:text-ink transition"
            >
              ← {t('sj.common.back')}
            </button>
            <button
              onClick={() => selectedSide !== null && vote(selectedSide)}
              disabled={selectedSide === null}
              className={`flex-1 py-2.5 rounded-[10px] text-[13px] font-semibold transition ${
                selectedSide === null
                  ? 'bg-divider/60 text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:opacity-90'
              }`}
            >
              {t('sj.instinct.select')}
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="px-5 pt-5 pb-6">
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <Cover url={release.coverUrl} className="w-14 h-14" rounded="rounded-lg" />
              <span className="absolute -bottom-1 -right-1 flex w-5 h-5 rounded-full bg-accent items-center justify-center ring-2 ring-page">
                <Check size={10} strokeWidth={3} className="text-white" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink line-clamp-2">{subjectTitle}</p>
              <p className="text-[12px] text-muted truncate">{subjectArtist}</p>
            </div>
          </div>

          {finalScore != null ? (
            <div className="flex items-center justify-center gap-2 mt-4 py-3.5 rounded-xl bg-accent/[0.08]">
              <FlowerGlyph size={14} className="text-accent" />
              <span className="text-[26px] font-bold text-accent tabular-nums">
                {finalScore.toFixed(1)}
              </span>
              <span className="text-[11px] text-muted">
                {t('sj.instinct.rankedCount').replace('{n}', String(ratedCount))}
              </span>
            </div>
          ) : (
            <div className="mt-4 text-center">
              <p className="text-[16px] font-bold text-ink">{t('sj.instinct.ranked')}</p>
              {ratedCount < INSTINCT_REVEAL_THRESHOLD && (
                <p className="mt-1 text-[12px] text-muted">
                  {t('sj.instinct.rateMoreToReveal').replace(
                    '{n}',
                    String(INSTINCT_REVEAL_THRESHOLD - ratedCount),
                  )}
                </p>
              )}
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-4 w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 transition"
          >
            {t('sj.common.done')}
          </button>
        </div>
      )}
    </Modal>
  );
}

function CompareCard({
  title,
  artist,
  coverUrl,
  isNew,
  newLabel,
  selected,
  onClick,
}: {
  title: string;
  artist: string;
  coverUrl: string | null;
  isNew: boolean;
  newLabel: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-[1.5px] transition ${
        selected
          ? 'border-accent bg-accent/10'
          : isNew
            ? 'border-divider bg-accent/[0.04] hover:border-muted'
            : 'border-divider bg-surface hover:border-muted'
      }`}
    >
      {coverUrl ? (
        <Cover url={coverUrl} className="w-[74px] h-[74px]" rounded="rounded-lg" />
      ) : (
        <span className="flex w-[74px] h-[74px] rounded-lg bg-divider items-center justify-center">
          <Music size={26} className="text-muted" />
        </span>
      )}
      <span className="text-[11px] font-bold text-ink text-center line-clamp-2">{title}</span>
      <span className="text-[10px] text-muted truncate max-w-full">{artist}</span>
      {isNew ? (
        <span className="px-1.5 py-0.5 rounded bg-accent/[0.12] text-accent text-[9px] font-bold">
          {newLabel}
        </span>
      ) : (
        <span className="h-[17px]" />
      )}
    </button>
  );
}
