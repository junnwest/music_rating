import Link from 'next/link';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#EBEBEB] bg-white mt-auto">
      <div className="max-w-[1440px] mx-auto px-5 py-10">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">

          {/* Brand */}
          <div className="flex-shrink-0">
            <Link href="/" className="text-base font-extrabold text-ink" style={{ letterSpacing: '-0.5px' }}>
              音色 <span className="text-mint">neiro</span>
            </Link>
            <p className="text-[12px] text-muted mt-1.5">Rate, discover, remember.</p>
            <p className="text-[11px] text-[#C0C0BE] mt-3">
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

        <div className="border-t border-[#EBEBEB] mt-8 pt-6">
          <p className="text-[11px] text-[#C0C0BE]">© {year} neiro. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
