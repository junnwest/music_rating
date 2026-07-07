import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import PostHogProvider from '../components/PostHogProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { LanguageProvider } from '../lib/i18n';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'sillajuku',
  description: 'Every record you\'ve loved.',
  metadataBase: new URL('https://sillajuku.com'),
  openGraph: {
    title: 'sillajuku',
    description: 'Every record you\'ve loved.',
    url: 'https://sillajuku.com',
    siteName: 'sillajuku',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'sillajuku',
    description: 'Every record you\'ve loved.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="bg-page text-ink font-sans">
        <NextTopLoader color="#2979B7" height={2} showSpinner={false} />
        <ThemeProvider>
          <LanguageProvider>
            <PostHogProvider>{children}</PostHogProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
