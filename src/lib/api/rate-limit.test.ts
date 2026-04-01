import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRateLimit,
  createRateLimiter,
  resetRateLimitStoreForTests,
} from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
    delete process.env.RATE_LIMIT_DDB_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    vi.restoreAllMocks();
  });

  it('blocks requests after the configured max count', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('scopes the default limiter by pathname as well as identifier', async () => {
    // Use POST (write budget = 60) so the limit is reached within the loop.
    for (let index = 0; index < 60; index += 1) {
      await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
        allowed: true,
      });
    }

    // 61st write request exceeds the write budget
    await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
    });
    // Different pathname has its own independent bucket
    await expect(
      checkRateLimit('203.0.113.10', '/api/visit-schedules', 'POST')
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('uses the DynamoDB store when configured', async () => {
    process.env.RATE_LIMIT_STORE = 'dynamodb';
    process.env.RATE_LIMIT_DDB_TABLE_NAME = 'careviax-rate-limit';
    process.env.RATE_LIMIT_DDB_REGION = 'ap-northeast-1';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-test-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Attributes: {
            hit_count: { N: '61' },
            reset_at: { N: '1710000000000' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await checkRateLimit('user:1', '/api/patients', 'POST');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 1710000000000,
    });
  });
});
