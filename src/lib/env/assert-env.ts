type EnvSource = Record<string, string | undefined>;

const PRODUCTION_VALUES = new Set(['production', 'prod']);
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DANGEROUS_LOCAL_SWITCHES = [
  'ALLOW_LOCAL_AUTH_FALLBACK',
  'ALLOW_LOCAL_DEMO_PASSWORD_LOGIN',
] as const;
const REQUIRED_PRODUCTION_KEYS = ['DATABASE_URL', 'NEXTAUTH_URL'] as const;

// Civil-time handling (date keys, @db.Date day boundaries, dispensing/billing
// today/after-hours logic) assumes the runtime process timezone is Japan
// (Asia/Tokyo). See src/lib/utils/date-boundary.ts. Asia/Tokyo is UTC+9 with no
// DST, so the local offset is a stable -540 minutes. getTimezoneOffset() is the
// authoritative signal because process.env.TZ and the Intl resolved name can be
// absent even when the OS clock is correct.
const APP_TIMEZONE = 'Asia/Tokyo';
const APP_TIMEZONE_OFFSET_MINUTES = -540;

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function isPresent(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isTruthy(value: string | undefined): boolean {
  return TRUTHY_VALUES.has(normalize(value));
}

export function isProductionEnv(env: EnvSource): boolean {
  return (
    PRODUCTION_VALUES.has(normalize(env.APP_ENV)) ||
    PRODUCTION_VALUES.has(normalize(env.NEXT_PUBLIC_APP_ENV)) ||
    PRODUCTION_VALUES.has(normalize(env.NODE_ENV))
  );
}

export function assertProductionEnvSafety(env: EnvSource = process.env): void {
  if (!isProductionEnv(env)) return;

  const dangerousEnabled = DANGEROUS_LOCAL_SWITCHES.filter((key) => isTruthy(env[key]));
  const missingRequired: string[] = REQUIRED_PRODUCTION_KEYS.filter((key) => !isPresent(env[key]));
  const hasAuthSecret = isPresent(env.NEXTAUTH_SECRET) || isPresent(env.AUTH_SECRET);

  if (!hasAuthSecret) {
    missingRequired.push('NEXTAUTH_SECRET or AUTH_SECRET');
  }

  const messages = [
    dangerousEnabled.length > 0
      ? `dangerous local switches enabled: ${dangerousEnabled.join(', ')}`
      : null,
    missingRequired.length > 0
      ? `missing required production env: ${missingRequired.join(', ')}`
      : null,
  ].filter((message): message is string => message !== null);

  if (messages.length > 0) {
    throw new Error(`Production environment safety check failed: ${messages.join('; ')}`);
  }
}

export type RuntimeTimezoneStatus = {
  ok: boolean;
  expected: string;
  resolvedName: string;
  offsetMinutes: number;
};

type RuntimeTimezoneProbe = {
  offsetMinutes?: number;
  resolvedName?: string;
};

/**
 * Resolves the runtime timezone status. offsetMinutes/resolvedName can be
 * injected for tests (the test runner's own offset cannot otherwise be varied).
 */
export function resolveRuntimeTimezone(probe: RuntimeTimezoneProbe = {}): RuntimeTimezoneStatus {
  const offsetMinutes = probe.offsetMinutes ?? new Date().getTimezoneOffset();
  let resolvedName = probe.resolvedName;
  if (resolvedName === undefined) {
    try {
      resolvedName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    } catch {
      resolvedName = 'unknown';
    }
  }
  return {
    ok: offsetMinutes === APP_TIMEZONE_OFFSET_MINUTES,
    expected: APP_TIMEZONE,
    resolvedName,
    offsetMinutes,
  };
}

/**
 * Startup guard: the app's civil-time logic assumes the runtime is JST.
 * Non-breaking by default — emits a warning so the misconfiguration is
 * observable without taking down a running deploy. Fails fast only in production
 * AND when ENFORCE_APP_TZ is explicitly enabled (opt-in once prod TZ is set).
 */
export function assertRuntimeTimezone(
  env: EnvSource = process.env,
  probe: RuntimeTimezoneProbe = {},
): RuntimeTimezoneStatus {
  const status = resolveRuntimeTimezone(probe);
  if (status.ok) return status;

  const detail =
    `runtime timezone is not ${APP_TIMEZONE} ` +
    `(resolved="${status.resolvedName}", offsetMinutes=${status.offsetMinutes}, ` +
    `expected ${APP_TIMEZONE_OFFSET_MINUTES}). Civil-time logic (date keys, ` +
    `dispensing/billing day boundaries, after-hours classification) assumes JST; ` +
    `set TZ=${APP_TIMEZONE} on the runtime.`;

  if (isProductionEnv(env) && isTruthy(env.ENFORCE_APP_TZ)) {
    throw new Error(`Runtime timezone safety check failed: ${detail}`);
  }

  // eslint has no no-console rule here; the secrets bootstrap (same startup
  // phase) logs via console too. Keep this non-fatal and observable.
  console.warn(`[env] ${detail}`);
  return status;
}
