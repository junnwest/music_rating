import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import PostHogProvider from '../components/PostHogProvider';
import { ThemeProvider } from '../components/ThemeProvider';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'sillajuku',
  description: 'Rate albums, write reviews, and discover music you\'ll love.',
  metadataBase: new URL('https://sillajuku.com'),
  openGraph: {
    title: 'sillajuku',
    description: 'Rate albums, write reviews, and discover music you\'ll love.',
    url: 'https://sillajuku.com',
    siteName: 'sillajuku',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'sillajuku',
    description: 'Rate albums, write reviews, and discover music you\'ll love.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="bg-page text-ink font-sans">
        <ThemeProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
