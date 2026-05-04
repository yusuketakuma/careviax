const REDACTED = '[REDACTED]';
const REDACTED_PATH_SEGMENT = '[redacted]';
const RELATIVE_URL_BASE = 'https://careviax.local';
// Keys that always carry secret material. We avoid the bare key `token` because
// the codebase also uses non-secret share / link tokens that are safe to log.
const SENSITIVE_KEYS = new Set([
  'otp',
  'x-otp',
  'authorization',
  'cookie',
  // `set-cookie` is a response header; included for breadcrumbs that capture responses.
  'set-cookie',
  'password',
  'token_hash',
  'otp_hash',
  'auth_token',
  'access_token',
  'refresh_token',
  'session_token',
  'session_secret',
  'jwt',
  'recovery_code',
  'recovery_codes',
  'mynumber',
  'mynumber_hash',
  'insurance_number',
  'api_key',
  'x-api-key',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactSharedPathSegments(value: string): string {
  return value
    .replace(/\/shared\/[^/?#\s]+/giu, `/shared/${REDACTED_PATH_SEGMENT}`)
    .replace(
      /\/api\/external-access\/[^/?#\s]+/giu,
      `/api/external-access/${REDACTED_PATH_SEGMENT}`,
    );
}

function redactOtpText(value: string): string {
  return value
    .replace(/("x-otp"\s*:\s*)"[^"]*"/giu, `$1"${REDACTED}"`)
    .replace(/("otp"\s*:\s*)"[^"]*"/giu, `$1"${REDACTED}"`)
    .replace(/(\b(?:x-otp|otp)=)[^&\s]+/giu, `$1${REDACTED}`)
    .replace(/(\b(?:x-otp|otp):\s*)[^\s,}]+/giu, `$1${REDACTED}`);
}

export function redactSharedUrl(value: string): string {
  const trimmed = value.trimStart();
  const isAbsolute = /^[a-z][a-z\d+\-.]*:/iu.test(trimmed);
  const isRootRelative =
    trimmed.startsWith('/') || trimmed.startsWith('?') || trimmed.startsWith('#');

  if (!isAbsolute && !isRootRelative) {
    return redactSharedPathSegments(value).replace(/([?&])otp=[^&#\s]*/giu, `$1otp=${REDACTED}`);
  }

  try {
    const parsed = new URL(value, isAbsolute ? undefined : RELATIVE_URL_BASE);
    parsed.searchParams.delete('otp');
    const serialized = isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;

    return redactSharedPathSegments(serialized);
  } catch {
    return redactSharedPathSegments(value).replace(/([?&])otp=[^&#\s]*/giu, `$1otp=${REDACTED}`);
  }
}

export function redactSensitiveText(value: string): string {
  return redactOtpText(redactSharedUrl(value));
}

export function sanitizeSentryValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return seen.get(value);
    }

    const next: unknown[] = [];
    seen.set(value, next);
    value.forEach((item) => {
      next.push(sanitizeSentryValue(item, seen));
    });
    return next;
  }

  if (!isRecord(value)) {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  const next: Record<string, unknown> = {};
  seen.set(value, next);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      next[key] = REDACTED;
      continue;
    }

    next[key] = sanitizeSentryValue(nestedValue, seen);
  }

  return next;
}

export function sanitizeSentryEvent<T>(event: T): T {
  return sanitizeSentryValue(event) as T;
}

export function sanitizeSentryBreadcrumb<T>(breadcrumb: T): T {
  return sanitizeSentryValue(breadcrumb) as T;
}
