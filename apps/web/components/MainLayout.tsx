'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import SiteHeader from './SiteHeader';
import Sidebar from './Sidebar';
import Footer from './Footer';
import { PlaylistProvider } from './PlaylistContext';
import { StreamingPlatformProvider } from './StreamingPlatformContext';
import PlaylistPanel from './PlaylistPanel';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const isOnboarding = pathname === '/onboarding';

  useEffect(() => {
    if (!isOnboarding && window.innerWidth >= 1280) setSidebarOpen(true);
  }, [isOnboarding]);

  return (
    <StreamingPlatformProvider>
      <PlaylistProvider>
        <div className="flex flex-col min-h-screen">
          <SiteHeader
            onMenuClick={isOnboarding ? undefined : () => setSidebarOpen((o) => !o)}
            isOnboarding={isOnboarding}
          />
          <div className="flex flex-1 min-h-0">
            {!isOnboarding && <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />}
            <div className="flex-1 flex flex-col min-w-0">
              <main className="flex-1">{children}</main>
              {!isOnboarding && <Footer />}
            </div>
            {!isOnboarding && <PlaylistPanel />}
          </div>
        </div>
      </PlaylistProvider>
    </StreamingPlatformProvider>
  );
}
