'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../lib/i18n';

interface Category {
  id: string;
  slug: string;
  title: string;
  genre: string | null;
  year: number | null;
}

const filterCountries = [
  'Global', 'South Korea', 'Japan', 'United States', 'United Kingdom',
  'Canada', 'Australia', 'France', 'Germany', 'Brazil', 'Nigeria',
];

const genresByCountry: Record<string, string[]> = {
  'Global':         ['All Genres', 'Hip-Hop', 'R&B', 'Pop', 'Indie', 'Rock', 'Jazz', 'Electronic', 'Folk', 'Alternative', 'Classical'],
  'South Korea':    ['All Genres', 'K-Pop', 'K-Hip-Hop', 'R&B', 'Indie', 'Rock'],
  'Japan':          ['All Genres', 'J-Pop', 'City Pop', 'Rock', 'Indie', 'Electronic', 'Hip-Hop'],
  'United States':  ['All Genres', 'Hip-Hop', 'R&B', 'Pop', 'Indie', 'Rock', 'Country', 'Jazz', 'Electronic'],
  'United Kingdom': ['All Genres', 'Pop', 'Indie', 'Rock', 'Electronic', 'Hip-Hop', 'R&B'],
  'Canada':         ['All Genres', 'Hip-Hop', 'Pop', 'Indie', 'Rock', 'R&B'],
  'Australia':      ['All Genres', 'Pop', 'Indie', 'Rock', 'Hip-Hop', 'Electronic'],
  'France':         ['All Genres', 'Chanson', 'Pop', 'Electronic', 'Jazz', 'Hip-Hop', 'Indie'],
  'Germany':        ['All Genres', 'Electronic', 'Rock', 'Pop', 'Hip-Hop', 'Jazz'],
  'Brazil':         ['All Genres', 'Samba', 'Bossa Nova', 'MPB', 'Funk', 'Hip-Hop', 'Rock', 'Electronic'],
  'Nigeria':        ['All Genres', 'Afrobeats', 'Hip-Hop', 'R&B', 'Pop'],
};

const filterTimes = [
  'All Time', '2026', '2025', '2024', '2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s',
];

function inferCategoryCountry(cat: Category): string {
  if (cat.genre?.startsWith('K-') || cat.title.toLowerCase().includes('korean')) return 'South Korea';
  if (cat.genre?.startsWith('J-') || cat.title.toLowerCase().includes('japanese')) return 'Japan';
  return 'Global';
}

function timeToYear(time: string): number | null | undefined {
  if (time === 'All Time') return null;
  const n = parseInt(time);
  if (!isNaN(n) && n > 2000 && n < 2100) return n;
  return undefined;
}

export default function FilterBuilder({
  categories,
  topAlbumsMap = {},
}: {
  categories: Category[];
  topAlbumsMap?: Record<string, { coverUrl: string | null }[]>;
}) {
  const { t } = useLanguage();
  const [country, setCountry] = useState('Global');
  const [genre, setGenre] = useState('All Genres');
  const [time, setTime] = useState('All Time');
  const [userId, setUserId] = useState<string | null>(null);
  const [myRankings, setMyRankings] = useState<Record<string, boolean>>({});

  const availableGenres = genresByCountry[country] ?? genresByCountry['Global'];

  const handleCountryChange = (c: string) => {
    setCountry(c);
    setGenre('All Genres');
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const res = await fetch(`/api/rankings/personalized?userId=${uid}`);
      const json = await res.json();
      setMyRankings(json.myRankings ?? {});
    });
  }, []);

  const matchedCategory = useMemo(() => {
    const year = timeToYear(time);
    if (year === undefined) return null;
    return categories.find((cat) => {
      const catCountry = inferCategoryCountry(cat);
      const countryMatch = catCountry === country;
      const genreMatch = genre === 'All Genres' ? cat.genre === null : cat.genre === genre;
      const yearMatch = cat.year === year;
      return countryMatch && genreMatch && yearMatch;
    }) ?? null;
  }, [country, genre, time, categories]);

  const hasRanked = matchedCategory ? !!myRankings[matchedCategory.id] : false;

  // Display label: translate 'Global', 'All Genres', 'All Time' — other values stay as-is
  function countryLabel(c: string) {
    return c === 'Global' ? t('rankings.global') : c;
  }
  function genreLabel(g: string) {
    return g === 'All Genres' ? t('rankings.allGenres') : g;
  }
  function timeLabel(tm: string) {
    return tm === 'All Time' ? t('rankings.allTime') : tm;
  }

  return (
    <section>
      <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
        {t('rankings.browse')}
      </h2>

      <div className="border border-divider rounded-2xl p-6 md:p-8 bg-page">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 mb-6">
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>{t('rankings.country')}</label>
            <select
              value={country}
              onChange={e => handleCountryChange(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {filterCountries.map(c => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>{t('rankings.genre')}</label>
            <select
              value={genre}
              onChange={e => setGenre(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {availableGenres.map(g => <option key={g} value={g}>{genreLabel(g)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>{t('rankings.time')}</label>
            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {filterTimes.map(tm => <option key={tm} value={tm}>{timeLabel(tm)}</option>)}
            </select>
          </div>
        </div>

        {matchedCategory ? (
          <div className="border border-divider rounded-[12px] px-4 py-3 flex items-center gap-4">
            <div className="flex gap-[4px] flex-shrink-0">
              {Array.from({ length: 5 }).map((_, i) => {
                const album = (topAlbumsMap[matchedCategory.id] ?? [])[i];
                return album?.coverUrl ? (
                  <img
                    key={i}
                    src={album.coverUrl}
                    alt=""
                    className="w-[36px] h-[36px] rounded-[4px] object-cover border border-divider flex-shrink-0"
                  />
                ) : (
                  <div
                    key={i}
                    className="w-[36px] h-[36px] rounded-[4px] border border-dashed border-[#DDDDD8] bg-surface flex-shrink-0"
                  />
                );
              })}
            </div>

            <div className="flex-1 min-w-0">
              <div
                className="text-[14px] font-extrabold text-ink truncate"
                style={{ letterSpacing: '-0.3px' }}
              >
                {(() => { const k = `rankingTitles.${matchedCategory.slug}`; const r = t(k); return r === k ? matchedCategory.title : r; })()}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                href={`/rankings/${matchedCategory.slug}`}
                className="text-[12px] font-medium text-muted hover:text-ink transition"
              >
                {t('rankings.viewRanking')}
              </Link>
              <Link
                href={`/rankings/${matchedCategory.slug}/rank`}
                className="text-[12px] font-semibold text-ink border border-[#DDDDD8] rounded-lg px-3 py-1.5 hover:bg-surface transition whitespace-nowrap"
              >
                {hasRanked ? t('rankings.reRank') : t('rankings.rank')}
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            {t('rankings.noCurated')}
          </p>
        )}
      </div>
    </section>
  );
}
