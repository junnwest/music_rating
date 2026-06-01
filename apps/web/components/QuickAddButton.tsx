'use client';

import { useEffect, useState } from 'react';
import { Plus, Check, X, Bookmark } from 'lucide-react';
import { usePlaylist } from './PlaylistContext';

interface Props {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  coverUrl?: string | null;
  trackTitle?: string;
  trackPosition?: number;
  /** Renders as a circular badge overlaid on an album cover */
  overlay?: boolean;
}

export default function QuickAddButton({
  albumId, albumTitle, albumArtist, coverUrl,
  trackTitle, trackPosition, overlay = false,
}: Props) {
  const {
    addToActive, removeFromActive, removeTrackFromActive,
    activeListName, activeListId, activeReleaseIds, activeTrackKeys, userId,
  } = usePlaylist();

  const [justAdded, setJustAdded] = useState(false);

  // Reset the flash whenever the user switches which playlist is active
  useEffect(() => { setJustAdded(false); }, [activeListId]);

  if (!userId) return null;

  const isLL    = activeListId == null;
  const isTrack = trackPosition != null;

  // Live membership — track-level buttons check activeTrackKeys; album-level check activeReleaseIds
  const isInList = isTrack && !isLL
    ? activeTrackKeys.has(`${albumId}::${trackPosition}`)
    : activeReleaseIds.has(albumId);

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // LL never stores track sub-items — treat as album add
    if (isLL && isTrack) {
      await addToActive(albumId, albumTitle, albumArtist, coverUrl);
    } else {
      await addToActive(albumId, albumTitle, albumArtist, coverUrl, trackTitle, trackPosition);
    }
    if (!isLL) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 700);
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTrack && !isLL && trackPosition != null) {
      await removeTrackFromActive(albumId, trackPosition);
    } else {
      await removeFromActive(albumId);
    }
  };

  // ── Overlay style (album card corner badge) ────────────────────────────────
  if (overlay) {
    if (isLL) {
      return (
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
    }
    if (justAdded) {
      return (
        <span className="w-7 h-7 rounded-full flex items-center justify-center bg-[#E8A020] text-white backdrop-blur-sm shadow-sm pointer-events-none">
          <Check size={13} />
        </span>
      );
    }
    if (isInList) {
      return (
        <button
          onClick={handleRemove}
          title={`Remove from ${activeListName}`}
          className="w-7 h-7 rounded-full flex items-center justify-center bg-black/50 text-white/80 hover:bg-red-500 hover:text-white transition backdrop-blur-sm"
        >
          <X size={13} />
        </button>
      );
    }
    return (
      <button
        onClick={handleAdd}
        title={`Add to ${activeListName}`}
        className="w-7 h-7 rounded-full flex items-center justify-center bg-black/40 text-white/80 hover:bg-black/60 transition backdrop-blur-sm"
      >
        <Plus size={13} />
      </button>
    );
  }

  // ── Inline style (tracklist row) ───────────────────────────────────────────
  if (isLL) {
    return (
      <button
        onClick={isInList ? handleRemove : handleAdd}
        title={isInList ? 'Remove from Listen Later' : 'Save to Listen Later'}
        className={`flex-shrink-0 p-0.5 transition ${isInList ? 'text-[#E8A020]' : 'text-muted hover:text-ink'}`}
      >
        <Bookmark
          size={13}
          fill={isInList ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2.2}
        />
      </button>
    );
  }

  if (justAdded) {
    return (
      <span className="flex-shrink-0 p-0.5 text-[#E8A020] pointer-events-none">
        <Check size={13} />
      </span>
    );
  }
  if (isInList) {
    return (
      <button
        onClick={handleRemove}
        title={`Remove from ${activeListName}`}
        className="flex-shrink-0 p-0.5 transition text-muted hover:text-red-500"
      >
        <X size={13} />
      </button>
    );
  }
  return (
    <button
      onClick={handleAdd}
      title={isTrack ? `Add track to ${activeListName}` : `Add to ${activeListName}`}
      className="flex-shrink-0 p-0.5 transition text-muted hover:text-ink"
    >
      <Plus size={13} />
    </button>
  );
}
