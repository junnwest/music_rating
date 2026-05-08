import Link from 'next/link';

export default function Footer({ className }: { className?: string }) {
  const year = new Date().getFullYear();

  return (
    <footer className={`border-t border-divider bg-white mt-auto${className ? ` ${className}` : ''}`}>
      <div className="max-w-[1440px] mx-auto px-5 py-10">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">

          {/* Brand */}
          <div className="flex-shrink-0">
            <img src="/logo-bnw.svg" alt="sillajuku" className="h-[40px] w-auto mb-3" />
            <p className="text-[12px] text-muted">Rate, discover, remember.</p>
            <p className="text-[11px] text-placeholder mt-3">
              Music data powered by{' '}
              <a
                href="https://spotify.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-muted transition"
              >
                Spotify
              </a>
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">Navigate</p>
              <div className="flex flex-col gap-2">
                <Link href="/" className="text-[13px] text-muted hover:text-ink transition">Home</Link>
                <Link href="/activity" className="text-[13px] text-muted hover:text-ink transition">Activity</Link>
                <Link href="/lists" className="text-[13px] text-muted hover:text-ink transition">For You</Link>
                <Link href="/wrapped" className="text-[13px] text-muted hover:text-ink transition">Wrapped</Link>
                <Link href="/help" className="text-[13px] text-muted hover:text-ink transition">Help & Feedback</Link>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">Legal</p>
              <div className="flex flex-col gap-2">
                <Link href="/privacy" className="text-[13px] text-muted hover:text-ink transition">Privacy Policy</Link>
                <Link href="/terms" className="text-[13px] text-muted hover:text-ink transition">Terms of Service</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-divider mt-8 pt-6">
          <p className="text-[11px] text-placeholder">© {year} sillajuku. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
