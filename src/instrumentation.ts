import * as Sentry from '@sentry/nextjs';
import { assertProductionEnvSafety } from '@/lib/env/assert-env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    assertProductionEnvSafety();
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
