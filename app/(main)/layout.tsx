import type { ReactNode } from 'react';
import SiteHeader from '../../components/SiteHeader';
import Footer from '../../components/Footer';

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
