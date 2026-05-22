import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { activityFeed, getAlbumById } from '@/data';
import { Cover } from '@/components/Cover';

export default function Activity() {
  return (
    <div className="flex-1">
      {/* Page header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[22px] md:text-[24px] font-extrabold text-ink tracking-tight">Activity</h1>
          <p className="text-[13px] text-muted mt-1">Recent ratings and reviews from the community</p>
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-[720px] mx-auto px-5 py-9 pb-14 w-full">
        <div className="flex flex-col">
          {activityFeed.map((item, i) => {
            const album = getAlbumById(item.albumId);
            if (!album) return null;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="flex gap-4 py-5 border-b border-divider"
              >
                <Link to={`/profile/${item.user}`} className="flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[11px] font-bold text-mint-dark">
                    {item.userInitial}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] leading-snug">
                        <Link to={`/profile/${item.user}`} className="font-semibold text-ink hover:text-mid transition">{item.user}</Link>
                        <span className="text-muted"> {item.type === 'review' ? 'reviewed' : 'rated'} </span>
                        <Link to={`/album/${album.id}`} className="font-semibold text-ink hover:text-mid transition">{album.title}</Link>
                        <span className="inline-flex items-center ml-2 text-[10px] font-bold rounded px-[6px] py-[1px] align-middle bg-mint text-mint-dark">★ {item.rating.toFixed(1)}</span>
                      </p>
                      <p className="text-[12px] text-muted mt-0.5">{album.artist}</p>
                      {item.text && (
                        <p className="text-[13px] text-mid mt-2 leading-relaxed italic">"{item.text}"</p>
                      )}
                      <p className="text-[11px] text-muted mt-1.5">{item.timeAgo}</p>
                    </div>
                    <Link to={`/album/${album.id}`} className="flex-shrink-0">
                      <div className="w-[52px] h-[52px] rounded-[5px] overflow-hidden">
                        <Cover gradient={album.coverGradient} className="w-full h-full" />
                      </div>
                    </Link>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
