import { Link, useLocation } from 'react-router-dom';
import { Trophy, Flame, Compass, Users } from 'lucide-react';
import { useEffect } from 'react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const navItems = [
  { icon: Trophy, label: 'Ranking', path: '/rankings' },
  { icon: Flame, label: 'Feed', path: '/activity' },
  { icon: Compass, label: 'Explore', path: '/lists' },
  { icon: Users, label: 'Friends', path: '/friends' },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();

  useEffect(() => {
    onClose();
  }, [location.pathname]);

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 xl:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar - narrow vertical rail */}
      <aside
        className={`fixed xl:sticky top-[72px] left-0 h-[calc(100vh-72px)] w-[72px] bg-white border-r border-divider z-40 flex flex-col items-center pt-4 pb-5 transition-transform duration-300 ease-out xl:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Nav items - square buttons */}
        <nav className="flex flex-col gap-2 flex-1 w-full px-2">
          {navItems.map(({ icon: Icon, label, path }) => {
            const isActive = location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
            return (
              <Link
                key={label}
                to={path}
                className={`flex flex-col items-center justify-center gap-[2px] aspect-square rounded-xl transition ${
                  isActive
                    ? 'bg-mint-bg text-mint-dark'
                    : 'text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="text-[9px] font-semibold leading-tight">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom logo - acts as home */}
        <div className="mt-auto pt-3 border-t border-divider w-full flex justify-center">
          <Link to="/" onClick={onClose} className="p-1">
            <img src="/logo.png" alt="sillajuku" className="h-11 w-auto object-contain" />
          </Link>
        </div>
      </aside>
    </>
  );
}
