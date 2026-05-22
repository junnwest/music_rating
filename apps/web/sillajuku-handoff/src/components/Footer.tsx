import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="border-t border-divider bg-white mt-auto">
      <div className="max-w-[1440px] mx-auto px-5 py-10">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">
          <div className="flex-shrink-0">
            <Link to="/" className="flex items-center">
              <img src="/logo.png" alt="sillajuku" className="h-[34px] w-auto object-contain" />
            </Link>
            <p className="text-[12px] text-muted mt-1.5">Rate, discover, remember.</p>
            <p className="text-[11px] text-placeholder mt-3">Music data powered by <span className="underline hover:text-muted cursor-pointer">Spotify</span></p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">Navigate</p>
              <div className="flex flex-col gap-2">
                <Link to="/" className="text-[13px] text-muted hover:text-ink transition">Home</Link>
                <Link to="/activity" className="text-[13px] text-muted hover:text-ink transition">Activity</Link>
                <Link to="/lists" className="text-[13px] text-muted hover:text-ink transition">For You</Link>
                <Link to="/wrapped" className="text-[13px] text-muted hover:text-ink transition">Wrapped</Link>
                <Link to="/help" className="text-[13px] text-muted hover:text-ink transition">Help & Feedback</Link>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">Legal</p>
              <div className="flex flex-col gap-2">
                <Link to="/privacy" className="text-[13px] text-muted hover:text-ink transition">Privacy Policy</Link>
                <Link to="/terms" className="text-[13px] text-muted hover:text-ink transition">Terms of Service</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-divider mt-8 pt-6">
          <p className="text-[11px] text-placeholder">© 2026 sillajuku. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
