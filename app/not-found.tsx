import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-5 text-center">
      <p className="text-[11px] font-semibold text-muted uppercase mb-4" style={{ letterSpacing: '0.7px' }}>
        404
      </p>
      <h1
        className="text-[40px] sm:text-[56px] font-extrabold text-ink leading-[1.04]"
        style={{ letterSpacing: '-1.5px' }}
      >
        Page not found
      </h1>
      <p className="text-[15px] text-muted mt-4 max-w-[360px] leading-relaxed">
        This page doesn&apos;t exist, or the album was removed from Spotify.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-7 py-3 text-[14px] font-semibold hover:opacity-80 transition"
      >
        ← Back to home
      </Link>
    </div>
  );
}
