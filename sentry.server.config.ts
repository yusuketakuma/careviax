import * as Sentry from '@sentry/nextjs';
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from './src/lib/observability/sentry-redaction';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.APP_ENV ?? 'production',

  tracesSampleRate: process.env.APP_ENV === 'production' ? 0.1 : 1.0,

  // Do not send events in test/CI environments
  enabled: process.env.NODE_ENV === 'production',

  beforeSend(event) {
    const sanitizedEvent = sanitizeSentryEvent(event);

    // Redact sensitive fields from server-side events
    if (sanitizedEvent.request?.cookies) {
      sanitizedEvent.request.cookies = {};
    }
    if (sanitizedEvent.request?.data) {
      sanitizedEvent.request.data = '[REDACTED]';
    }
    if (sanitizedEvent.request?.headers) {
      const allowed = ['content-type', 'x-request-id', 'x-trace-id', 'user-agent'];
      const headers: Record<string, string> = {};
      for (const key of allowed) {
        const value = (sanitizedEvent.request.headers as Record<string, string>)[key];
        if (value) headers[key] = value;
      }
      sanitizedEvent.request.headers = headers;
    }
    return sanitizedEvent;
  },

  beforeBreadcrumb(breadcrumb) {
    return sanitizeSentryBreadcrumb(breadcrumb);
  },
});
