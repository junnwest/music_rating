'use client';

import { Disc3, Music2 } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import type { MixKind } from '../../lib/sj/mixes';

/**
 * Albums | Songs, for creating a Mix. The type is permanent (migration
 * 20261011000000), so the hint says so where it's chosen.
 */
export default function MixKindPicker({
  value,
  onChange,
  className = '',
}: {
  value: MixKind;
  onChange: (kind: MixKind) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const options: { kind: MixKind; label: string; Icon: typeof Disc3 }[] = [
    { kind: 'album', label: t('sj.mix.kindAlbums'), Icon: Disc3 },
    { kind: 'song', label: t('sj.mix.kindSongs'), Icon: Music2 },
  ];
  return (
    <div className={className}>
      <div role="radiogroup" aria-label={t('sj.mix.kindLabel')} className="flex gap-1">
        {options.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value === kind}
            onClick={() => onChange(kind)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12.5px] font-semibold border transition ${
              value === kind
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'border-divider text-muted hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">{t('sj.mix.kindPermanent')}</p>
    </div>
  );
}
