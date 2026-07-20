'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import Cover from './Cover';
import { SkeletonCardGrid } from './Loading';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { displayName } from '../../lib/sj/display';
import { RG_EMBED_NATIVE } from '../../lib/sj/data';

// ── Library (saved albums) ──────────────────────────────────────────────────

interface SavedEntry {
  release_group_id: string;
  release_groups: {
    id: string;
    title: string;
    artist_display: string;
    cover_url: string | null;
    release_group_type: string | null;
    native_title: string | null;
    artists?: { name_native: string | null } | null;
  } | null;
}

/**
 * Saved-to-listen-later albums — the surface for the feed's bookmark button
 * (which previously wrote to a table nothing read). Own profile only until
 * library_visibility enforcement lands on web.
 */
export function SavedLibrary({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from('saved_releases')
      .select(`release_group_id, ${RG_EMBED_NATIVE}`)
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled) return;
        setEntries(
          ((data as unknown as SavedEntry[] | null) ?? []).filter((e) => e.release_groups),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function remove(releaseGroupId: string) {
    setEntries((prev) => prev.filter((e) => e.release_group_id !== releaseGroupId));
    await supabase
      ?.from('saved_releases')
      .delete()
      .eq('user_id', userId)
      .eq('release_group_id', releaseGroupId);
  }

  if (loading) {
    return (
      <SkeletonCardGrid
        count={8}
        className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3"
      />
    );
  }
  if (entries.length === 0) {
    return (
      <p className="py-16 text-center text-[13.5px] text-muted">{t('sj.profile.libraryEmpty')}</p>
    );
  }
  return (
    <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
      {entries.map((e) => {
        const rg = e.release_groups!;
        return (
          <div key={e.release_group_id} className="group relative">
            <Link href={`/album/${rg.id}`} className="block">
              <Cover url={rg.cover_url} className="w-full aspect-square" />
              <p className="mt-1 text-[11.5px] font-semibold text-ink truncate group-hover:underline">
                {displayName(rg.title, rg.native_title)}
              </p>
              <p className="text-[10.5px] text-muted truncate">
                {displayName(rg.artist_display, rg.artists?.name_native ?? null)}
              </p>
            </Link>
            <button
              onClick={() => remove(e.release_group_id)}
              aria-label={t('sj.profile.removeFromLibrary')}
              title={t('sj.profile.removeFromLibrary')}
              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
