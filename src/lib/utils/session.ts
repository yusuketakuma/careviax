/**
 * Session timeout utilities for client-side timeout warning.
 * Server-side session maxAge is configured in src/lib/auth/config.ts (30 minutes).
 */

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_WARNING_BEFORE_MS = 5 * 60 * 1000; // warn 5 minutes before expiry

/**
 * Returns the number of milliseconds until the session warning should appear,
 * given the session's last activity timestamp.
 */
export function msUntilSessionWarning(lastActivityAt: number): number {
  const elapsed = Date.now() - lastActivityAt;
  const remaining = SESSION_TIMEOUT_MS - elapsed;
  return Math.max(0, remaining - SESSION_WARNING_BEFORE_MS);
}

/**
 * Returns the number of milliseconds until the session expires,
 * given the session's last activity timestamp.
 */
export function msUntilSessionExpiry(lastActivityAt: number): number {
  const elapsed = Date.now() - lastActivityAt;
  return Math.max(0, SESSION_TIMEOUT_MS - elapsed);
}

/**
 * Returns true if the session has expired based on the last activity timestamp.
 */
export function isSessionExpired(lastActivityAt: number): boolean {
  return Date.now() - lastActivityAt >= SESSION_TIMEOUT_MS;
}
