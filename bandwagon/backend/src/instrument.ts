import * as Sentry from '@sentry/node';

export const sentryEnabled = Boolean(process.env.SENTRY_DSN) && process.env.NODE_ENV !== 'test';

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0, // errors only this pass — no perf tracing, no source maps yet
  });
}
