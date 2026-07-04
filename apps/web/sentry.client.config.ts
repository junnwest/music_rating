import * as Sentry from '@sentry/nextjs';

// Inert until NEXT_PUBLIC_SENTRY_DSN is set — Sentry.init() no-ops with an empty dsn.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
