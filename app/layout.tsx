import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import SiteHeader from '../components/SiteHeader';

export const metadata: Metadata = {
  title: 'Bside',
  description: 'Rate, review, and catalog albums with Korean music fans in mind.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-950">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
