'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import ScrollRow from './ScrollRow';
import { useLanguage } from '../lib/i18n';
import type { AlbumRelease } from '../types';

const VISIBLE_THRESHOLD = 8;

interface Section {
  key: string;
  name: string;
  description: string;
  albums: AlbumRelease[];
}

export default function RecommendationGridClient({ sections }: { sections: Section[] }) {
  const { t } = useLanguage();
  const [filtered, setFiltered] = useState<Section[]>(sections);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;

      const { data: ratings } = await supabase!
        .from('ratings')
        .select('release_id')
        .eq('user_id', uid);

      const rated = new Set((ratings ?? []).map((r: any) => r.release_id));
      if (rated.size === 0) return;

      setFiltered(
        sections
          .map((s) => ({ ...s, albums: s.albums.filter((a) => !rated.has(a.id)) }))
          .filter((s) => s.albums.length > 0)
      );
    });
  }, []);

  if (filtered.length === 0) return null;

  return (
    <section className="max-w-[1440px] mx-auto px-5 pb-14">
      {filtered.map((cat, i) => (
        <div key={cat.key}>
          {i > 0 && <div className="h-px bg-[#EBEBEB] my-11" />}
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="flex items-baseline gap-2">
                <div className="text-[17px] font-bold text-ink">{cat.name}</div>
                <div className="text-[12px] text-muted">{cat.albums.length} {t('explore.albums')}</div>
              </div>
              <div className="text-[12px] text-muted mt-0.5">{cat.description}</div>
            </div>
            {cat.albums.length > VISIBLE_THRESHOLD && (
              <Link
                href={`/genre/${cat.key}`}
                className="text-[12px] font-medium text-muted hover:text-mid transition whitespace-nowrap"
              >
                {t('explore.seeAll')}
              </Link>
            )}
          </div>
          <ScrollRow albums={cat.albums} />
        </div>
      ))}
    </section>
  );
}
