import * as Sentry from '@sentry/nextjs';
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from './lib/observability/sentry-redaction';

function stripRequestSearch(urlValue: string): string {
  try {
    const isAbsolute = /^[a-z][a-z\d+\-.]*:/iu.test(urlValue);
    const url = new URL(urlValue, isAbsolute ? undefined : 'https://careviax.local');
    url.search = '';
    return isAbsolute ? url.toString() : `${url.pathname}${url.hash}`;
  } catch {
    return urlValue;
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',

  // Performance monitoring: capture 10% of production transactions.
  tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === 'production' ? 0.1 : 1.0,

  // Session replays: only sample normal sessions lightly in production.
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: process.env.NEXT_PUBLIC_APP_ENV === 'production' ? 0.05 : 0,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text content and block all media for PHI compliance.
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  enabled: process.env.NODE_ENV === 'production',

  beforeSend(event) {
    const sanitizedEvent = sanitizeSentryEvent(event);
    if (sanitizedEvent.request?.url) {
      sanitizedEvent.request.url = stripRequestSearch(sanitizedEvent.request.url);
    }
    return sanitizedEvent;
  },

  beforeBreadcrumb(breadcrumb) {
    return sanitizeSentryBreadcrumb(breadcrumb);
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
