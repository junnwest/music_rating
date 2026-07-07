'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Music, X, Globe } from 'lucide-react';
import Cover from '../../../../components/sj/Cover';
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
  const { userId } = useSession();
  const [mix, setMix] = useState<MixRow | null>(null);
  const [authorHandle, setAuthorHandle] = useState<string | null>(null);
  const [authorUsername, setAuthorUsername] = useState<string | null>(null);
  const [items, setItems] = useState<MixItemEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data: mixRow } = await supabase!
        .from('mixes')
        .select('*, profiles(username, display_name)')
        .eq('id', mixId)
        .maybeSingle();
      if (cancelled) return;
      const m = mixRow as any;
      if (!m) {
        setLoading(false);
        return;
      }
      setMix(m as MixRow);
      setAuthorHandle(m.profiles?.username ?? m.profiles?.display_name ?? null);
      setAuthorUsername(m.profiles?.username ?? null);

      const { data: itemRows } = await supabase!
        .from('mix_items')
        .select(
          'id, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))',
        )
        .eq('mix_id', mixId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setItems(
        ((itemRows as any[] | null) ?? [])
          .filter((r) => r.release_groups)
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
  }, [mixId]);

  async function removeItem(id: string) {
    if (!supabase) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from('mix_items').delete().eq('id', id);
  }

  if (loading) {
    return <div className="py-32 text-center text-muted text-[13px]">…</div>;
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
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 group">
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
    </div>
  );
}
