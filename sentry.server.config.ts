import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.APP_ENV ?? 'production',

  tracesSampleRate: process.env.APP_ENV === 'production' ? 0.1 : 1.0,

  // Do not send events in test/CI environments
  enabled: process.env.NODE_ENV === 'production',

  beforeSend(event) {
    // Redact sensitive fields from server-side events
    if (event.request?.cookies) {
      event.request.cookies = {};
    }
    if (event.request?.data) {
      event.request.data = '[REDACTED]';
    }
    if (event.request?.headers) {
      const allowed = ['content-type', 'x-request-id', 'x-trace-id', 'user-agent'];
      const headers: Record<string, string> = {};
      for (const key of allowed) {
        const value = (event.request.headers as Record<string, string>)[key];
        if (value) headers[key] = value;
      }
      event.request.headers = headers;
    }
    return event;
  },
});
