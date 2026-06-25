import * as Sentry from '@sentry/nextjs';
import { assertProductionEnvSafety, assertRuntimeTimezone } from '@/lib/env/assert-env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    assertProductionEnvSafety();
    await import('../sentry.server.config');
    // Civil-time logic (date keys, dispensing/billing day boundaries,
    // after-hours classification) assumes the runtime process is JST. Warn at
    // startup if it is not; fail fast only in production with ENFORCE_APP_TZ.
    // Run after Sentry is initialized so a non-JST runtime is alertable, not a
    // silent log line (the date-key/billing drift is a billing-correctness risk).
    const tzStatus = assertRuntimeTimezone();
    if (!tzStatus.ok) {
      Sentry.captureMessage(
        `Runtime timezone is not ${tzStatus.expected} ` +
          `(resolved=${tzStatus.resolvedName}, offsetMinutes=${tzStatus.offsetMinutes}). ` +
          `Civil-time/billing day boundaries assume JST.`,
        'warning',
      );
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
