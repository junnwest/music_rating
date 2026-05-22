import { Link, useNavigate } from 'react-router-dom';
import { Search, Menu, User, Bookmark, BarChart3, Bell, Settings, LogOut, HelpCircle } from 'lucide-react';
import { useState, useRef, useEffect, type FormEvent } from 'react';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const menuItems = [
    { icon: User, label: 'Profile', path: '/profile/kenneth' },
    { icon: Bookmark, label: 'Listen Later', path: '/listen-later' },
    { icon: BarChart3, label: 'Wrapped', path: '/wrapped' },
    { icon: Bell, label: 'Notifications', path: '/notifications', badge: 4 },
    { icon: Settings, label: 'Settings', path: '/settings' },
    { icon: HelpCircle, label: 'Help', path: '/help' },
  ];

  return (
    <header className="bg-white border-b border-divider sticky top-0 z-50">
      <div className="w-full px-5 flex items-center justify-between h-[72px]">
        {/* Left: hamburger (mobile) + logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            className="xl:hidden p-1 -ml-1 text-ink hover:text-mid transition"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <Link to="/" className="flex items-center">
            <img
              src="/logo.png"
              alt="sillajuku"
              className="h-[44px] w-auto object-contain"
            />
          </Link>
        </div>

        {/* Center: Search form - hidden on mobile */}
        <form
          onSubmit={handleSubmit}
          className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-full max-w-[560px] px-4"
        >
          <div className="bg-surface border border-divider rounded-full px-4 py-2 flex items-center gap-2 w-full hover:border-mid transition">
            <Search size={15} className="text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search albums, artists…"
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder"
            />
          </div>
        </form>

        {/* Right: search (mobile) + profile dropdown */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            to="/search"
            className="md:hidden p-1 text-muted hover:text-ink transition"
            aria-label="Search"
          >
            <Search size={20} />
          </Link>

          {/* Profile dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`w-[34px] h-[34px] rounded-full bg-mint-bg border-2 flex items-center justify-center font-bold text-[12px] transition ${
                dropdownOpen ? 'border-ink' : 'border-mint hover:scale-105'
              } text-mint-dark relative`}
            >
              K
              {/* Unread dot */}
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
            </button>

            {/* Dropdown menu */}
            {dropdownOpen && (
              <div className="absolute right-0 top-[42px] w-[200px] bg-white border border-divider rounded-xl shadow-lg py-2 z-50">
                <div className="px-3 py-2 border-b border-divider mb-1">
                  <p className="text-[13px] font-bold text-ink">Kenneth</p>
                  <p className="text-[11px] text-muted">@kenneth</p>
                </div>

                {menuItems.map(({ icon: Icon, label, path, badge }) => (
                  <Link
                    key={label}
                    to={path}
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-ink hover:bg-surface transition"
                  >
                    <Icon size={16} strokeWidth={1.8} className="text-muted" />
                    <span className="flex-1">{label}</span>
                    {badge !== undefined && badge > 0 && (
                      <span className="w-4.5 h-4.5 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {badge}
                      </span>
                    )}
                  </Link>
                ))}

                <div className="border-t border-divider mt-1 pt-1">
                  <button
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 text-[13px] text-muted hover:text-red-500 hover:bg-surface w-full text-left transition"
                  >
                    <LogOut size={16} strokeWidth={1.8} />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
