import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { wrappedStats, getAlbumById } from '@/data';
import { Cover } from '@/components/Cover';

export default function Wrapped() {
  const [year, setYear] = useState(2025);
  const years = [2025, 2024, 2023];

  const highest = getAlbumById(wrappedStats.highestRated.albumId);
  const lowest = getAlbumById(wrappedStats.lowestRated.albumId);

  return (
    <div className="flex-1">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-10 md:py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>Your year in music</p>
          <div className="flex items-end gap-5 flex-wrap">
            <h1 className="text-[32px] md:text-[38px] font-extrabold text-ink leading-[1.06] tracking-tight">Wrapped</h1>
            <div className="flex gap-1 pb-1">
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`px-4 py-[6px] rounded-full text-[13px] font-semibold transition ${year === y ? 'bg-ink text-white' : 'bg-white border border-divider text-muted hover:text-ink'}`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[14px] md:text-[15px] text-muted mt-3 max-w-[480px] leading-relaxed">
            Every album, every score — your {year} listening story.
          </p>
        </div>
      </div>

      {/* Stats Body */}
      <div className="max-w-[860px] mx-auto px-5 py-10 md:py-12 pb-20 w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4"
        >
          {/* Top stats row */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <div className="rounded-[14px] border border-divider p-6 flex flex-col bg-white">
              <span className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>Albums rated</span>
              <span className="text-[36px] md:text-[40px] font-extrabold text-ink leading-none tracking-tight">{wrappedStats.albumsRated}</span>
            </div>
            <div className="rounded-[14px] border border-divider p-6 flex flex-col bg-white">
              <span className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>Avg score</span>
              <span className="text-[36px] md:text-[40px] font-extrabold text-ink leading-none tracking-tight">{wrappedStats.avgScore} ★</span>
            </div>
            <div className="rounded-[14px] border border-divider p-6 flex flex-col bg-white">
              <span className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>Perfect scores</span>
              <span className="text-[36px] md:text-[40px] font-extrabold text-ink leading-none tracking-tight">{wrappedStats.perfectScores}</span>
              <span className="text-[13px] text-muted mt-2">{wrappedStats.perfectPercentage}% of your ratings</span>
            </div>
          </div>

          {/* Genre + Artist row */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="rounded-[14px] border border-divider p-6 bg-white">
              <span className="text-[11px] font-semibold text-muted uppercase mb-3 block" style={{ letterSpacing: '0.7px' }}>Top genre</span>
              <span className="text-[24px] md:text-[28px] font-extrabold text-ink tracking-tight">{wrappedStats.topGenre}</span>
            </div>
            <div className="rounded-[14px] border border-divider p-6 bg-white">
              <span className="text-[11px] font-semibold text-muted uppercase mb-3 block" style={{ letterSpacing: '0.7px' }}>Most rated artist</span>
              <span className="text-[24px] md:text-[28px] font-extrabold text-ink block tracking-tight">{wrappedStats.mostRatedArtist}</span>
              <span className="text-[13px] text-muted mt-1 block">{wrappedStats.mostRatedArtistCount} albums rated</span>
            </div>
          </div>

          {/* Most active month */}
          <div className="rounded-[14px] p-6 flex items-center justify-between bg-mint">
            <div>
              <span className="text-[11px] font-semibold uppercase mb-2 block tracking-wide text-mint-dark">Most active month</span>
              <span className="text-[28px] md:text-[34px] font-extrabold text-mint-dark tracking-tight">{wrappedStats.mostActiveMonth}</span>
            </div>
            <div className="text-right">
              <span className="text-[40px] md:text-[52px] font-extrabold leading-none tracking-tight text-mint-dark">{wrappedStats.mostActiveMonthCount}</span>
              <span className="text-[13px] block text-mint-dark">albums rated</span>
            </div>
          </div>

          {/* Best + Worst album */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {highest && (
              <div className="rounded-[14px] border border-divider p-6 bg-white">
                <span className="text-[11px] font-semibold text-muted uppercase mb-4 block" style={{ letterSpacing: '0.7px' }}>Highest rated</span>
                <Link to={`/album/${highest.id}`} className="flex items-center gap-4 group">
                  <div className="w-[64px] h-[64px] md:w-[72px] md:h-[72px] rounded-lg overflow-hidden flex-shrink-0">
                    <Cover gradient={highest.coverGradient} className="w-full h-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] md:text-[16px] font-extrabold text-ink truncate group-hover:underline" style={{ letterSpacing: '-0.4px' }}>{highest.title}</div>
                    <div className="text-[12px] md:text-[13px] text-muted truncate">{highest.artist}</div>
                    <div className="inline-flex items-center mt-2 px-[9px] py-[2px] rounded-full text-[12px] font-bold bg-mint text-mint-dark">★ {wrappedStats.highestRated.rating.toFixed(1)}</div>
                  </div>
                </Link>
              </div>
            )}
            {lowest && (
              <div className="rounded-[14px] border border-divider p-6 bg-white">
                <span className="text-[11px] font-semibold text-muted uppercase mb-4 block" style={{ letterSpacing: '0.7px' }}>Lowest rated</span>
                <Link to={`/album/${lowest.id}`} className="flex items-center gap-4 group">
                  <div className="w-[64px] h-[64px] md:w-[72px] md:h-[72px] rounded-lg overflow-hidden flex-shrink-0">
                    <Cover gradient={lowest.coverGradient} className="w-full h-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] md:text-[16px] font-extrabold text-ink truncate group-hover:underline" style={{ letterSpacing: '-0.4px' }}>{lowest.title}</div>
                    <div className="text-[12px] md:text-[13px] text-muted truncate">{lowest.artist}</div>
                    <div className="inline-flex items-center mt-2 px-[9px] py-[2px] rounded-full text-[12px] font-bold bg-surface text-muted border border-divider">★ {wrappedStats.lowestRated.rating.toFixed(1)}</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
