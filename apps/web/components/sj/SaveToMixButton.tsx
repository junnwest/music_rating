'use client';

import { useRef } from 'react';
import { Bookmark } from 'lucide-react';
import { useMixName, useMixTarget } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import type { MixItemMeta, MixItemRef } from '../../lib/sj/mixes';

/**
 * The bookmark for any album or song (D1–D3). One press saves to the current
 * target mix and opens the "Saved to {mix} · Change" dropdown; a filled
 * bookmark (the item is in *any* of your mixes) opens the dropdown instead of
 * unsaving, so a stray click can't remove anything.
 *
 * - `overlay`: the dark pill that sits on covers.
 * - `inline`: a plain icon button for rows and headers.
 *
 * Signed-out users see the button and get the auth prompt on press.
 */
export default function SaveToMixButton({
  item,
  meta,
  variant = 'overlay',
  size = 26,
  className = '',
}: {
  item: MixItemRef;
  meta?: MixItemMeta;
  variant?: 'overlay' | 'inline';
  size?: number;
  className?: string;
}) {
  const { t } = useLanguage();
  const mixName = useMixName();
  const { target, isSaved, saveAndShow } = useMixTarget();
  const btnRef = useRef<HTMLButtonElement>(null);
  const saved = isSaved(item);

  const label = saved
    ? t('sj.mix.savedManage')
    : target
      ? t('sj.mix.saveTo').replace('{mix}', mixName(target))
      : t('sj.mix.saveToMix');

  const base =
    variant === 'overlay'
      ? 'rounded-full bg-black/55 text-white shadow backdrop-blur-sm hover:bg-black/70'
      : `rounded-lg hover:bg-page ${saved ? 'text-accent' : 'text-muted hover:text-ink'}`;

  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={label}
      aria-pressed={saved}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnRef.current) saveAndShow(item, btnRef.current, meta);
      }}
      className={`flex items-center justify-center transition active:scale-95 ${base} ${className}`}
      style={{ width: size, height: size }}
    >
      <Bookmark
        size={Math.round(size * (variant === 'overlay' ? 0.52 : 0.5))}
        className={saved ? 'fill-current' : ''}
        strokeWidth={2}
      />
    </button>
  );
}

/** Album-only shorthand kept so older call sites read naturally. */
export function AlbumSaveButton({
  releaseGroupId,
  coverUrl,
  size,
  className,
}: {
  releaseGroupId: string;
  coverUrl?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <SaveToMixButton
      item={{ kind: 'album', releaseGroupId }}
      meta={coverUrl !== undefined ? { coverUrl } : undefined}
      size={size}
      className={className}
    />
  );
}
