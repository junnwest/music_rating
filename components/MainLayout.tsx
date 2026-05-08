'use client';

import { useEffect, useState } from 'react';
import SiteHeader from './SiteHeader';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import Footer from './Footer';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 1280) setSidebarOpen(true);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <SiteHeader onMenuClick={() => setSidebarOpen((o) => !o)} />
      <div className="flex flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom,0px))] xl:pb-0">{children}</main>
          <Footer className="hidden xl:block" />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
