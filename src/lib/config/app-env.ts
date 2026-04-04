/**
 * APP_ENV distinguishes deployment contexts beyond NODE_ENV.
 *
 *   development  — local dev (default when APP_ENV is unset)
 *   staging      — pre-production review environment
 *   production   — live system
 *
 * Use this instead of NODE_ENV for feature flags and service URLs,
 * because Next.js always runs with NODE_ENV=production in all deployments.
 */
export type AppEnv = 'development' | 'staging' | 'production';

export const APP_ENV: AppEnv = (() => {
  const raw = process.env.APP_ENV ?? process.env.NEXT_PUBLIC_APP_ENV;
  if (raw === 'staging') return 'staging';
  if (raw === 'production') return 'production';
  return 'development';
})();

export const isProduction = APP_ENV === 'production';
export const isStaging = APP_ENV === 'staging';
export const isDevelopment = APP_ENV === 'development';

/** Throw verbose errors only in non-production environments. */
export const isDebug = !isProduction;

/**
 * Return a value that differs per environment.
 * Use for service URLs, log levels, feature flags, etc.
 */
export function perEnv<T>(values: { development: T; staging: T; production: T }): T {
  return values[APP_ENV];
}
