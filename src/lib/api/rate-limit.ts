type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

// Default configurations per path prefix
const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  '/api/auth': { windowMs: 15 * 60 * 1000, maxRequests: 100 }, // 認証系: 100req/15min
  '/api/jobs': { windowMs: 60 * 1000, maxRequests: 10 },        // ジョブ: 10req/min
  '/api': { windowMs: 60 * 1000, maxRequests: 300 },             // 一般API: 300req/min
};

// Pre-sorted by prefix length (most specific first) — computed once at module load
const SORTED_CONFIGS = Object.entries(RATE_LIMIT_CONFIGS)
  .sort(([a], [b]) => b.length - a.length);

export function checkRateLimit(
  identifier: string,
  pathname: string
): { allowed: boolean; remaining: number; resetAt: number } {
  const match = SORTED_CONFIGS.find(([prefix]) => pathname.startsWith(prefix));
  const [matchedPrefix, config] = match ?? ['/api', RATE_LIMIT_CONFIGS['/api']];

  const key = `${identifier}:${matchedPrefix}`;
  const now = Date.now();

  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  return {
    allowed: entry.count <= config.maxRequests,
    remaining,
    resetAt: entry.resetAt,
  };
}

// Periodic cleanup of expired entries (every 60s)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
}
