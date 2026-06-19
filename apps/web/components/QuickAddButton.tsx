'use client';

import { useState } from 'react';
import { Plus, X, Bookmark } from 'lucide-react';
import { usePlaylist } from './PlaylistContext';
import CollectionPickerPopover from './CollectionPickerPopover';

interface Props {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  coverUrl?: string | null;
  trackTitle?: string;
  trackPosition?: number;
  overlay?: boolean;
  /** Inline (non-overlay): render a bookmark "save" icon instead of a plus. */
  saveIcon?: boolean;
}

export default function QuickAddButton({
  albumId, albumTitle, albumArtist, coverUrl,
  trackTitle, trackPosition, overlay = false, saveIcon = false,
}: Props) {
  const {
    addToActive, removeFromActive, removeTrackFromActive,
    activeListName, activeListId, activeReleaseIds, activeTrackKeys, userId,
  } = usePlaylist();

  // After an add, anchor the "Added to … / Change to" picker to the trigger.
  const [picker, setPicker] = useState<{ rect: DOMRect; dest: string | null } | null>(null);

  if (!userId) return null;

  const isLL    = activeListId == null;
  const isTrack = trackPosition != null;

  // Track buttons always check activeTrackKeys (specific track membership).
  // Album buttons check activeReleaseIds.
  const isInList = isTrack
    ? activeTrackKeys.has(`${albumId}::${trackPosition}`)
    : activeReleaseIds.has(albumId);

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Always pass track params — context handles LL vs custom separately
    await addToActive(albumId, albumTitle, albumArtist, coverUrl, trackTitle, trackPosition);
    // Open the destination picker, defaulting to the open collection.
    setPicker({ rect, dest: activeListId });
  };

  const pickerEl = picker && (
    <CollectionPickerPopover
      item={{ releaseId: albumId, title: albumTitle, artist: albumArtist, coverUrl, trackTitle, trackPosition }}
      anchorRect={picker.rect}
      dest={picker.dest}
      onDestChange={(dest) => setPicker((p) => (p ? { ...p, dest } : p))}
      onClose={() => setPicker(null)}
    />
  );

  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTrack && trackPosition != null) {
      await removeTrackFromActive(albumId, trackPosition);
    } else {
      await removeFromActive(albumId);
    }
  };

  // ── Overlay (album card corner badge) ─────────────────────────────────────
  let trigger: React.ReactNode;
  if (overlay) {
    if (isLL) {
      // LL overlay: bookmark toggle — album level only (no tracks on covers)
      trigger = (
        <button
          onClick={isInList ? handleRemove : handleAdd}
          title={isInList ? 'Remove from Listen Later' : 'Save to Listen Later'}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition backdrop-blur-sm ${
            isInList
              ? 'bg-[#E8A020] text-white shadow-sm'
              : 'bg-black/40 text-white/80 hover:bg-black/60'
          }`}
        >
          <Bookmark
            size={13}
            fill={isInList ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={2.2}
          />
        </button>
      );
    } else if (isInList) {
      trigger = (
        <button
          onClick={handleRemove}
          title={`Remove from ${activeListName}`}
          className="w-7 h-7 rounded-full flex items-center justify-center bg-black/50 text-white/80 hover:bg-red-500 hover:text-white transition backdrop-blur-sm"
        >
          <X size={13} />
        </button>
      );
    } else {
      trigger = (
        <button
          onClick={handleAdd}
          title={`Add to ${activeListName}`}
          className="w-7 h-7 rounded-full flex items-center justify-center bg-black/40 text-white/80 hover:bg-black/60 transition backdrop-blur-sm"
        >
          <Plus size={13} />
        </button>
      );
    }
  } else if (isInList) {
    // ── Inline (tracklist row): always + / ✗, never the bookmark icon ─────────
    trigger = (
      <button
        onClick={handleRemove}
        title={isTrack ? `Remove track from ${activeListName}` : `Remove from ${activeListName}`}
        className="flex-shrink-0 p-0.5 transition text-muted hover:text-red-500"
      >
        <X size={13} />
      </button>
    );
  } else {
    trigger = (
      <button
        onClick={handleAdd}
        title={isTrack ? `Save track to ${activeListName}` : `Save to ${activeListName}`}
        className="flex-shrink-0 p-0.5 transition text-muted hover:text-ink"
      >
        {saveIcon ? <Bookmark size={13} /> : <Plus size={13} />}
      </button>
    );
  }

  return (
    <>
      {trigger}
      {pickerEl}
    </>
  );
}
