import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { curatedLists, getAlbumById } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';

export default function ListDetail() {
  const { id } = useParams<{ id: string }>();
  const list = curatedLists.find(l => l.id === id);

  if (!list) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-ink">List not found</h1>
        <Link to="/lists" className="text-muted hover:text-ink mt-4 inline-block">← Back to lists</Link>
      </div>
    );
  }

  const listAlbums = list.albumIds.map(id => getAlbumById(id)).filter(Boolean);

  return (
    <div className="flex-1">
      {/* List header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <Link to="/lists" className="text-[12px] text-muted hover:text-ink transition mb-3 inline-block">← Lists</Link>
          <h1 className="text-[22px] md:text-[24px] font-extrabold text-ink tracking-tight">{list.title}</h1>
          <p className="text-[13px] text-muted mt-1">{list.description}</p>
          <div className="flex items-center gap-2 mt-3">
            <div className="w-5 h-5 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[9px] font-bold text-mint-dark">{list.authorInitial}</div>
            <span className="text-[12px] text-muted">{list.author}</span>
            <span className="text-[12px] text-subtle">·</span>
            <span className="text-[12px] text-muted">{list.albumCount} albums</span>
            <span className="text-[12px] text-subtle">·</span>
            <span className="text-[12px] text-muted">Created {list.createdAt}</span>
          </div>
        </div>
      </div>

      {/* Albums grid */}
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
      </div>
    </div>
  );
}
