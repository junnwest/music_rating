'use client';

import { useState } from 'react';
import Link from 'next/link';

const filterCountries = [
  'Global', 'South Korea', 'Japan', 'United States', 'United Kingdom',
  'Canada', 'Australia', 'France', 'Germany', 'Brazil', 'Nigeria',
];

const filterGenres = [
  'All Genres', 'K-Pop', 'K-R&B', 'K-Indie', 'K-Rap',
  'Hip-Hop', 'R&B', 'Pop', 'Indie', 'Rock', 'Jazz',
  'Electronic', 'Classical', 'Folk', 'Alternative',
];

const filterTimes = [
  'All Time', '2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s',
];

function generateTitle(country: string, genre: string, time: string): string {
  const parts: string[] = ['Greatest'];
  if (country !== 'Global') parts.push(country);
  if (genre !== 'All Genres') parts.push(genre);
  else if (country === 'Global') parts.push('Albums');
  else parts.push('Albums');
  if (time !== 'All Time') parts.push(`of the ${time}`);
  else if (parts.length === 2) parts.push('of All Time');
  if (parts.length === 1) parts.push('Albums of All Time');
  return parts.join(' ');
}

export default function FilterBuilder() {
  const [country, setCountry] = useState('Global');
  const [genre, setGenre] = useState('All Genres');
  const [time, setTime] = useState('All Time');

  return (
    <section>
      <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>
        Filter Builder
      </h2>
      <div className="border border-divider rounded-2xl p-6 md:p-8 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 mb-8">
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Country</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {filterCountries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Genre</label>
            <select
              value={genre}
              onChange={e => setGenre(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {filterGenres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Time</label>
            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none cursor-pointer hover:border-mid transition"
            >
              {filterTimes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-surface rounded-xl p-5 mb-6">
          <p className="text-[11px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Preview</p>
          <p className="text-[20px] md:text-[24px] font-extrabold text-ink tracking-tight">
            {generateTitle(country, genre, time)}
          </p>
        </div>

        <Link
          href={`/rankings/build?country=${encodeURIComponent(country)}&genre=${encodeURIComponent(genre)}&time=${encodeURIComponent(time)}`}
          className="inline-block"
        >
          <button className="bg-ink text-white rounded-xl px-8 py-3.5 text-[14px] font-bold hover:opacity-80 transition">
            View Ranking →
          </button>
        </Link>
      </div>
    </section>
  );
}
