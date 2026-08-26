'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, LogOut, Settings, User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { useSession } from './SessionContext';
import Avatar from './Avatar';
import { Skeleton } from './Loading';
import {
  NOTIFICATION_SELECT,
  NotificationRow,
  type NotificationEntry,
} from './notifications';

/** Generic click-outside/Esc-dismissable anchored panel. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/**
 * Bell → notifications popover (recent 8, marks read on open, View all →
 * /notifications). Desktop-grade glanceability instead of a full page turn.
 */
export function NotificationsBell({
  hasUnread,
  variant = 'bar',
}: {
  hasUnread: boolean;
  /** 'bar' opens the panel below-right (top bar); 'sidebar' opens it above-left. */
  variant?: 'bar' | 'sidebar';
}) {
  const { t, lang } = useLanguage();
  const { userId, refreshProfile } = useSession();
  const { open, setOpen, ref } = usePopover();
  const [items, setItems] = useState<NotificationEntry[] | null>(null);
  const panelPos =
    variant === 'sidebar' ? 'left-0 bottom-full mb-2' : 'right-0 top-11';

  const loadAndMarkRead = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data } = await supabase
      .from('notifications')
      .select(NOTIFICATION_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8);
    setItems((data as unknown as NotificationEntry[] | null) ?? []);
    await supabase
      .from('profiles')
      .update({ notifications_last_seen_at: new Date().toISOString() })
      .eq('id', userId);
    refreshProfile();
  }, [userId, refreshProfile]);

  // Signed out → plain link to the page (which shows its own empty state)
  if (!userId) {
    return (
      <Link
        href="/notifications"
        aria-label={t('sj.nav.notifications')}
        className="relative p-2 rounded-lg text-ink hover:bg-surface transition"
      >
        <Bell size={19} strokeWidth={1.9} />
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={t('sj.nav.notifications')}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            setItems(null);
            loadAndMarkRead();
          }
        }}
        className="relative p-2 rounded-lg text-ink hover:bg-surface transition"
      >
        <Bell size={19} strokeWidth={1.9} />
        {hasUnread && !open && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
        )}
      </button>

      {open && (
        <div className={`absolute ${panelPos} z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl bg-surface border border-divider shadow-lg overflow-hidden sj-pop-in`}>
          <p className="px-3.5 pt-3 pb-2 text-[13px] font-bold text-ink">
            {t('sj.nav.notifications')}
          </p>
          {items === null ? (
            <div className="px-3.5 pb-3 space-y-2" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-3.5 pb-4 pt-1 text-[13px] text-muted">
              {t('sj.notifications.empty')}
            </p>
          ) : (
            <div className="divide-y divide-divider border-t border-divider">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  t={t}
                  lang={lang}
                  compact
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block py-2.5 text-center text-[12.5px] font-semibold text-accent border-t border-divider hover:bg-page/60 transition"
          >
            {t('sj.notifications.viewAll')}
          </Link>
        </div>
      )}
    </div>
  );
}

/** Avatar → account menu (identity header, Profile, Settings, Sign out). */
export function AvatarMenu({ variant = 'bar' }: { variant?: 'bar' | 'sidebar' }) {
  const { t } = useLanguage();
  const { profile, signOut } = useSession();
  const { open, setOpen, ref } = usePopover();
  const name = profile?.display_name ?? profile?.username ?? '';
  const panelPos =
    variant === 'sidebar' ? 'left-0 bottom-full mb-2 w-full' : 'right-0 top-11 w-52';

  return (
    <div ref={ref} className={variant === 'sidebar' ? 'relative w-full' : 'relative'}>
      {variant === 'sidebar' ? (
        <button
          aria-label={t('sj.nav.profile')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-surface transition"
        >
          <Avatar url={profile?.avatar_url} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
            {profile?.username && (
              <span className="block truncate text-[11.5px] text-muted">@{profile.username}</span>
            )}
          </span>
        </button>
      ) : (
        <button
          aria-label={t('sj.nav.profile')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="p-1 rounded-full hover:bg-surface transition"
        >
          <Avatar url={profile?.avatar_url} size={28} />
        </button>
      )}

      {open && (
        <div className={`absolute ${panelPos} z-50 rounded-xl bg-surface border border-divider shadow-lg overflow-hidden py-1 sj-pop-in`}>
          <div className="px-3.5 py-2.5 border-b border-divider">
            <p className="text-[13.5px] font-bold text-ink truncate">
              {profile?.display_name ?? profile?.username ?? ''}
            </p>
            {profile?.username && (
              <p className="text-[12px] text-muted truncate">@{profile.username}</p>
            )}
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-[13.5px] text-ink hover:bg-page/70 transition"
          >
            <User size={15} className="text-muted" /> {t('sj.nav.profile')}
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-[13.5px] text-ink hover:bg-page/70 transition"
          >
            <Settings size={15} className="text-muted" /> {t('sj.nav.settings')}
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13.5px] text-red-500 hover:bg-page/70 transition border-t border-divider mt-1 pt-2.5"
          >
            <LogOut size={15} /> {t('sj.settings.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
