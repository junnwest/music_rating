'use client';

import { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import FlowerRateControl from './FlowerRateControl';
import ManualRateModal from './ManualRateModal';
import InstinctModal from './InstinctModal';
import { useNavSafeClick } from './useNavSafeClick';
import { useSession } from './SessionContext';
import { useRating, useRatings } from './RatingsStore';
import type { SJRelease } from '../../lib/sj/data';

/**
 * Self-contained drag-to-rate button for any album cover, anywhere in the app
 * (charts, artist discography, …). Renders the flower gauge; a drag commits a
 * quick score, a tap opens the precise modal, and a rated button shows its
 * score and stays re-ratable. Manages its own `ratings` upsert/delete — drop it
 * onto a cover with no per-page plumbing. Renders nothing for signed-out users.
 *
 * Score comes from the app-wide RatingsStore, so a rated album shows its score
 * here even on pages that never fetched ratings, and one rating updates every
 * instance of that album at once. `initialScore`/`score` are only a fallback
 * used until the store has learned the album's score (e.g. on first paint, or
 * for a value the store hasn't loaded yet); once the store knows, it wins.
 *
 * A page that renders a *second* rating surface for the same release (the album
 * page has an inline flower row) can pass `score` and hear commits via
 * `onScoreChange`; because both read the same store, they stay in sync.
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
  const { setRating } = useRatings();
  const stored = useRating(release.id);
  const [modalOpen, setModalOpen] = useState(false);
  const [instinctOpen, setInstinctOpen] = useState(false);
  const [instinctRated, setInstinctRated] = useState(false);
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  const isInstinct = (profile?.rating_mode ?? 'manual') === 'instinct';
  // Store wins once it knows the album; until then fall back to the prop the
  // page handed us so a rating never flashes empty on first paint.
  const shown = stored !== undefined ? stored : (score ?? initialScore ?? null);
  // Native-listener ref: opens the Instinct sheet without the click reaching the
  // wrapping <Link> / the top progress bar. See useNavSafeClick.
  const instinctBtnRef = useNavSafeClick<HTMLButtonElement>(() => setInstinctOpen(true));

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
            onScoreChange?.(shown);
          }}
        />
      </>
    );
  }

  // A drag commits a score; a drag back into the dead zone commits null, which
  // voids (deletes) the rating. Both flow through the store so every instance
  // of this album updates at once.
  async function quickRate(s: number | null) {
    await setRating(release.id, s);
    onScoreChange?.(s);
  }

  async function saveModal(s: number | null) {
    await setRating(release.id, s);
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
