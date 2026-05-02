interface StarRatingProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onRate?: (rating: number) => void;
}

export function StarRating({ rating, size = 'md', interactive = false, onRate }: StarRatingProps) {
  const sizeMap = { sm: 16, md: 24, lg: 32 };
  const starSize = sizeMap[size];

  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: fullStars }).map((_, i) => (
        <button
          key={`f${i}`}
          type="button"
          onClick={() => interactive && onRate?.(i + 1)}
          className={interactive ? 'cursor-pointer hover:scale-110 transition-transform' : ''}
          style={{ fontSize: starSize, color: '#3DFFD1', lineHeight: 1 }}
        >
          ★
        </button>
      ))}
      {hasHalf && (
        <span style={{ fontSize: starSize, color: '#3DFFD1', lineHeight: 1 }}>★</span>
      )}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <button
          key={`e${i}`}
          type="button"
          onClick={() => interactive && onRate?.(fullStars + (hasHalf ? 1 : 0) + i + 1)}
          className={interactive ? 'cursor-pointer hover:scale-110 transition-transform' : ''}
          style={{ fontSize: starSize, color: '#EBEBEB', lineHeight: 1 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}
