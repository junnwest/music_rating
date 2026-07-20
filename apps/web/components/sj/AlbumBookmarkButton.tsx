'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Check, X } from 'lucide-react';
import MixPickerModal from './MixPickerModal';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';

/**
 * Hover bookmark for any album cover. One press saves the album straight to the
 * user's default "Listen Later" mix and opens a small dropdown: it stays saved
 * unless you Remove it, and you can send it to another Mix instead. The dropdown
 * auto-dismisses on any other action (click-away / scroll) or after a few
 * seconds — ignoring it just leaves the album in Listen Later.
 *
 * Renders nothing for signed-out users. Self-contained: resolves the default
 * mix and owns its own `mix_items` upsert/delete, no per-page plumbing.
 */

const DISMISS_MS = 4000;

export default function AlbumBookmarkButton({
  releaseGroupId,
  size = 26,
  className = '',
}: {
  releaseGroupId: string;
  size?: number;
  className?: string;
}) {
  const { userId } = useSession();
  const { t } = useLanguage();
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const defaultMixRef = useRef<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Dismiss on any other action (click-away / scroll) or after a timeout.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    timerRef.current = setTimeout(close, DISMISS_MS);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      clearTimeout(timerRef.current);
    };
  }, [open]);

  if (!userId) return null;

  async function ensureDefaultMix(): Promise<string | null> {
    if (defaultMixRef.current) return defaultMixRef.current;
    if (!supabase || !userId) return null;
    const { data } = await supabase
      .from('mixes')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    defaultMixRef.current = (data as { id: string } | null)?.id ?? null;
    return defaultMixRef.current;
  }

  async function onBookmark(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    const mixId = await ensureDefaultMix();
    if (!mixId || !supabase) return;
    setSaved(true);
    setOpen(true);
    await supabase
      .from('mix_items')
      .upsert(
        { mix_id: mixId, release_group_id: releaseGroupId },
        { onConflict: 'mix_id,release_group_id' },
      );
  }

  async function removeFromDefault(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSaved(false);
    setOpen(false);
    const mixId = defaultMixRef.current;
    if (mixId && supabase) {
      await supabase
        .from('mix_items')
        .delete()
        .eq('mix_id', mixId)
        .eq('release_group_id', releaseGroupId);
    }
  }

  const listenLater = t('sj.listenLater.title');

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onBookmark}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={t('sj.bookmark.save').replace('{mix}', listenLater)}
        className={`flex items-center justify-center rounded-full bg-black/55 text-white shadow backdrop-blur-sm transition hover:bg-black/70 active:scale-95 ${className}`}
        style={{ width: size, height: size }}
      >
        <Bookmark size={Math.round(size * 0.52)} className={saved ? 'fill-current' : ''} strokeWidth={2} />
      </button>

      {open &&
        anchor &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[110] w-56 rounded-xl bg-surface border border-divider shadow-xl py-1.5 sj-pop-in"
            style={{ top: anchor.top, right: anchor.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-semibold text-ink">
              <Check size={15} className="text-accent shrink-0" />
              {t('sj.bookmark.savedTo').replace('{mix}', listenLater)}
            </div>
            <div className="h-px bg-divider my-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPicker(true);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-ink hover:bg-page transition"
            >
              <Bookmark size={15} className="shrink-0" />
              {t('sj.bookmark.addToMix')}
            </button>
            <button
              onClick={removeFromDefault}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-red-500 hover:bg-page transition"
            >
              <X size={15} className="shrink-0" />
              {t('sj.bookmark.remove').replace('{mix}', listenLater)}
            </button>
          </div>,
          document.body,
        )}

      {showPicker && (
        <MixPickerModal open onClose={() => setShowPicker(false)} releaseGroupId={releaseGroupId} />
      )}
    </>
  );
}
