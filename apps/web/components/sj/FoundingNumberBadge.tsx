/**
 * Founding badge for the first 500 members (claim_founding_badge, migration
 * 20260926000003) — web sibling of iOS FoundingNumberBadge: an orange square,
 * rocket on top, three-digit member number underneath.
 */
export default function FoundingNumberBadge({ number, size = 20 }: { number: number; size?: number }) {
  const digits = String(number).padStart(3, '0');
  return (
    <span
      role="img"
      aria-label={`Founding member #${digits}`}
      title={`Founding member #${digits}`}
      className="inline-flex flex-col items-center justify-center shrink-0 text-white"
      style={{ width: size, height: size, borderRadius: size * 0.2, background: '#CF7A45', padding: size * 0.08 }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ height: size * 0.44 }} aria-hidden>
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" />
        <path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />
      </svg>
      <span className="font-black tabular-nums leading-none" style={{ fontSize: size * 0.3 }}>
        {digits}
      </span>
    </span>
  );
}
