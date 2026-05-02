import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getAlbumsByGenre, albums } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';

export default function Genre() {
  const { id } = useParams<{ id: string }>();
  const genre = decodeURIComponent(id || '');
  const genreAlbums = getAlbumsByGenre(genre);

  // Fallback: if no exact match, try partial
  const displayAlbums = genreAlbums.length > 0 ? genreAlbums : albums.filter(a =>
    a.genres.some(g => g.toLowerCase().includes(genre.toLowerCase()))
  );

  return (
    <div className="flex-1">
      {/* Genre Header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <Link to="/" className="text-[12px] text-muted hover:text-ink transition mb-3 inline-block">← Home</Link>
          <h1 className="text-[24px] md:text-[28px] font-extrabold text-ink mt-2 tracking-tight">{genre}</h1>
          <p className="text-[13px] text-muted mt-1">
            {genre.includes('K-') ? 'Korean ' : ''}{genre.replace('K-', '').replace('City Pop', 'city pop and Japanese pop classics')} — from the community catalog.
          </p>
          <p className="text-[12px] text-muted mt-2">{displayAlbums.length} albums</p>
        </div>
      </div>

      {/* Album Grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-16 w-full">
        <div className="grid gap-x-[18px] gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {displayAlbums.map((album, i) => (
            <motion.div
              key={album.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
            >
              <AlbumCard album={album} size="lg" showYear />
            </motion.div>
          ))}
        </div>
        {displayAlbums.length === 0 && (
          <p className="text-[14px] text-muted text-center py-12">No albums found in this genre yet.</p>
        )}
      </div>
    </div>
  );
}
