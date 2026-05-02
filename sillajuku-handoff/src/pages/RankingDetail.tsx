import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { albumPool, communityTop10 } from '@/rankingData';
import type { PoolAlbum } from '@/rankingData';

function generateTitle(country: string, genre: string, time: string): string {
  const parts: string[] = ['Greatest'];
  if (country !== 'Global') parts.push(country);
  if (genre !== 'All Genres') parts.push(genre);
  else parts.push('Albums');
  if (time !== 'All Time') parts.push(`of the ${time}`);
  return parts.join(' ');
}

export default function RankingDetail() {
  const [searchParams] = useSearchParams();
  const country = searchParams.get('country') || 'Global';
  const genre = searchParams.get('genre') || 'All Genres';
  const time = searchParams.get('time') || 'All Time';
  const title = generateTitle(country, genre, time);

  const [myRanking, setMyRanking] = useState<(PoolAlbum | null)[]>(Array(10).fill(null));
  const [poolSearch, setPoolSearch] = useState('');

  const filteredPool = useMemo(() => {
    if (!poolSearch.trim()) return albumPool;
    const q = poolSearch.toLowerCase();
    return albumPool.filter(a =>
      a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
    );
  }, [poolSearch]);

  const filledCount = myRanking.filter(Boolean).length;

  const addToRanking = (album: PoolAlbum) => {
    const emptyIdx = myRanking.findIndex(s => s === null);
    if (emptyIdx === -1) return;
    const next = [...myRanking];
    next[emptyIdx] = album;
    setMyRanking(next);
  };

  const removeFromRanking = (index: number) => {
    const next = [...myRanking];
    next[index] = null;
    setMyRanking(next);
  };

  const clearRanking = () => setMyRanking(Array(10).fill(null));

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider">
        <div className="max-w-[1200px] mx-auto px-5 py-8 md:py-10">
          <Link to="/rankings" className="text-[12px] text-muted hover:text-ink transition mb-3 inline-block">← Rankings</Link>
          <h1 className="text-[24px] md:text-[30px] font-extrabold text-ink tracking-tight leading-[1.08]">{title}</h1>
          <p className="text-[12px] text-muted mt-2">One ranking per user. You can update it anytime.</p>
        </div>
      </div>

      {/* Builder */}
      <div className="max-w-[1200px] mx-auto px-5 py-8 pb-12 w-full">
        <div className="grid gap-8 grid-cols-1 lg:grid-cols-[1fr_340px]">
          {/* Left: Your Ranking */}
          <div>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-[17px] font-bold text-ink">Your Ranking</h2>
                <p className="text-[12px] text-muted mt-0.5">Click albums from the pool to add them. Click × to remove.</p>
              </div>
              <span className="text-[12px] text-muted flex-shrink-0">{filledCount}/10</span>
            </div>

            <div className="flex flex-col gap-2">
              {myRanking.map((slot, i) => (
                <motion.div
                  key={`slot-${i}`}
                  layout
                  className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                    slot ? 'border-divider bg-white' : 'border-dashed border-subtle bg-surface'
                  }`}
                >
                  <span className={`text-[16px] font-extrabold w-7 text-center flex-shrink-0 ${
                    i < 3 ? 'text-ink' : 'text-muted'
                  }`}>
                    {i + 1}
                  </span>

                  {slot ? (
                    <>
                      <div className={`w-10 h-10 rounded-lg ${slot.color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-ink truncate">{slot.title}</p>
                        <p className="text-[11px] text-muted">{slot.artist} · {slot.year}</p>
                      </div>
                      <button
                        onClick={() => removeFromRanking(i)}
                        className="text-[11px] text-subtle hover:text-red-500 transition px-1 flex-shrink-0"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="text-[12px] text-subtle">Drop album here</span>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-5">
              <button
                disabled={filledCount < 3}
                className={`rounded-xl px-6 py-2.5 text-[13px] font-bold transition ${
                  filledCount >= 3
                    ? 'bg-ink text-white hover:opacity-80'
                    : 'bg-surface text-subtle border border-divider cursor-not-allowed'
                }`}
              >
                Save Ranking
              </button>
              <button
                onClick={clearRanking}
                className="rounded-xl px-6 py-2.5 text-[13px] font-semibold text-muted border border-divider hover:bg-surface transition"
              >
                Clear
              </button>
            </div>
            {filledCount < 3 && (
              <p className="text-[11px] text-muted mt-2">Rank at least 3 albums to save.</p>
            )}
          </div>

          {/* Right: Album Pool */}
          <div>
            <h2 className="text-[17px] font-bold text-ink mb-3">Album Pool</h2>

            {/* Search */}
            <div className="bg-surface border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2 mb-4">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="Search albums"
                className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
              />
            </div>

            <p className="text-[11px] text-muted mb-3">
              {filteredPool.length} albums · Your list contributes to the community ranking.
            </p>

            <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1 scrollbar-hide">
              {filteredPool.map(album => {
                const isUsed = myRanking.some(s => s?.id === album.id);
                return (
                  <button
                    key={album.id}
                    onClick={() => !isUsed && addToRanking(album)}
                    disabled={isUsed}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition w-full ${
                      isUsed
                        ? 'border-divider bg-surface opacity-50 cursor-not-allowed'
                        : 'border-divider bg-white hover:border-mid hover:shadow-sm'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg ${album.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-ink truncate">{album.title}</p>
                      <p className="text-[11px] text-muted">{album.artist} · {album.year}</p>
                    </div>
                    <span className="text-[11px] font-bold text-mint-dark bg-mint-bg px-1.5 py-0.5 rounded flex-shrink-0">
                      ★ {album.avgRating.toFixed(1)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Community Ranking Preview */}
      <div className="border-t border-divider">
        <div className="max-w-[1200px] mx-auto px-5 py-10 pb-16 w-full">
          <h2 className="text-[17px] font-bold text-ink mb-1">Current Community Top 10</h2>
          <p className="text-[12px] text-muted mb-6">This ranking is still forming.</p>

          <div className="flex flex-col gap-2">
            {communityTop10.map((item, i) => (
              <motion.div
                key={item.rank}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.03 }}
                className="flex items-center gap-3 md:gap-4 rounded-xl border border-divider p-3 bg-white"
              >
                <span className={`text-[16px] font-extrabold w-7 text-center flex-shrink-0 ${
                  i < 3 ? 'text-ink' : 'text-muted'
                }`}>
                  {item.rank}
                </span>
                <div className={`w-10 h-10 rounded-lg ${item.color} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-ink truncate">{item.title}</p>
                  <p className="text-[11px] text-muted">{item.artist} · {item.year}</p>
                </div>
                <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                  <span className="text-[13px] font-bold text-ink tabular-nums">{item.score}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                    item.movement === 'New' ? 'bg-mint-bg text-mint-dark' :
                    item.movement.startsWith('↑') ? 'text-green-600' :
                    item.movement.startsWith('↓') ? 'text-red-500' :
                    'text-muted'
                  }`}>
                    {item.movement}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
