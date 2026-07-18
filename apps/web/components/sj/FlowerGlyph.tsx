/**
 * The flower mark rendered as a tintable glyph (CSS mask = SwiftUI's
 * `.renderingMode(.template)`). Color via text color classes: `text-accent`.
 */
export default function FlowerGlyph({
  size = 12,
  className = '',
  src = '/logo-flower.svg',
}: {
  size?: number;
  className?: string;
  /** Mask source. `/logo-flower.svg` is the halftone brand logo;
   *  `/icon-flower.svg` is the clean rounded flower used for rating marks. */
  src?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
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
