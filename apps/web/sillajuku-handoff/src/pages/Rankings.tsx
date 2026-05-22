import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { activeRankings, filterCountries, filterGenres, filterTimes } from '@/rankingData';

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

export default function Rankings() {
  const [country, setCountry] = useState('Global');
  const [genre, setGenre] = useState('All Genres');
  const [time, setTime] = useState('All Time');

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider">
        <div className="max-w-[1100px] mx-auto px-5 py-12 md:py-16">
          <h1 className="text-[36px] md:text-[44px] font-extrabold text-ink tracking-tight leading-[1.05]">Rankings</h1>
          <p className="text-[15px] text-muted mt-3 max-w-[520px] leading-relaxed">
            Build your ranking of the greatest albums by country, genre, and era.
          </p>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-5 py-10 pb-20 w-full flex flex-col gap-14">
        {/* Most Active Rankings */}
        <section>
          <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>Most Active Rankings</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {activeRankings.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <Link
                  to={`/rankings/${r.id}`}
                  className="block border border-divider rounded-xl p-4 hover:border-mid hover:shadow-sm transition bg-white group"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-lg ${r.topAlbum.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-ink group-hover:text-mid transition-colors truncate">{r.title}</p>
                      <p className="text-[12px] text-muted mt-0.5 truncate">
                        #1 {r.topAlbum.title} — {r.topAlbum.artist}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px] text-muted">{r.submissions.toLocaleString()} rankings</span>
                        <span className={`text-[10px] font-semibold px-2 py-[1px] rounded-full ${
                          r.status === 'Active' ? 'bg-mint-bg text-mint-dark' :
                          r.status === 'Growing' ? 'bg-surface text-muted border border-divider' :
                          'bg-white text-subtle border border-subtle'
                        }`}>
                          {r.status}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Filter Builder */}
        <section>
          <h2 className="text-[13px] font-bold text-muted uppercase mb-5" style={{ letterSpacing: '0.7px' }}>Filter Builder</h2>
          <div className="border border-divider rounded-2xl p-6 md:p-8 bg-white">
            {/* Dropdowns */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3 mb-8">
              {/* Country */}
              <div>
                <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Country</label>
                <select
                  value={country}
                  onChange={e => setCountry(e.target.value)}
                  className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none appearance-none cursor-pointer hover:border-mid transition"
                >
                  {filterCountries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Genre */}
              <div>
                <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Genre</label>
                <select
                  value={genre}
                  onChange={e => setGenre(e.target.value)}
                  className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none appearance-none cursor-pointer hover:border-mid transition"
                >
                  {filterGenres.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              {/* Time */}
              <div>
                <label className="block text-[12px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Time</label>
                <select
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  className="w-full bg-surface border border-divider rounded-xl px-4 py-3 text-[14px] text-ink outline-none appearance-none cursor-pointer hover:border-mid transition"
                >
                  {filterTimes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Preview */}
            <div className="bg-surface rounded-xl p-5 mb-6">
              <p className="text-[11px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Preview</p>
              <p className="text-[20px] md:text-[24px] font-extrabold text-ink tracking-tight">
                {generateTitle(country, genre, time)}
              </p>
            </div>

            {/* Button */}
            <Link to={`/rankings/build?country=${encodeURIComponent(country)}&genre=${encodeURIComponent(genre)}&time=${encodeURIComponent(time)}`}>
              <button className="bg-ink text-white rounded-xl px-8 py-3.5 text-[14px] font-bold hover:opacity-80 transition">
                View Ranking →
              </button>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
