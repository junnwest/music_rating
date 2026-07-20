'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ExternalLink, Music, X, Globe } from 'lucide-react';
import Cover from '../../../../components/sj/Cover';
import { useContextMenuFor, openInNewTab } from '../../../../components/sj/ContextMenu';
import { SkeletonLine, SkeletonRows } from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName, typeLabelKey } from '../../../../lib/sj/display';
import type { MixRow } from '../../../../lib/db/types';

interface MixItemEntry {
  id: string;
  release: {
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    releaseType: string | null;
  };
}

/** Mix detail — web sibling of iOS MixDetailView. Owner can remove items. */
export default function MixPage() {
  const params = useParams<{ id: string }>();
  const mixId = params.id;
  const { t } = useLanguage();
  const { userId, ready } = useSession();
  const [mix, setMix] = useState<MixRow | null>(null);
  const [authorHandle, setAuthorHandle] = useState<string | null>(null);
  const [authorUsername, setAuthorUsername] = useState<string | null>(null);
  const [items, setItems] = useState<MixItemEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Gated on `ready`, not just mount: every mix but an explicitly public one is
  // owner-only under RLS, so a fetch that fires before the client has restored
  // the session reads as "not found" and never retries. Same gate home/search/
  // taste already use.
  useEffect(() => {
    if (!supabase || !ready) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      const { data: mixRow, error: mixError } = await supabase!
        .from('mixes')
        // The FK hint is required, not cosmetic: `mix_likes` gives PostgREST a
        // second mixes↔profiles path, so a bare `profiles(...)` is ambiguous and
        // fails with PGRST201 on every request — which is what made this page
        // render "not found" for every mix.
        .select('*, profiles!mixes_user_id_fkey(username, display_name)')
        .eq('id', mixId)
        .maybeSingle();
      if (cancelled) return;
      // A query failure is not the same as "no such mix" — showing "not found"
      // for a transient error hides a retry the user could have taken.
      if (mixError) {
        console.error('[mix] failed to load mix:', mixError.message);
        setFailed(true);
        setLoading(false);
        return;
      }
      const m = mixRow as any;
      if (!m) {
        setMix(null);
        setLoading(false);
        return;
      }
      setMix(m as MixRow);
      setAuthorHandle(m.profiles?.username ?? m.profiles?.display_name ?? null);
      setAuthorUsername(m.profiles?.username ?? null);

      const { data: itemRows, error: itemsError } = await supabase!
        .from('mix_items')
        .select(
          'id, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))',
        )
        .eq('mix_id', mixId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (itemsError) {
        console.error('[mix] failed to load mix items:', itemsError.message);
        setFailed(true);
        setLoading(false);
        return;
      }
      const rows = (itemRows as any[] | null) ?? [];
      // An item whose release_group embed came back null is a dangling row (or a
      // blocked read); it can't be rendered, but silently dropping every one of
      // them looks identical to an empty mix, so say so in the console.
      const usable = rows.filter((r) => r.release_groups);
      if (rows.length > 0 && usable.length === 0) {
        console.warn(`[mix] ${rows.length} mix_items but no release_groups resolved`);
      }
      setItems(
        usable
          .map((r) => ({
            id: r.id,
            release: {
              id: r.release_groups.id,
              title: displayName(r.release_groups.title, r.release_groups.native_title),
              artist: displayName(
                r.release_groups.artist_display,
                r.release_groups.artists?.name_native,
              ),
              coverUrl: r.release_groups.cover_url,
              releaseType: r.release_groups.release_group_type,
            },
          })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mixId, ready, reloadKey]);

  async function removeItem(id: string) {
    if (!supabase) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from('mix_items').delete().eq('id', id);
  }

  // Right-click menu for the rows. Declared before the early returns so the hook
  // order stays stable; "Remove from Mix" is resolved per-open, not per-render.
  const { onContextMenu: onItemContextMenu, menu: itemContextMenu } =
    useContextMenuFor<MixItemEntry>((item) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(`/album/${item.release.id}`),
      },
      ...(mix && userId === mix.user_id
        ? [
            {
              key: 'remove-from-mix',
              label: t('sj.context.removeFromMix'),
              icon: <X size={15} />,
              destructive: true,
              onSelect: () => void removeItem(item.id),
            },
          ]
        : []),
    ]);

  // Skeleton mirrors the real header + row list below, so nothing jumps when the
  // data lands. `!ready` shares it — the session gate is part of the same wait.
  if (loading || !ready) {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-8">
        <SkeletonLine w="w-48" h="h-6" />
        <SkeletonLine w="w-32" h="h-3" className="mt-2.5" />
        <SkeletonRows count={6} className="mt-7" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="py-32 flex flex-col items-center gap-3">
        <p className="text-[14.5px] text-muted max-w-[300px] text-center">
          {t('sj.common.loadError')}
        </p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="px-4 py-2 rounded-full bg-surface border border-divider/60 text-[13px] font-semibold text-ink hover:opacity-80 transition"
        >
          {t('sj.common.retry')}
        </button>
      </div>
    );
  }

  if (!mix) {
    return <div className="py-32 text-center text-muted text-[15px]">{t('sj.mix.notFound')}</div>;
  }

  const isOwner = userId === mix.user_id;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8">
      <h1 className="text-[24px] font-bold text-ink">{mix.name}</h1>
      <p className="flex items-center gap-1.5 mt-1 text-[13px] text-muted">
        {authorHandle && (
          <Link href={`/profile/${authorUsername ?? ''}`} className="hover:underline">
            @{authorHandle}
          </Link>
        )}
        {mix.is_public && (
          <>
            <span className="text-divider">·</span>
            <Globe size={11} />
            {t('sj.mix.public')}
          </>
        )}
        <span className="text-divider">·</span>
        {items.length === 1
          ? t('sj.search.oneRelease')
          : t('sj.search.nReleases').replace('{n}', String(items.length))}
      </p>

      {items.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3">
          <Music size={36} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.mix.empty')}</p>
          <p className="text-[12.5px] text-muted max-w-[280px] text-center">
            {t('sj.mix.emptyDesc')}
          </p>
        </div>
      ) : (
        <ul className="mt-6 rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
          {items.map((item) => (
            <li
              key={item.id}
              onContextMenu={(e) => onItemContextMenu(e, item)}
              className="flex items-center gap-3 px-4 py-2.5 group"
            >
              <Link
                href={`/album/${item.release.id}`}
                className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-90 transition"
              >
                <Cover url={item.release.coverUrl} className="w-[50px] h-[50px]" rounded="rounded-lg" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink truncate">
                    {item.release.title}
                  </span>
                  <span className="block text-[12px] text-muted truncate">
                    {t(typeLabelKey(item.release.releaseType))} · {item.release.artist}
                  </span>
                </span>
              </Link>
              {isOwner && (
                <button
                  onClick={() => removeItem(item.id)}
                  aria-label={t('sj.mix.remove')}
                  className="p-1.5 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                >
                  <X size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {itemContextMenu}
    </div>
  );
}
