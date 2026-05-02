import { Link } from 'react-router-dom';
import type { Album } from '@/data';
import { Cover } from './Cover';

interface AlbumCardProps {
  album: Album;
  size?: 'sm' | 'md' | 'lg';
  showYear?: boolean;
  showRating?: boolean;
  className?: string;
}

export function AlbumCard({ album, size = 'md', showYear = false, showRating = false, className = '' }: AlbumCardProps) {
  const sizeClasses = {
    sm: { cover: 'w-[84px] h-[84px] rounded-md', title: 'text-[11px]', artist: 'text-[10px]' },
    md: { cover: 'w-full aspect-square rounded-lg', title: 'text-[13px]', artist: 'text-[12px]' },
    lg: { cover: 'w-full aspect-square rounded-[10px]', title: 'text-[14px]', artist: 'text-[13px]' },
  };

  const s = sizeClasses[size];

  return (
    <Link to={`/album/${album.id}`} className={`block min-w-0 group ${className}`}>
      <div className={`relative ${s.cover} overflow-hidden mb-2`}>
        <Cover gradient={album.coverGradient} className="w-full h-full" />
        {showRating && album.rating && (
          <span className="absolute bottom-2 left-2 text-[10px] font-bold bg-mint text-mint-dark px-[6px] py-[2px] rounded">
            ★ {album.rating.toFixed(1)}
          </span>
        )}
        <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="bg-ink text-white rounded-md px-3 py-[5px] text-[11px] font-semibold">Rate →</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className={`${s.title} font-semibold text-ink truncate leading-snug group-hover:text-mid transition-colors`}>
          {album.title}
        </div>
        <div className={`${s.artist} text-muted mt-0.5 truncate`}>{album.artist}</div>
        {showYear && <div className="text-[11px] text-muted mt-0.5">{album.year}</div>}
      </div>
    </Link>
  );
}
