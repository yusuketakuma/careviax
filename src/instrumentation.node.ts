import * as Sentry from '@sentry/nextjs';
import { bootstrapSecretsForStartup } from '@/lib/config/secrets';
import { assertProductionEnvSafety, assertRuntimeTimezone } from '@/lib/env/assert-env';

/** Node-only startup work that must finish before Next.js accepts requests. */
export async function registerNodeInstrumentation() {
  await bootstrapSecretsForStartup();
  assertProductionEnvSafety();
  await import('../sentry.server.config');

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
