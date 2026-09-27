'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ExternalLink, Music, X, Globe, Plus, Send, Lock } from 'lucide-react';
import Cover from '../../../../components/sj/Cover';
import { useContextMenuFor, openInNewTab } from '../../../../components/sj/ContextMenu';
import { SkeletonLine, SkeletonRows } from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { useMixName, useMixTarget } from '../../../../components/sj/MixTargetContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { typeLabelKey } from '../../../../lib/sj/display';
import {
  loadMixEntries,
  mixEntryHref,
  mixEntryRef,
  type MixEntry,
} from '../../../../lib/sj/mixEntries';
import SongChip from '../../../../components/sj/SongChip';
import MixMosaic from '../../../../components/sj/MixMosaic';
import MixAddPanel from '../../../../components/sj/MixAddPanel';
import MixPostComposer from '../../../../components/sj/MixPostComposer';
import { itemKey } from '../../../../lib/sj/mixes';
import type { MixRow } from '../../../../lib/db/types';

/** Mix detail — web sibling of iOS MixDetailView. Owner can remove items. */
export default function MixPage() {
  const params = useParams<{ id: string }>();
  const mixId = params.id;
  const { t } = useLanguage();
  const mixName = useMixName();
  const { userId, ready } = useSession();
  const { remove, version, lastAdded } = useMixTarget();
  const [adding, setAdding] = useState(false);
  const [composing, setComposing] = useState(false);
  const [posted, setPosted] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mix, setMix] = useState<MixRow | null>(null);
  const [authorHandle, setAuthorHandle] = useState<string | null>(null);
  const [authorUsername, setAuthorUsername] = useState<string | null>(null);
  const [items, setItems] = useState<MixEntry[]>([]);
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

      const entries = await loadMixEntries(mixId);
      if (cancelled) return;
      if (!entries) {
        setFailed(true);
        setLoading(false);
        return;
      }
      setItems(entries);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mixId, ready, reloadKey]);

  // Saves made elsewhere (a bookmark, the dock) land here without a reload.
  // Silent: no skeleton, the list just updates.
  const isOwnerNow = !!mix && userId === mix.user_id;
  useEffect(() => {
    if (!isOwnerNow || version === 0) return;
    let cancelled = false;
    loadMixEntries(mixId).then((entries) => {
      if (!cancelled && entries) setItems(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [version, isOwnerNow, mixId]);

  // Items added to this mix (from the add panel, the dock, anywhere) slide in
  // highlighted once the list re-reads.
  useEffect(() => {
    if (!lastAdded || lastAdded.mixId !== mixId) return;
    const key = itemKey(lastAdded.item);
    setHighlight(key);
    const id = setTimeout(() => setHighlight((h) => (h === key ? null : h)), 1800);
    return () => clearTimeout(id);
  }, [lastAdded, mixId]);

  useEffect(() => {
    if (!posted) return;
    const id = setTimeout(() => setPosted(false), 5000);
    return () => clearTimeout(id);
  }, [posted]);

  const covers = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.coverUrl).filter((c): c is string => !!c))).slice(0, 4),
    [items],
  );

  const removeItem = useCallback(
    async (entry: MixEntry) => {
      setItems((prev) => prev.filter((i) => i.id !== entry.id));
      const ok = await remove(mixEntryRef(entry), mixId);
      if (!ok) setItems((prev) => [entry, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    [remove, mixId],
  );

  // Right-click menu for the rows. Declared before the early returns so the hook
  // order stays stable; "Remove from Mix" is resolved per-open, not per-render.
  const { onContextMenu: onItemContextMenu, menu: itemContextMenu } =
    useContextMenuFor<MixEntry>((item) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(mixEntryHref(item)),
      },
      ...(mix && userId === mix.user_id
        ? [
            {
              key: 'remove-from-mix',
              label: t('sj.context.removeFromMix'),
              icon: <X size={15} />,
              destructive: true,
              onSelect: () => void removeItem(item),
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

  // Anyone can post a public mix (a repost); the owner can also post a private
  // one, which the composer makes public first.
  const canPost = !!userId && (mix.is_public || isOwner);

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8">
      <header className="flex items-start gap-4 sm:gap-5">
        <MixMosaic
          covers={covers}
          isDefault={mix.is_default}
          className="w-20 h-20 sm:w-28 sm:h-28"
          rounded="rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] sm:text-[26px] font-bold text-ink leading-tight break-words">
            {mixName(mix)}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-[13px] text-muted">
            {authorHandle && (
              <Link href={`/profile/${authorUsername ?? ''}`} className="hover:underline">
                @{authorHandle}
              </Link>
            )}
            <span className="text-divider">·</span>
            <span className="inline-flex items-center gap-1">
              {mix.is_public ? <Globe size={11} /> : <Lock size={11} />}
              {mix.is_public ? t('sj.mix.public') : t('sj.mix.private')}
            </span>
            <span className="text-divider">·</span>
            {items.length === 1
              ? t('sj.mix.oneItem')
              : t('sj.mix.nItems').replace('{n}', String(items.length))}
          </p>
          {mix.description && (
            <p className="mt-1.5 text-[13.5px] text-ink/90 whitespace-pre-wrap break-words">
              {mix.description}
            </p>
          )}
          {(isOwner || canPost) && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  aria-expanded={adding}
                  className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-semibold transition ${
                    adding
                      ? 'bg-accent text-white'
                      : 'bg-accent/10 text-accent hover:bg-accent/15'
                  }`}
                >
                  <Plus size={15} strokeWidth={2.6} />
                  {t('sj.mixAdd.add')}
                </button>
              )}
              {canPost && (
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-surface border border-divider text-[13px] font-semibold text-ink hover:border-muted transition"
                >
                  <Send size={14} />
                  {t('sj.mixPost.post')}
                </button>
              )}
              {posted && (
                <span className="text-[12.5px] text-accent font-medium sj-fade-in" role="status">
                  {t('sj.mixPost.posted')}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {isOwner && adding && <MixAddPanel mixId={mix.id} onClose={() => setAdding(false)} />}

      {items.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3">
          <Music size={36} className="text-divider" />
          <p className="text-[14.5px] text-muted">{t('sj.mix.empty')}</p>
          <p className="text-[12.5px] text-muted max-w-[280px] text-center">
            {t('sj.mix.emptyDesc')}
          </p>
          {isOwner && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-accent text-white text-[13px] font-semibold hover:opacity-90 transition"
            >
              <Plus size={15} strokeWidth={2.6} />
              {t('sj.mixAdd.addFirst')}
            </button>
          )}
        </div>
      ) : (
        <ul className="mt-6 rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
          {items.map((item) => (
            <li
              key={`${item.kind}:${item.id}`}
              onContextMenu={(e) => onItemContextMenu(e, item)}
              className={`flex items-center gap-3 px-4 py-2.5 group transition-colors duration-700 ${
                highlight === itemKey(mixEntryRef(item)) ? 'bg-accent/10 sj-row-in' : ''
              }`}
            >
              <Link
                href={mixEntryHref(item)}
                className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-90 transition"
              >
                <Cover url={item.coverUrl} className="w-[50px] h-[50px]" rounded="rounded-lg" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[14px] font-semibold text-ink truncate">{item.title}</span>
                    {item.kind === 'song' && <SongChip />}
                  </span>
                  <span className="block text-[12px] text-muted truncate">
                    {item.kind === 'album'
                      ? `${t(typeLabelKey(item.releaseType))} · ${item.subtitle}`
                      : item.subtitle}
                  </span>
                </span>
              </Link>
              {isOwner && (
                <button
                  onClick={() => removeItem(item)}
                  aria-label={t('sj.mix.remove')}
                  className="p-1.5 text-muted hover:text-red-500 md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                >
                  <X size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {itemContextMenu}
      {canPost && (
        <MixPostComposer
          open={composing}
          onClose={() => setComposing(false)}
          mix={mix}
          covers={covers}
          itemCount={items.length}
          isOwner={isOwner}
          onPosted={() => setPosted(true)}
          onMadePublic={() => setMix((m) => (m ? { ...m, is_public: true } : m))}
        />
      )}
    </div>
  );
}
