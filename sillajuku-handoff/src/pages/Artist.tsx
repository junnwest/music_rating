import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getArtistById, getAlbumsByArtist } from '@/data';
import { Cover } from '@/components/Cover';

export default function Artist() {
  const { id } = useParams<{ id: string }>();
  const artist = getArtistById(id || '');
  const discography = getAlbumsByArtist(id || '');

  if (!artist) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-ink">Artist not found</h1>
        <Link to="/" className="text-muted hover:text-ink mt-4 inline-block">← Back to home</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Artist Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-10 flex gap-6 md:gap-9 items-center">
          <div className="w-[80px] h-[80px] md:w-[96px] md:h-[96px] rounded-full border-2 border-mint flex-shrink-0 overflow-hidden">
            <Cover gradient={artist.avatarGradient} className="w-full h-full" />
          </div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <p className="text-[12px] font-semibold text-muted uppercase mb-1" style={{ letterSpacing: '0.6px' }}>Artist</p>
            <h1 className="text-[28px] md:text-[32px] font-extrabold text-ink tracking-tight">{artist.name}</h1>
            <p className="text-[13px] text-muted mt-1">{artist.genres.join(' · ')}</p>
            <div className="flex gap-6 mt-4">
              <div>
                <div className="text-[16px] font-bold text-ink">{artist.followers}</div>
                <div className="text-[11px] text-muted">followers</div>
              </div>
              <div>
                <div className="text-[16px] font-bold text-ink">{artist.releases}</div>
                <div className="text-[11px] text-muted">releases</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Discography */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14 w-full">
        <h2 className="text-[17px] font-bold text-ink mb-5">Discography</h2>
        <div className="grid gap-x-[18px] gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {discography.map(album => (
            <Link key={album.id} to={`/album/${album.id}`} className="block min-w-0 group">
              <div className="relative w-full rounded-[7px] overflow-hidden aspect-square">
                <Cover gradient={album.coverGradient} className="w-full h-full group-hover:scale-105 transition-transform duration-300" />
                <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="bg-ink text-white rounded-md px-[11px] py-[5px] text-[11px] font-semibold">Rate →</span>
                </div>
              </div>
              <div className="mt-[9px]">
                <div className="text-[13px] font-semibold text-ink truncate leading-snug group-hover:text-mid transition-colors">{album.title}</div>
                <div className="text-[12px] text-muted mt-0.5 truncate">{album.artist}</div>
                <div className="text-[11px] text-muted mt-0.5">{album.year}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
