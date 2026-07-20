'use client';

import { useEffect, useState } from 'react';
import FlowerRateControl from './FlowerRateControl';
import ManualRateModal from './ManualRateModal';
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
  const ratingStep = profile?.manual_rating_step ?? 0.5;

  useEffect(() => {
    if (score !== undefined) setShown(score);
  }, [score]);

  if (!userId) return null;

  async function quickRate(s: number) {
    setShown(s);
    if (!supabase || !userId) return;
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score: s },
        { onConflict: 'user_id,release_group_id' },
      );
    onScoreChange?.(s);
  }

  async function saveModal(s: number | null) {
    setShown(s);
    if (!supabase || !userId) return;
    if (s == null) {
      await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', release.id);
    } else {
      await supabase
        .from('ratings')
        .upsert(
          { user_id: userId, release_group_id: release.id, score: s },
          { onConflict: 'user_id,release_group_id' },
        );
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
