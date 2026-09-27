'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, BookmarkPlus, ExternalLink, EyeOff } from 'lucide-react';
import FlowerGlyph from './FlowerGlyph';
import ManualRateModal from './ManualRateModal';
import { useContextMenu, openInNewTab } from './ContextMenu';
import { useSession } from './SessionContext';
import { useMixName, useMixTarget } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import { supabase } from '../../lib/supabaseClient';
import { markNotInterested } from '../../lib/sj/notInterested';
import type { OverflowItem } from './AlbumOverflowMenu';
import type { SJRelease } from '../../lib/sj/data';

/**
 * The standard right-click menu for an album cover/card, anywhere in the app.
 * Self-contained like `AlbumRateButton`: it owns the precise-rating modal and
 * its own `ratings` upsert/delete, so a surface only has to
 * spread `onContextMenu` and render `menu`.
 *
 * `AlbumPeek` already wraps every album cover in the app, so wiring this there
 * is what makes the menu global — individual pages need no change.
 *
 * Signed-out users still get "Open in new tab"; the rest requires a session.
 */
export function useAlbumContextMenu({
  release,
  initialScore = null,
  extraItems = [],
  onNotInterested,
}: {
  release: SJRelease;
  initialScore?: number | null;
  /** Surface-specific actions (e.g. "Remove from Mix"), rendered before the rest. */
  extraItems?: OverflowItem[];
  /** Called after the dismissal is written — the surface drops the card itself. */
  onNotInterested?: () => void;
}) {
  const { userId, profile } = useSession();
  const { t } = useLanguage();
  const [score, setScore] = useState<number | null>(initialScore);
  const [rateOpen, setRateOpen] = useState(false);
  const { target, saveAndShow, openChange } = useMixTarget();
  const mixName = useMixName();
  // Where the menu was opened — the "Saved to…" dropdown anchors there.
  const pointRef = useRef({ x: 0, y: 0 });
  const mixItem = { kind: 'album' as const, releaseGroupId: release.id };
  const mixMeta = { coverUrl: release.coverUrl, title: release.title };

  async function saveRating(next: number | null) {
    if (!supabase || !userId) return;
    setScore(next);
    if (next == null) {
      await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', release.id);
      return;
    }
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score: next },
        { onConflict: 'user_id,release_group_id' },
      );
  }

  const items: OverflowItem[] = [
    ...extraItems,
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(`/album/${release.id}`),
    },
  ];

  if (userId) {
    items.push(
      {
        key: 'rate',
        label: t('sj.context.rate'),
        icon: <FlowerGlyph size={14} src="/icon-flower.svg" />,
        onSelect: () => setRateOpen(true),
      },
      {
        key: 'save-to-mix',
        label: target ? t('sj.mix.saveTo').replace('{mix}', mixName(target)) : t('sj.mix.saveToMix'),
        icon: <Bookmark size={15} />,
        onSelect: () => saveAndShow(mixItem, pointRef.current, mixMeta),
      },
      {
        key: 'save-to-other-mix',
        label: t('sj.mix.saveToAnother'),
        icon: <BookmarkPlus size={15} />,
        onSelect: () => openChange(mixItem, pointRef.current, mixMeta),
      },
      {
        key: 'not-interested',
        label: t('sj.notInterested.action'),
        icon: <EyeOff size={15} />,
        onSelect: () => {
          // Optimistic: the surface drops the card now, the write follows.
          onNotInterested?.();
          void markNotInterested(userId, release.id);
        },
      },
    );
  }

  const { onContextMenu: openMenu, menu } = useContextMenu(items);
  const onContextMenu = (e: React.MouseEvent) => {
    pointRef.current = { x: e.clientX, y: e.clientY };
    openMenu(e);
  };

  // `Modal` is plain `fixed` markup, not a portal, and the covers this menu
  // hangs off are usually wrapped in a `<Link>` — rendering the dialog in place
  // would make every click inside it bubble up and navigate away. Portalling to
  // the body is what keeps Rate usable from a linked cover.
  const dialogs =
    rateOpen && typeof document !== 'undefined'
      ? createPortal(
          <ManualRateModal
            open
            onClose={() => setRateOpen(false)}
            release={release}
            existingScore={score}
            ratingStep={profile?.manual_rating_step ?? 0.5}
            onSave={saveRating}
          />,
          document.body,
        )
      : null;

  return {
    onContextMenu,
    menu: (
      <>
        {menu}
        {dialogs}
      </>
    ),
  };
}
