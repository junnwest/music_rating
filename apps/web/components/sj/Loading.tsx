import FlowerGlyph from './FlowerGlyph';

/**
 * The app's shared loading vocabulary. Two things live here:
 *
 * - `FlowerSpinner` / `PageLoader` — the branded indeterminate spinner, for the
 *   rare case where nothing about the final layout is known yet.
 * - `Skeleton*` primitives — the preferred treatment. A skeleton that matches
 *   the shape of what's coming reads as "almost there" instead of "stalled", and
 *   it stops the layout from jumping when data lands.
 *
 * Everything animates via `animate-pulse` / `animate-spin` with the
 * `motion-reduce:` variant, so `prefers-reduced-motion` gets a static
 * placeholder rather than a throbbing one.
 */

/** Rotating flower mark — the branded indeterminate spinner. */
export function FlowerSpinner({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-flex animate-spin motion-reduce:animate-none ${className}`}
      style={{ animationDuration: '1.6s' }}
    >
      <FlowerGlyph src="/icon-flower.svg" size={size} className="text-accent opacity-80" />
    </span>
  );
}

/** Centred spinner for a whole page/panel with no known layout to mimic. */
export function PageLoader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-20 ${className}`}>
      <FlowerSpinner size={30} />
    </div>
  );
}

/** Base shimmer block — every skeleton primitive below is a shape on top of it. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`bg-divider/50 animate-pulse motion-reduce:animate-none ${className}`}
      style={style}
    />
  );
}

/**
 * A line of fake text. `w` is any Tailwind width class so callers can stagger
 * line lengths and avoid the "perfect rectangle" look.
 */
export function SkeletonLine({
  w = 'w-full',
  h = 'h-3',
  className = '',
}: {
  w?: string;
  h?: string;
  className?: string;
}) {
  return <Skeleton className={`rounded ${h} ${w} ${className}`} />;
}

/** A generic filled area (chart, banner, panel). */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <Skeleton className={`rounded-2xl bg-surface ${className}`} />;
}

/** Square album-art placeholder, matching `Cover`'s rounding. */
export function SkeletonCover({ className = '' }: { className?: string }) {
  return <Skeleton className={`aspect-square w-full rounded-xl bg-surface ${className}`} />;
}

/** Cover + two text lines — the repeating unit of every album grid/list. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <SkeletonCover />
      <SkeletonLine w="w-3/4" />
      <SkeletonLine w="w-1/2" h="h-2.5" />
    </div>
  );
}

/** `count` skeleton cards in the app's standard album grid. */
export function SkeletonCardGrid({
  count = 6,
  className = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Thumbnail + two lines, repeated — the standard vertical list placeholder. */
export function SkeletonRows({
  count = 5,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-lg bg-surface" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine w="w-2/5" />
            <SkeletonLine w="w-1/4" h="h-2.5" />
          </div>
        </div>
      ))}
    </div>
  );
}
