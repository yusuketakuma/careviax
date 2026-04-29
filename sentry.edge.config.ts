import * as Sentry from '@sentry/nextjs';
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from './src/lib/observability/sentry-redaction';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.APP_ENV ?? 'production',
  tracesSampleRate: process.env.APP_ENV === 'production' ? 0.1 : 1.0,
  enabled: process.env.NODE_ENV === 'production',
  beforeSend(event) {
    return sanitizeSentryEvent(event);
  },
  beforeBreadcrumb(breadcrumb) {
    return sanitizeSentryBreadcrumb(breadcrumb);
  },
});
