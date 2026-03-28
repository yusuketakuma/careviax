const store = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  return (identifier: string): { allowed: boolean; remaining: number; resetAt: Date } => {
    const now = Date.now();
    const entry = store.get(identifier);
    if (!entry || now > entry.resetAt) {
      store.set(identifier, { count: 1, resetAt: now + opts.windowMs });
      return {
        allowed: true,
        remaining: opts.maxRequests - 1,
        resetAt: new Date(now + opts.windowMs),
      };
    }
    entry.count++;
    const remaining = Math.max(0, opts.maxRequests - entry.count);
    return {
      allowed: entry.count <= opts.maxRequests,
      remaining,
      resetAt: new Date(entry.resetAt),
    };
  };
}

// Default rate limiter used by proxy middleware
const defaultLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });

/**
 * Check rate limit for a given identifier and pathname.
 * Returns numeric resetAt (epoch ms) for compatibility with proxy.ts.
 */
export function checkRateLimit(
  identifier: string,
  pathname: string,
): { allowed: boolean; remaining: number; resetAt: number } {
  const result = defaultLimiter(`${identifier}:${pathname}`);
  return { allowed: result.allowed, remaining: result.remaining, resetAt: result.resetAt.getTime() };
}

export function resetRateLimitStoreForTests() {
  store.clear();
}
