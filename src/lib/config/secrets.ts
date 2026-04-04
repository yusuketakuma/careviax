/**
 * AWS Secrets Manager helper.
 *
 * Fetches application secrets from Secrets Manager in staging/production.
 * Falls back to environment variables for local development so no AWS
 * credentials are required when running `pnpm dev`.
 *
 * Secrets are cached in-process after the first successful fetch to avoid
 * repeated API calls within a single Lambda/container lifecycle.
 *
 * Secret layout expected in Secrets Manager (JSON string value):
 * {
 *   "DATABASE_URL": "postgresql://...",
 *   "NEXTAUTH_SECRET": "...",
 *   "ENCRYPTION_KEY": "...",
 *   "JWT_SIGNING_SECRET": "...",
 *   "JOB_API_KEY": "..."
 * }
 *
 * Secret name convention: careviax/{env}/app-secrets
 *   e.g. careviax/production/app-secrets
 *        careviax/staging/app-secrets
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { APP_ENV } from './app-env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppSecrets {
  DATABASE_URL: string;
  NEXTAUTH_SECRET: string;
  ENCRYPTION_KEY: string;
  JWT_SIGNING_SECRET: string;
  JOB_API_KEY: string;
}

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

let cachedSecrets: AppSecrets | null = null;
let cachePopulatedAt: number | null = null;

/** Re-fetch secrets after this many milliseconds (12 hours). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Secret name
// ---------------------------------------------------------------------------

function secretName(): string {
  return `careviax/${APP_ENV}/app-secrets`;
}

// ---------------------------------------------------------------------------
// Fetch from Secrets Manager
// ---------------------------------------------------------------------------

async function fetchFromSecretsManager(): Promise<AppSecrets> {
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
  });

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName() }),
  );

  const raw = response.SecretString;
  if (!raw) {
    throw new Error(`Secret "${secretName()}" has no SecretString value`);
  }

  const parsed = JSON.parse(raw) as Partial<AppSecrets>;

  const required: (keyof AppSecrets)[] = [
    'DATABASE_URL',
    'NEXTAUTH_SECRET',
    'ENCRYPTION_KEY',
    'JWT_SIGNING_SECRET',
    'JOB_API_KEY',
  ];

  const missing = required.filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(
      `Secret "${secretName()}" is missing required keys: ${missing.join(', ')}`,
    );
  }

  return parsed as AppSecrets;
}

// ---------------------------------------------------------------------------
// Environment variable fallback (local development)
// ---------------------------------------------------------------------------

function fromEnv(): AppSecrets {
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? '',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '',
    JWT_SIGNING_SECRET: process.env.JWT_SIGNING_SECRET ?? '',
    JOB_API_KEY: process.env.JOB_API_KEY ?? '',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns application secrets.
 *
 * - In `development`: reads directly from environment variables (no AWS call).
 * - In `staging` / `production`: fetches from Secrets Manager on first call,
 *   then returns cached values until the TTL expires.
 */
export async function getSecrets(): Promise<AppSecrets> {
  if (APP_ENV === 'development') {
    return fromEnv();
  }

  const now = Date.now();
  if (
    cachedSecrets &&
    cachePopulatedAt &&
    now - cachePopulatedAt < CACHE_TTL_MS
  ) {
    return cachedSecrets;
  }

  cachedSecrets = await fetchFromSecretsManager();
  cachePopulatedAt = now;
  return cachedSecrets;
}

/**
 * Convenience helper — fetches secrets then returns a single value.
 * Prefer `getSecrets()` when you need multiple keys to avoid redundant calls.
 */
export async function getSecret<K extends keyof AppSecrets>(
  key: K,
): Promise<AppSecrets[K]> {
  const secrets = await getSecrets();
  return secrets[key];
}

/**
 * Clears the in-process secret cache.
 * Useful after a detected rotation event or in tests.
 */
export function clearSecretsCache(): void {
  cachedSecrets = null;
  cachePopulatedAt = null;
}
