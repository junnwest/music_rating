/**
 * The flower mark rendered as a tintable glyph (CSS mask = SwiftUI's
 * `.renderingMode(.template)`). Color via text color classes: `text-accent`.
 */
export default function FlowerGlyph({
  size = 12,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: 'url(/logo-flower.svg)',
        maskImage: 'url(/logo-flower.svg)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
