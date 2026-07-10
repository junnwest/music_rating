import { withSentryConfig } from '@sentry/nextjs';

// Mock mode (.env.mock) points NEXT_PUBLIC_SUPABASE_URL at http://localhost:54321;
// that origin must be in connect-src or the browser blocks every query.
// Production uses https://…supabase.co, so this stays empty there.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const localSupabase = supabaseUrl.startsWith('http://localhost') ? ` ${supabaseUrl}` : '';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline'",
      // NB: CAA covers redirect coverartarchive.org → archive.org/download →
      // ia…/dn….archive.org — the wildcard is required or browsers block the
      // final hop and covers never render.
      "img-src 'self' data: https://i.scdn.co https://*.scdn.co https://*.supabase.co https://coverartarchive.org https://archive.org https://*.archive.org https://lh3.googleusercontent.com https://*.mzstatic.com https://*.dzcdn.net",
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localSupabase} https://us.i.posthog.com https://us-assets.i.posthog.com https://app.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  webpack: (config) => {
    config.cache = false;
    return config;
  },
  async redirects() {
    return [
      { source: '/@:username', destination: '/profile/:username', permanent: true },
      // Legacy IA (pre-reconstruction, 2026-07) → current surfaces
      { source: '/rankings/:path*', destination: '/charts', permanent: false },
      { source: '/leaderboard/:path*', destination: '/charts', permanent: false },
      { source: '/my-rankings/:path*', destination: '/profile', permanent: false },
      { source: '/activity', destination: '/', permanent: false },
      { source: '/explore/:path*', destination: '/search', permanent: false },
      { source: '/friends', destination: '/search', permanent: false },
      { source: '/listen-later', destination: '/profile', permanent: false },
      { source: '/collection/:id', destination: '/profile', permanent: false },
      { source: '/genre/:key', destination: '/charts', permanent: false },
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '*.scdn.co' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'coverartarchive.org' },
      { protocol: 'https', hostname: 'archive.org' },
      { protocol: 'https', hostname: '*.archive.org' },
      { protocol: 'https', hostname: '*.mzstatic.com' },
      { protocol: 'https', hostname: '*.dzcdn.net' },
    ],
  },
};

// Wrapped with Sentry for source-map upload + error monitoring. Build-time upload
// only runs when SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN are set; harmless no-op otherwise.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
