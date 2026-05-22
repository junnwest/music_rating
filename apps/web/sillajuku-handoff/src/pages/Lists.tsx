import { motion } from 'framer-motion';
import { forYouAlbumIds, getAlbumById } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';

export default function Lists() {
  const listAlbums = forYouAlbumIds.map(id => getAlbumById(id)).filter(Boolean);

  return (
    <div className="flex-1">
      {/* Page header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[22px] md:text-[24px] font-extrabold text-ink tracking-tight">For You</h1>
          <p className="text-[13px] text-muted mt-1">Albums you might love or already know.</p>
        </div>
      </div>

      {/* Album grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14 w-full">
        <div className="grid gap-x-[18px] gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
          {listAlbums.map((album, i) => (
            <motion.div
              key={album!.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
            >
              <AlbumCard album={album!} size="md" />
            </motion.div>
          ))}
        </div>

        {/* Load more */}
        <div className="flex justify-center mt-10">
          <button className="text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-6 py-2.5 hover:opacity-80 transition">
            Load more
          </button>
        </div>
      </div>
    </div>
  );
}
