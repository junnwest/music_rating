import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { recentRatings, genreRows, getAlbumById } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } }
};

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* Personalized Feed */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 w-full">
        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <h1 className="text-[28px] font-extrabold text-ink tracking-tight">Good evening, Kenneth</h1>
          <p className="text-[14px] text-muted mt-1">Here's what matches your taste.</p>
        </motion.div>

        {/* Recently rated row */}
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <p className="text-[15px] font-bold text-ink">Your recent ratings</p>
              <p className="text-[12px] text-muted mt-0.5">Keep going — build out your catalog</p>
            </div>
          </div>
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="flex gap-4 overflow-x-auto scrollbar-hide pb-1"
          >
            {recentRatings.map(({ albumId, rating }) => {
              const album = getAlbumById(albumId);
              if (!album) return null;
              return (
                <motion.div key={albumId} variants={item} className="flex-shrink-0">
                  <Link to={`/album/${albumId}`} className="block group">
                    <div className="w-[140px] h-[140px] rounded-lg mb-2 relative overflow-hidden">
                      <Cover gradient={album.coverGradient} className="w-full h-full group-hover:scale-105 transition-transform duration-300" />
                      <span className="absolute bottom-2 left-2 text-[10px] font-semibold bg-white/90 text-ink px-[6px] py-[2px] rounded">
                        ★ {rating.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-[12px] font-semibold text-ink truncate w-[140px]">{album.title}</p>
                    <p className="text-[11px] text-muted truncate w-[140px]">{album.artist}</p>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Because you liked ... */}
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <p className="text-[15px] font-bold text-ink">
                Because you rated <span className="text-mint-dark">Broken Mirror</span> highly
              </p>
              <p className="text-[12px] text-muted mt-0.5">K-R&B · Similar sound</p>
            </div>
            <Link to="/genre/K-R%26B" className="text-[12px] text-muted hover:text-ink transition whitespace-nowrap">See all →</Link>
          </div>
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="flex gap-4 overflow-x-auto scrollbar-hide pb-1"
          >
            {['society', '24hours', 'gravity', 'everything', 'still-life', 'when', 'daydream', 'bliss']
              .map(id => getAlbumById(id))
              .filter(Boolean)
              .map(album => (
                <motion.div key={album!.id} variants={item} className="flex-shrink-0">
                  <AlbumCard album={album!} size="sm" />
                </motion.div>
              ))}
          </motion.div>
        </div>
      </div>

      {/* Recommendation Grid — genre rows */}
      <div className="border-t border-divider bg-surface">
        <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16 flex flex-col gap-10 w-full">
          {genreRows.map((row) => (
            <div key={row.genre}>
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <p className="text-[16px] font-bold text-ink">{row.genre}</p>
                  <p className="text-[12px] text-muted mt-0.5">{row.description}</p>
                </div>
                <Link to={`/genre/${encodeURIComponent(row.genre)}`} className="text-[12px] text-muted hover:text-ink transition">See all →</Link>
              </div>
              <motion.div
                variants={container}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                className="flex gap-4 overflow-x-auto scrollbar-hide pb-2"
              >
                {row.albumIds.map(id => {
                  const album = getAlbumById(id);
                  if (!album) return null;
                  return (
                    <motion.div key={id} variants={item} className="flex-shrink-0">
                      <Link to={`/album/${id}`} className="block group">
                        <div className="w-[148px] h-[148px] rounded-lg mb-2 overflow-hidden">
                          <Cover gradient={album.coverGradient} className="w-full h-full group-hover:scale-105 transition-transform duration-300" />
                        </div>
                        <p className="text-[12px] font-semibold text-ink truncate w-[148px] group-hover:text-mid transition-colors">{album.title}</p>
                        <p className="text-[11px] text-muted truncate w-[148px]">{album.artist}</p>
                      </Link>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
