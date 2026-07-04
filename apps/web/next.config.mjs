import { withSentryConfig } from '@sentry/nextjs';

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
      "img-src 'self' data: https://i.scdn.co https://*.scdn.co https://*.supabase.co https://coverartarchive.org https://archive.org https://lh3.googleusercontent.com https://*.mzstatic.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://app.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
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
      { source: '/rankings', destination: '/leaderboard', permanent: true },
      { source: '/rankings/build', destination: '/leaderboard/build', permanent: true },
      { source: '/rankings/build/rank', destination: '/leaderboard/build', permanent: true },
      { source: '/rankings/:slug/rank', destination: '/leaderboard/:slug/rank', permanent: true },
      { source: '/rankings/:slug', destination: '/leaderboard/:slug', permanent: true },
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
      { protocol: 'https', hostname: '*.mzstatic.com' },
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
