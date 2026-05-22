import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookmarkPlus, BookmarkCheck } from 'lucide-react';
import { getAlbumById, getReviewsForAlbum, albums } from '@/data';
import { useListenLater } from '@/hooks/useListenLater';
import { Cover } from '@/components/Cover';
import { StarRating } from '@/components/StarRating';
import { AlbumCard } from '@/components/AlbumCard';

export default function AlbumDetail() {
  const { id } = useParams<{ id: string }>();
  const album = getAlbumById(id || '');
  const [reviewText, setReviewText] = useState('');
  const [pinned, setPinned] = useState(false);
  const { toggle: toggleListenLater, has: isSavedForLater } = useListenLater();

  if (!album) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-ink">Album not found</h1>
        <Link to="/" className="text-muted hover:text-ink mt-4 inline-block">← Back to home</Link>
      </div>
    );
  }

  const albumReviews = getReviewsForAlbum(album.id);
  const similarAlbums = albums
    .filter(a => a.genres.some(g => album.genres.includes(g)) && a.id !== album.id)
    .slice(0, 6);

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-10 pb-10 flex flex-col md:flex-row gap-8 md:gap-11">
          {/* Cover */}
          <div className="flex-shrink-0 mx-auto md:mx-0">
            <div className="w-[228px] h-[228px] rounded-[10px] shadow-xl overflow-hidden">
              <Cover gradient={album.coverGradient} className="w-full h-full" />
            </div>
          </div>

          {/* Info */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex-1 pt-1"
          >
            {/* Pills */}
            <div className="flex flex-wrap gap-[7px] mb-[14px]">
              {album.genres.map(g => (
                <Link key={g} to={`/genre/${encodeURIComponent(g)}`} className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted hover:text-ink transition">
                  {g}
                </Link>
              ))}
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted">{album.year}</span>
              <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white border border-divider text-[11px] font-medium text-muted">{album.type}</span>
            </div>

            <h1 className="text-[32px] md:text-[34px] font-extrabold text-ink leading-[1.08] tracking-tight">{album.title}</h1>
            <Link to={`/artist/${album.artistId}`} className="text-[17px] font-medium text-muted mt-2 hover:text-ink transition block">{album.artist}</Link>

            {/* Community stats */}
            <div className="flex gap-5 md:gap-7 mt-5 pt-4 border-t border-divider flex-wrap">
              <div>
                <div className="text-[28px] md:text-[30px] font-extrabold text-ink tracking-tight">{album.avgRating.toFixed(1)}</div>
                <div className="text-[12px] text-muted mt-0.5">avg / 5</div>
              </div>
              <div className="w-px bg-divider my-1" />
              <div>
                <div className="text-[16px] md:text-[18px] font-bold text-ink">{album.ratingCount}</div>
                <div className="text-[12px] text-muted mt-0.5">ratings</div>
              </div>
              <div className="w-px bg-divider my-1" />
              <div>
                <div className="text-[16px] md:text-[18px] font-bold text-ink">{album.reviewCount}</div>
                <div className="text-[12px] text-muted mt-0.5">reviews</div>
              </div>
            </div>

            {/* Your rating */}
            <div className="mt-6">
              <div className="flex items-center gap-1">
                <StarRating rating={album.rating || 0} />
                <span className="text-[13px] font-semibold text-ink ml-2">{(album.rating || 0).toFixed(1)}</span>
              </div>
              {album.review && (
                <div className="mt-3 text-[13px] italic text-muted leading-relaxed">"{album.review}"</div>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                {album.rating && album.rating > 0 && (
                  <button
                    onClick={() => setPinned(!pinned)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition ${
                      pinned
                        ? 'bg-mint text-mint-dark'
                        : 'border border-divider text-muted hover:bg-surface hover:text-ink'
                    }`}
                  >
                    {pinned ? '✓ Added to Pinned Ten' : '+ Add to Pinned Ten'}
                  </button>
                )}
                <button
                  onClick={() => toggleListenLater(album.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition ${
                    isSavedForLater(album.id)
                      ? 'bg-mint text-mint-dark'
                      : 'border border-divider text-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  {isSavedForLater(album.id) ? (
                    <><BookmarkCheck size={13} /> Saved</>
                  ) : (
                    <><BookmarkPlus size={13} /> Listen Later</>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Body: tracklist + reviews */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-14 grid gap-8 md:gap-[52px] md:grid-cols-[1fr_1.3fr] w-full">
        {/* Tracklist */}
        <div>
          <h2 className="text-[17px] font-bold text-ink mb-[18px]">Tracklist</h2>
          {album.tracks ? (
            album.tracks.map((track, i) => (
              <div key={i} className="flex gap-[14px] py-[10px] border-b border-divider items-center group hover:bg-surface/50 transition-colors px-1 -mx-1 rounded">
                <span className="text-[12px] text-subtle w-[22px] text-right flex-shrink-0 tabular-nums">{String(track.number).padStart(2, '0')}</span>
                <span className="text-[14px] font-medium text-ink flex-1 truncate">{track.title}</span>
                <span className="text-[12px] text-muted flex-shrink-0 tabular-nums">{track.duration}</span>
              </div>
            ))
          ) : (
            <p className="text-[14px] text-muted">No tracklist available.</p>
          )}
        </div>

        {/* Reviews */}
        <div>
          <h2 className="text-[17px] font-bold text-ink mb-[18px]">Reviews</h2>

          {/* Write a review */}
          <div className="border border-divider rounded-xl p-4 mb-6 bg-surface">
            <p className="text-[13px] font-semibold text-ink mb-2">Write a review</p>
            <textarea
              rows={3}
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              placeholder="Share your thoughts…"
              className="w-full bg-white border border-divider rounded-lg px-3 py-2.5 text-[13px] text-ink placeholder:text-placeholder outline-none resize-none"
            />
            <div className="flex justify-end mt-2">
              <button className="bg-ink text-white text-[13px] font-bold px-4 py-2 rounded-lg hover:opacity-80 transition">Post</button>
            </div>
          </div>

          {/* Review items */}
          <div className="flex flex-col gap-6">
            {albumReviews.map(review => (
              <div key={review.id} className="border-b border-divider pb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[11px] font-bold text-mint-dark">
                    {review.userInitial}
                  </div>
                  <Link to={`/profile/${review.user}`} className="text-[13px] font-semibold text-ink hover:text-mid transition">{review.user}</Link>
                  <span className="inline-flex items-center text-[10px] font-bold rounded px-[6px] py-[1px] bg-mint text-mint-dark">★ {review.rating.toFixed(1)}</span>
                  <span className="text-[11px] text-muted ml-auto">{review.timeAgo}</span>
                </div>
                <p className="text-[14px] text-mid leading-relaxed italic">"{review.text}"</p>
              </div>
            ))}
            {albumReviews.length === 0 && (
              <p className="text-[14px] text-muted italic">No reviews yet. Be the first to share your thoughts!</p>
            )}
          </div>
        </div>
      </div>

      {/* Similar albums */}
      {similarAlbums.length > 0 && (
        <div className="max-w-[1440px] mx-auto px-5 pb-14 w-full">
          <h2 className="text-[17px] font-bold text-ink mb-5">You might also like</h2>
          <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {similarAlbums.map(a => <AlbumCard key={a.id} album={a} size="md" />)}
          </div>
        </div>
      )}

      {/* Attribution */}
      <div className="max-w-[1440px] mx-auto px-5 pb-8 w-full">
        <p className="text-[11px] text-muted">Data from <span className="underline hover:text-mid cursor-pointer">Spotify</span>.</p>
      </div>
    </div>
  );
}
