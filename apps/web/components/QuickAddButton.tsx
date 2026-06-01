'use client';

import { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { usePlaylist } from './PlaylistContext';

interface Props {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  coverUrl?: string | null;
  trackTitle?: string;
  trackPosition?: number;
}

export default function QuickAddButton({ albumId, albumTitle, albumArtist, coverUrl, trackTitle, trackPosition }: Props) {
  const { addToActive, activeListName, userId } = usePlaylist();
  const [state, setState] = useState<'idle' | 'added' | 'exists'>('idle');

  if (!userId) return null;

  const handleAdd = async () => {
    if (state !== 'idle') return;
    const result = await addToActive(albumId, albumTitle, albumArtist, coverUrl, trackTitle, trackPosition);
    setState(result.alreadyAdded ? 'exists' : 'added');
    setTimeout(() => setState('idle'), 1500);
  };

  return (
    <button
      onClick={() => void handleAdd()}
      title={`Add to ${activeListName}`}
      className={`flex-shrink-0 p-0.5 transition ${
        state === 'idle'
          ? 'text-muted hover:text-ink'
          : 'text-mint-dark'
      }`}
    >
      {state === 'idle' ? <Plus size={13} /> : <Check size={13} />}
    </button>
  );
}
