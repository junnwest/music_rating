/**
 * Oversized, faint halftone flower(s) as page atmosphere — not decoration
 * bolted on, but the same recipe BetaSwipeFlow.tsx already uses for its
 * hero background. Renders the real brand asset unmasked/untinted (the
 * halftone IS the logo — never recolor or flatten it, see memory).
 */
export default function FlowerWatermark({
  variant = 'corners',
}: {
  variant?: 'corners' | 'single-right';
}) {
  if (variant === 'single-right') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -top-24 -right-48 w-[680px] max-w-none opacity-[0.07]"
      />
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -top-40 -right-40 w-[560px] max-w-none opacity-[0.07]"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-flower.svg"
        alt=""
        aria-hidden
        className="pointer-events-none select-none absolute -bottom-32 -left-32 w-[420px] max-w-none opacity-[0.06]"
      />
    </>
  );
}
