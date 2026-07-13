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
  // www, not the bare apex -- sillajuku.com 307-redirects to www.sillajuku.com at the
  // infrastructure level, so the bare apex is never actually where content is served from.
  // Matters beyond cosmetics: Google's sitemap fetcher (unlike a browser) doesn't reliably
  // follow that redirect, which is why the submitted sitemap showed "Couldn't fetch" in Search
  // Console -- confirmed live (apex returns 307, www returns 200 directly, no hop).
  metadataBase: new URL('https://www.sillajuku.com'),
  openGraph: {
    title: 'sillajuku',
    description: 'Every record you\'ve loved.',
    url: 'https://www.sillajuku.com',
    siteName: 'sillajuku',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'sillajuku',
    description: 'Every record you\'ve loved.',
  },
};

// Site-wide Organization markup (not homepage-only) -- this represents the publisher/brand
// itself, not any one page's content, so it's static and cheap to include everywhere. Feeds
// Google's Knowledge Panel. logo must be genuinely transparent, not just visually square --
// Google renders it on its own white UI chrome, and logo-flower.png (unlike app/icon.png, which
// has the App Store icon's cream background baked in) was confirmed via Pillow to have real
// alpha-transparent corners. Sitelinks Searchbox (WebSite + SearchAction) deliberately omitted --
// confirmed via Google's own docs that this was deprecated Nov 2024 and produces no visible
// result anymore.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'sillajuku',
  url: 'https://www.sillajuku.com',
  logo: 'https://www.sillajuku.com/logo-flower.png',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="bg-page text-ink font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, '\\u003c') }}
        />
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
