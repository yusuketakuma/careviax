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
 * Secret name convention: ph-os/{env}/app-secrets
 *   e.g. ph-os/production/app-secrets
 *        ph-os/staging/app-secrets
 *
 * Activation (SAFETY): Secrets Manager is consulted ONLY when it is actually
 * configured. When it is NOT configured the helpers return values straight from
 * `process.env`, so behavior is byte-identical to a pure env-based setup (local
 * dev + tests). See `isSecretsManagerConfigured()` for the activation rules.
 */

import { readJsonObject } from '@/lib/db/json';
import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';

import { APP_ENV } from './app-env';

type SecretsManagerModule = {
  SecretsManagerClient: new (args: { region: string; maxAttempts?: number }) => {
    send(
      command: unknown,
      options?: { abortSignal?: AbortSignal },
    ): Promise<{ SecretString?: string }>;
  };
  GetSecretValueCommand: new (args: { SecretId: string }) => unknown;
};

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

const REQUIRED_SECRET_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'ENCRYPTION_KEY',
  'JWT_SIGNING_SECRET',
  'JOB_API_KEY',
] as const satisfies readonly (keyof AppSecrets)[];

function readRequiredSecretString(
  record: Record<string, unknown>,
  key: keyof AppSecrets,
  sourceLabel: string,
) {
  const value = record[key];
  if (typeof value === 'string' && value.trim() !== '') return value;
  throw new Error(`${sourceLabel} is missing required string keys: ${key}`);
}

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

let cachedSecrets: AppSecrets | null = null;
let cachePopulatedAt: number | null = null;
let cachedSecretsSource: string | null = null;
let cachedSecretsManagerModule: Promise<SecretsManagerModule | null> | null = null;
const secretsManagerClients = new Map<
  string,
  InstanceType<SecretsManagerModule['SecretsManagerClient']>
>();

/** Re-fetch secrets after this many milliseconds (12 hours). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Secret name
// ---------------------------------------------------------------------------

function isExplicitlyTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * Whether AWS Secrets Manager should be consulted for this process.
 *
 * SAFETY (guardrail): when this returns `false`, every helper resolves secrets
 * directly from `process.env`, so the runtime is identical to a pure env setup.
 *
 * Activation precedence:
 *   1. `SECRETS_MANAGER_DISABLED` truthy  → always OFF (explicit kill switch).
 *   2. `SECRETS_MANAGER_ENABLED`  truthy  → ON.
 *   3. A secret id/ARN override is present (`SECRETS_MANAGER_SECRET_ID` /
 *      `SECRETS_MANAGER_SECRET_ARN`)      → ON.
 *   4. Otherwise fall back to the legacy environment rule: any non-development
 *      `APP_ENV` (staging / production) consults Secrets Manager.
 *
 * Local development and the test suite leave all `SECRETS_MANAGER_*` env unset
 * and run with `APP_ENV=development`, so they never touch Secrets Manager.
 */
export function isSecretsManagerConfigured(): boolean {
  if (isExplicitlyTrue(process.env.SECRETS_MANAGER_DISABLED)) return false;
  if (isExplicitlyTrue(process.env.SECRETS_MANAGER_ENABLED)) return true;
  if (
    typeof process.env.SECRETS_MANAGER_SECRET_ID === 'string' &&
    process.env.SECRETS_MANAGER_SECRET_ID.trim() !== ''
  ) {
    return true;
  }
  if (
    typeof process.env.SECRETS_MANAGER_SECRET_ARN === 'string' &&
    process.env.SECRETS_MANAGER_SECRET_ARN.trim() !== ''
  ) {
    return true;
  }
  // Legacy behavior preserved for backward compatibility: non-development
  // deployments consult Secrets Manager unless explicitly disabled above.
  return APP_ENV !== 'development';
}

function secretName(): string {
  const explicit =
    process.env.SECRETS_MANAGER_SECRET_ID?.trim() || process.env.SECRETS_MANAGER_SECRET_ARN?.trim();
  if (explicit) return explicit;
  return `ph-os/${APP_ENV}/app-secrets`;
}

function secretCacheSource() {
  return `${process.env.AWS_REGION ?? 'ap-northeast-1'}:${secretName()}`;
}

export function parseAppSecrets(raw: string, sourceLabel = `Secret "${secretName()}"`): AppSecrets {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${sourceLabel} is not valid JSON`);
  }

  const record = readJsonObject(parsed);
  if (!record) {
    throw new Error(`${sourceLabel} must be a JSON object`);
  }

  const missing = REQUIRED_SECRET_KEYS.filter((key) => {
    const value = record[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(`${sourceLabel} is missing required string keys: ${missing.join(', ')}`);
  }

  return {
    DATABASE_URL: readRequiredSecretString(record, 'DATABASE_URL', sourceLabel),
    NEXTAUTH_SECRET: readRequiredSecretString(record, 'NEXTAUTH_SECRET', sourceLabel),
    ENCRYPTION_KEY: readRequiredSecretString(record, 'ENCRYPTION_KEY', sourceLabel),
    JWT_SIGNING_SECRET: readRequiredSecretString(record, 'JWT_SIGNING_SECRET', sourceLabel),
    JOB_API_KEY: readRequiredSecretString(record, 'JOB_API_KEY', sourceLabel),
  };
}

function getSafeSecretsErrorName(error: unknown) {
  if (error instanceof Error) return 'Error';
  if (error === undefined) return undefined;
  return typeof error;
}

function logSecretsManagerFallback(error: unknown) {
  console.warn('[secrets] Falling back to environment variables after Secrets Manager failure', {
    event: 'secrets_manager_fetch_failed',
    operation: 'fallback_to_env',
    error_name: getSafeSecretsErrorName(error),
  });
}

function logSecretsBootstrapFailure(error: unknown) {
  console.warn('[secrets] bootstrapSecretsIntoEnv failed; continuing with environment values', {
    event: 'secrets_bootstrap_failed',
    operation: 'continue_with_env',
    error_name: getSafeSecretsErrorName(error),
  });
}

// ---------------------------------------------------------------------------
// Fetch from Secrets Manager
// ---------------------------------------------------------------------------

async function fetchFromSecretsManager(): Promise<AppSecrets> {
  const secretsManagerModule = await loadSecretsManagerModule();
  if (!secretsManagerModule) {
    throw new Error('SECRETS_MANAGER_SDK_UNAVAILABLE');
  }

  const client = getSecretsManagerClient(
    secretsManagerModule,
    process.env.AWS_REGION ?? 'ap-northeast-1',
  );

  const response = await client.send(
    new secretsManagerModule.GetSecretValueCommand({ SecretId: secretName() }),
  );

  const raw = response.SecretString;
  if (!raw) {
    throw new Error(`Secret "${secretName()}" has no SecretString value`);
  }

  return parseAppSecrets(raw, `Secret "${secretName()}"`);
}

function getSecretsManagerClient(secretsManagerModule: SecretsManagerModule, region: string) {
  const cached = secretsManagerClients.get(region);
  if (cached) return cached;

  const client = withAwsClientTimeout(
    new secretsManagerModule.SecretsManagerClient({ region, ...awsClientConfig() }),
  );
  secretsManagerClients.set(region, client);
  return client;
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

async function loadSecretsManagerModule(): Promise<SecretsManagerModule | null> {
  if (!cachedSecretsManagerModule) {
    cachedSecretsManagerModule = (async () => {
      try {
        const loaded = await import('@aws-sdk/client-secrets-manager');

        if (
          loaded &&
          typeof loaded === 'object' &&
          'SecretsManagerClient' in loaded &&
          'GetSecretValueCommand' in loaded
        ) {
          return loaded as SecretsManagerModule;
        }
      } catch {
        return null;
      }

      return null;
    })();
  }

  return cachedSecretsManagerModule;
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
  // SAFETY: when Secrets Manager is not configured (local dev, tests, or a
  // deployment that has not opted in), resolve straight from process.env so
  // behavior is byte-identical to a pure env setup.
  if (!isSecretsManagerConfigured()) {
    return fromEnv();
  }

  const now = Date.now();
  const source = secretCacheSource();
  if (
    cachedSecrets &&
    cachePopulatedAt &&
    cachedSecretsSource === source &&
    now - cachePopulatedAt < CACHE_TTL_MS
  ) {
    return cachedSecrets;
  }

  try {
    cachedSecrets = await fetchFromSecretsManager();
  } catch (error) {
    logSecretsManagerFallback(error);
    cachedSecrets = fromEnv();
  }
  cachePopulatedAt = now;
  cachedSecretsSource = source;
  return cachedSecrets;
}

/**
 * Convenience helper — fetches secrets then returns a single value.
 * Prefer `getSecrets()` when you need multiple keys to avoid redundant calls.
 */
export async function getSecret<K extends keyof AppSecrets>(key: K): Promise<AppSecrets[K]> {
  const secrets = await getSecrets();
  return secrets[key];
}

let bootstrapPromise: Promise<void> | null = null;

/**
 * Populates `process.env` from Secrets Manager once per process.
 *
 * This is the bridge for synchronous consumers (NextAuth `secret`, the Prisma
 * connection string, the Edge proxy job-API-key check) that read secrets from
 * `process.env` at module-evaluation time and cannot await an async fetch.
 *
 * SAFETY (guardrails):
 *  - When Secrets Manager is not configured this is a no-op — `process.env`
 *    stays exactly as provided by the environment.
 *  - `process.env` remains the source of truth: a value already present in the
 *    environment is NEVER overwritten, so explicit env always wins.
 *  - Secret values are never logged or interpolated into messages.
 *  - Resolves once and caches the in-flight promise; safe to call repeatedly.
 *  - Never throws — a failed fetch leaves `process.env` untouched.
 */
export async function bootstrapSecretsIntoEnv(): Promise<void> {
  if (!isSecretsManagerConfigured()) return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const secrets = await getSecrets();
      for (const key of REQUIRED_SECRET_KEYS) {
        const value = secrets[key];
        // Source-of-truth rule: only fill keys the environment did not provide.
        if (
          typeof value === 'string' &&
          value !== '' &&
          (process.env[key] === undefined || process.env[key] === '')
        ) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      // Never block startup on Secrets Manager; env remains authoritative.
      logSecretsBootstrapFailure(error);
    }
  })();

  return bootstrapPromise;
}

/**
 * Clears the in-process secret cache.
 * Useful after a detected rotation event or in tests.
 */
export function clearSecretsCache(): void {
  cachedSecrets = null;
  cachePopulatedAt = null;
  cachedSecretsSource = null;
  bootstrapPromise = null;
}
