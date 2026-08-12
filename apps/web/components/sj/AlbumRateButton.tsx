'use client';

import { useEffect, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import FlowerRateControl from './FlowerRateControl';
import ManualRateModal from './ManualRateModal';
import InstinctModal from './InstinctModal';
import { useNavSafeClick } from './useNavSafeClick';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import type { SJRelease } from '../../lib/sj/data';

/**
 * Self-contained drag-to-rate button for any album cover, anywhere in the app
 * (charts, artist discography, …). Renders the flower gauge; a drag commits a
 * quick score, a tap opens the precise modal, and a rated button shows its
 * score and stays re-ratable. Manages its own `ratings` upsert/delete — drop it
 * onto a cover with no per-page plumbing. Renders nothing for signed-out users.
 *
 * `initialScore` lets a page that already knows the user's rating pre-fill it;
 * pages that don't simply start unrated (a re-rate still upserts correctly).
 *
 * A page that renders a *second* rating surface for the same release (the album
 * page has an inline flower row) can pass `score` to push its value down and
 * `onScoreChange` to hear about commits, keeping the two in sync. The button
 * still shows its own optimistic value first, so a drag never lags on a refetch.
 *
 * Mode-aware: in Instinct mode the drag-to-rate flower is replaced by a plus
 * button that opens the pairwise Instinct flow (no quick score, no drag), and
 * turns into a check once the album has been ranked — mirroring iOS AlbumCard.
 * Because `profile.rating_mode` comes from the session, flipping the mode in
 * Settings swaps every cover's button immediately, with no refetch.
 */
export default function AlbumRateButton({
  release,
  initialScore = null,
  score,
  onScoreChange,
  size = 30,
  className = '',
}: {
  release: SJRelease;
  initialScore?: number | null;
  /** Controlled value pushed down by the page; syncs the displayed score. */
  score?: number | null;
  /** Fired after the write lands, so the page can refresh its own state. */
  onScoreChange?: (score: number | null) => void;
  size?: number;
  className?: string;
}) {
  const { userId, profile } = useSession();
  const [shown, setShown] = useState<number | null>(score ?? initialScore);
  const [modalOpen, setModalOpen] = useState(false);
  const [instinctOpen, setInstinctOpen] = useState(false);
  const [instinctRated, setInstinctRated] = useState(false);
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  const isInstinct = (profile?.rating_mode ?? 'manual') === 'instinct';
  // Native-listener ref: opens the Instinct sheet without the click reaching the
  // wrapping <Link> / the top progress bar. See useNavSafeClick.
  const instinctBtnRef = useNavSafeClick<HTMLButtonElement>(() => setInstinctOpen(true));

  useEffect(() => {
    if (score !== undefined) setShown(score);
  }, [score]);

  if (!userId) return null;

  // ── Instinct mode: a plus (→ check) that opens the pairwise flow. No drag,
  // no quick score — ranking is the only way to rate here. Matches iOS. ──
  if (isInstinct) {
    return (
      <>
        <button
          ref={instinctBtnRef}
          type="button"
          aria-label={`Rate ${release.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          className={`grid place-items-center rounded-full shadow bg-white text-accent transition-transform hover:scale-105 active:scale-95 ${className}`}
          style={{ width: size, height: size }}
        >
          {instinctRated ? (
            <Check size={Math.round(size * 0.5)} strokeWidth={3} />
          ) : (
            <Plus size={Math.round(size * 0.52)} strokeWidth={3} />
          )}
        </button>
        <InstinctModal
          open={instinctOpen}
          onClose={() => setInstinctOpen(false)}
          release={release}
          onRated={() => {
            setInstinctRated(true);
            onScoreChange?.(shown ?? null);
          }}
        />
      </>
    );
  }

  async function quickRate(s: number) {
    const prev = shown;
    setShown(s);
    if (!supabase || !userId) return;
    const { error } = await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score: s },
        { onConflict: 'user_id,release_group_id' },
      );
    if (error) {
      // Don't leave a misleading optimistic score that vanishes on refresh —
      // revert and surface the reason (RLS / constraint / auth / network).
      console.error('[AlbumRateButton] rating upsert failed', { releaseGroupId: release.id, score: s, error });
      setShown(prev);
      return;
    }
    onScoreChange?.(s);
  }

  async function saveModal(s: number | null) {
    const prev = shown;
    setShown(s);
    if (!supabase || !userId) return;
    let error;
    if (s == null) {
      ({ error } = await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', release.id));
    } else {
      ({ error } = await supabase
        .from('ratings')
        .upsert(
          { user_id: userId, release_group_id: release.id, score: s },
          { onConflict: 'user_id,release_group_id' },
        ));
    }
    if (error) {
      console.error('[AlbumRateButton] rating save failed', { releaseGroupId: release.id, score: s, error });
      setShown(prev);
      return;
    }
    onScoreChange?.(s);
  }

  return (
    <>
      <FlowerRateControl
        ariaLabel={`Rate ${release.title}`}
        onRate={quickRate}
        onRequestPrecise={() => setModalOpen(true)}
        currentScore={shown}
        size={size}
        className={className}
        ratingStep={ratingStep}
      />
      {modalOpen && (
        <ManualRateModal
          open
          onClose={() => setModalOpen(false)}
          release={release}
          existingScore={shown}
          ratingStep={ratingStep}
          onSave={saveModal}
        />
      )}
    </>
  );
}
