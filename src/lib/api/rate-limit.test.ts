import { beforeEach, describe, expect, it } from 'vitest';

import {
  checkRateLimit,
  createRateLimiter,
  resetRateLimitStoreForTests,
} from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it('blocks requests after the configured max count', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    expect(limiter('ip-1')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter('ip-1')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter('ip-1')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('scopes the default limiter by pathname as well as identifier', () => {
    // Use POST (write budget = 60) so the limit is reached within the loop.
    for (let index = 0; index < 60; index += 1) {
      expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST').allowed).toBe(true);
    }

    // 61st write request exceeds the write budget
    expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST').allowed).toBe(false);
    // Different pathname has its own independent bucket
    expect(checkRateLimit('203.0.113.10', '/api/visit-schedules', 'POST').allowed).toBe(true);
  });
});
