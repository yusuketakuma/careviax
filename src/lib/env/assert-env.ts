type EnvSource = Record<string, string | undefined>;

const PRODUCTION_VALUES = new Set(['production', 'prod']);
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DANGEROUS_LOCAL_SWITCHES = [
  'ALLOW_LOCAL_AUTH_FALLBACK',
  'ALLOW_LOCAL_DEMO_PASSWORD_LOGIN',
] as const;
const REQUIRED_PRODUCTION_KEYS = ['DATABASE_URL', 'NEXTAUTH_URL'] as const;

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
