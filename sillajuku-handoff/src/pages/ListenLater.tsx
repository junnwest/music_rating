import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useListenLater } from '@/hooks/useListenLater';
import { albums } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';
import { BookmarkPlus } from 'lucide-react';

export default function ListenLater() {
  const { ids, remove } = useListenLater();

  const savedAlbums = ids
    .map(id => albums.find(a => a.id === id))
    .filter(Boolean);

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-10 md:py-12">
          <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight leading-[1.05]">Listen Later</h1>
          <p className="text-[14px] text-muted mt-2">Albums you've saved to check out later.</p>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-5 py-8 pb-16 w-full">
        {savedAlbums.length > 0 ? (
          <>
            <p className="text-[13px] text-muted mb-5">{savedAlbums.length} albums saved</p>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {savedAlbums.map((album, i) => (
                <motion.div
                  key={album!.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  className="relative group"
                >
                  <AlbumCard album={album!} size="md" showYear />
                  <button
                    onClick={() => remove(album!.id)}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white border border-divider flex items-center justify-center text-[11px] text-muted hover:text-red-500 hover:border-red-300 transition opacity-0 group-hover:opacity-100 shadow-sm"
                    title="Remove"
                  >
                    ×
                  </button>
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookmarkPlus size={36} className="text-subtle mb-3" />
            <p className="text-[15px] font-semibold text-ink">No albums saved yet</p>
            <p className="text-[13px] text-muted mt-1 max-w-[300px]">
              Browse albums and click "Listen Later" to save them here.
            </p>
            <Link to="/" className="mt-4 text-[13px] font-semibold text-ink border border-divider rounded-lg px-5 py-2 hover:bg-surface transition">
              Discover albums
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
