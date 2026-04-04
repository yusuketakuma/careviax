import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',

  // Performance monitoring — capture 10% of transactions in production
  tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === 'production' ? 0.1 : 1.0,

  // Session replays — only on errors in production
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: process.env.NEXT_PUBLIC_APP_ENV === 'production' ? 0.05 : 0,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text content and block all media for PHI compliance
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Do not send events in test/CI environments
  enabled: process.env.NODE_ENV === 'production',

  beforeSend(event) {
    // Strip any URL query parameters that might contain PHI
    if (event.request?.url) {
      try {
        const url = new URL(event.request.url);
        url.search = '';
        event.request.url = url.toString();
      } catch {
        // ignore invalid URLs
      }
    }
    return event;
  },
});
