'use client';

import { useState } from 'react';
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
 */
export default function AlbumRateButton({
  release,
  initialScore = null,
  size = 30,
  className = '',
}: {
  release: SJRelease;
  initialScore?: number | null;
  size?: number;
  className?: string;
}) {
  const { userId, profile } = useSession();
  const [score, setScore] = useState<number | null>(initialScore);
  const [modalOpen, setModalOpen] = useState(false);
  const ratingStep = profile?.manual_rating_step ?? 0.5;

  if (!userId) return null;

  async function quickRate(s: number) {
    setScore(s);
    if (!supabase || !userId) return;
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score: s },
        { onConflict: 'user_id,release_group_id' },
      );
  }

  async function saveModal(s: number | null) {
    if (!supabase || !userId) return;
    if (s == null) {
      setScore(null);
      await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', release.id);
      return;
    }
    setScore(s);
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score: s },
        { onConflict: 'user_id,release_group_id' },
      );
  }

  return (
    <>
      <FlowerRateControl
        ariaLabel={`Rate ${release.title}`}
        onRate={quickRate}
        onRequestPrecise={() => setModalOpen(true)}
        currentScore={score}
        size={size}
        className={className}
      />
      {modalOpen && (
        <ManualRateModal
          open
          onClose={() => setModalOpen(false)}
          release={release}
          existingScore={score}
          ratingStep={ratingStep}
          onSave={saveModal}
        />
      )}
    </>
  );
}
