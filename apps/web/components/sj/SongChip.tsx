'use client';

import { useLanguage } from '../../lib/i18n';

/** The "song" chip that marks a song item wherever albums and songs mix (D4). */
export default function SongChip() {
  const { t } = useLanguage();
  return (
    <span className="shrink-0 px-1.5 py-px rounded bg-accent/10 text-accent text-[10px] font-semibold">
      {t('sj.mix.songChip')}
    </span>
  );
}
