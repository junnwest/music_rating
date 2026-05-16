'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Trophy, Flame, Compass } from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const navItems = [
  { icon: Trophy, label: 'Ranking', path: '/rankings' },
  { icon: Flame, label: 'Feed', path: '/activity' },
  { icon: Compass, label: 'Explore', path: '/explore' },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    // Only auto-close on mobile (sidebar is an overlay there)
    if (window.innerWidth < 1280) onClose();
  }, [pathname]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 xl:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed xl:sticky top-[72px] left-0 h-[calc(100vh-72px)] bg-page z-40 overflow-hidden transition-all duration-300 ease-out ${
          open
            ? 'translate-x-0 w-[72px] border-r border-divider'
            : '-translate-x-full w-[72px] xl:translate-x-0 xl:w-0 xl:border-0'
        }`}
      >
        <div className="w-[72px] h-full flex flex-col items-center pt-4 pb-5">
          <nav className="flex flex-col gap-2 flex-1 w-full px-2">
            {navItems.map(({ icon: Icon, label, path }) => {
              const isActive = pathname === path || (path !== '/' && pathname.startsWith(path));
              return (
                <Link
                  key={label}
                  href={path}
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
        </div>
      </aside>
    </>
  );
}
