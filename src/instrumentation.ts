import * as Sentry from '@sentry/nextjs';
import { assertProductionEnvSafety, assertRuntimeTimezone } from '@/lib/env/assert-env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    assertProductionEnvSafety();
    // Civil-time logic (date keys, dispensing/billing day boundaries,
    // after-hours classification) assumes the runtime process is JST. Warn at
    // startup if it is not; fail fast only in production with ENFORCE_APP_TZ.
    assertRuntimeTimezone();
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
