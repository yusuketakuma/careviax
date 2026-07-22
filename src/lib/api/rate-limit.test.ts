import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
  RATE_LIMIT_FEATURE_MUTATION_MAX_DEFAULT,
  RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT,
  SSE_MAX_CONNECTIONS,
  acquireSseConnection,
  checkExternalAccessOtpLockout,
  checkFeatureRateLimit,
  createRateLimiter,
  enforceFeatureRateLimit,
  releaseSseConnection,
  recordExternalAccessOtpFailure,
} from './rate-limit';
import {
  EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST,
  OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST,
  resetRateLimitTestState,
} from './rate-limit.test-helpers';

describe('rate-limit', () => {
  beforeEach(resetRateLimitTestState);

  it('blocks requests after the configured max count', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter('ip-1')).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('hard locks the domain-separated external access token digest on the tenth mismatch', async () => {
    for (let attempt = 1; attempt < EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES; attempt += 1) {
      await expect(
        recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
      ).resolves.toEqual({
        available: true,
        locked: false,
        attempts: attempt,
      });
    }

    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES - 1,
    });
    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
    });
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
    });
    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES + 1,
    });
    await expect(
      checkExternalAccessOtpLockout(OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: 0,
    });
  });

  it('linearizes concurrent external access OTP mismatch increments', async () => {
    const results = await Promise.all(
      Array.from({ length: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES }, () =>
        recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
      ),
    );

    expect(
      results
        .map((result) => result.attempts)
        .filter((attempts): attempts is number => attempts !== null)
        .sort((left, right) => left - right),
    ).toEqual(
      Array.from({ length: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES }, (_, index) => index + 1),
    );
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: true,
      attempts: EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
    });
  });

  it('does not extend durable OTP lockout expiry when the counter is inspected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));

    await expect(
      recordExternalAccessOtpFailure(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toMatchObject({ attempts: 1 });
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: 1,
    });
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: 0,
    });
    vi.useRealTimers();
  });

  it('fails closed without allocating a counter for a non-digest lockout identifier', async () => {
    await expect(checkExternalAccessOtpLockout('raw-token')).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    });
    await expect(recordExternalAccessOtpFailure('raw-token')).resolves.toEqual({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    });
    await expect(
      checkExternalAccessOtpLockout(EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST),
    ).resolves.toEqual({
      available: true,
      locked: false,
      attempts: 0,
    });
  });

  it('caps active SSE connections per identifier and releases capacity', () => {
    for (let index = 1; index <= SSE_MAX_CONNECTIONS; index += 1) {
      expect(acquireSseConnection('user:1')).toEqual({ allowed: true, count: index });
    }

    expect(acquireSseConnection('user:1')).toEqual({
      allowed: false,
      count: SSE_MAX_CONNECTIONS,
    });
    expect(acquireSseConnection('user:2')).toEqual({ allowed: true, count: 1 });

    releaseSseConnection('user:1');
    expect(acquireSseConnection('user:1')).toEqual({
      allowed: true,
      count: SSE_MAX_CONNECTIONS,
    });

    for (let index = 0; index <= SSE_MAX_CONNECTIONS + 1; index += 1) {
      releaseSseConnection('user:1');
    }
    expect(acquireSseConnection('user:1')).toEqual({ allowed: true, count: 1 });
  });

  describe('checkFeatureRateLimit / enforceFeatureRateLimit', () => {
    it('allows requests under the default search budget and blocks past it', async () => {
      const identifier = 'org_1:user_1';
      for (let index = 1; index <= RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT; index += 1) {
        await expect(
          checkFeatureRateLimit(identifier, '/api/prescription-intakes', 'search'),
        ).resolves.toMatchObject({ allowed: true });
      }

      await expect(
        checkFeatureRateLimit(identifier, '/api/prescription-intakes', 'search'),
      ).resolves.toMatchObject({ allowed: false, reason: 'quota_exceeded' });
    });

    it('allows requests under the default mutation budget and blocks past it', async () => {
      const identifier = 'org_1:user_1';
      for (let index = 1; index <= RATE_LIMIT_FEATURE_MUTATION_MAX_DEFAULT; index += 1) {
        await expect(
          checkFeatureRateLimit(identifier, '/api/prescription-intakes', 'mutation'),
        ).resolves.toMatchObject({ allowed: true });
      }

      await expect(
        checkFeatureRateLimit(identifier, '/api/prescription-intakes', 'mutation'),
      ).resolves.toMatchObject({ allowed: false, reason: 'quota_exceeded' });
    });

    it('scopes search and mutation budgets independently per route+identifier', async () => {
      const identifier = 'org_1:user_1';
      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'search'),
      ).resolves.toMatchObject({
        allowed: true,
        remaining: RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT - 1,
      });
      // Different route -> independent bucket, unaffected by the /api/patients count above.
      await expect(
        checkFeatureRateLimit(identifier, '/api/prescription-intakes', 'search'),
      ).resolves.toMatchObject({
        allowed: true,
        remaining: RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT - 1,
      });
      // Different identifier (different org/user) -> also independent.
      await expect(
        checkFeatureRateLimit('org_2:user_2', '/api/patients', 'search'),
      ).resolves.toMatchObject({
        allowed: true,
        remaining: RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT - 1,
      });
    });

    it('honors RATE_LIMIT_FEATURE_SEARCH_MAX / RATE_LIMIT_FEATURE_MUTATION_MAX overrides', async () => {
      process.env.RATE_LIMIT_FEATURE_SEARCH_MAX = '2';
      process.env.RATE_LIMIT_FEATURE_MUTATION_MAX = '1';
      const identifier = 'org_1:user_1';

      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'search'),
      ).resolves.toMatchObject({ allowed: true, remaining: 1 });
      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'search'),
      ).resolves.toMatchObject({ allowed: true, remaining: 0 });
      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'search'),
      ).resolves.toMatchObject({ allowed: false });

      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'mutation'),
      ).resolves.toMatchObject({ allowed: true, remaining: 0 });
      await expect(
        checkFeatureRateLimit(identifier, '/api/patients', 'mutation'),
      ).resolves.toMatchObject({ allowed: false });
    });

    it('ignores malformed override env values and falls back to the default', async () => {
      process.env.RATE_LIMIT_FEATURE_SEARCH_MAX = 'not-a-number';

      await expect(
        checkFeatureRateLimit('org_1:user_1', '/api/patients', 'search'),
      ).resolves.toMatchObject({
        allowed: true,
        remaining: RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT - 1,
      });
    });

    it('bypasses the limiter entirely when RATE_LIMIT_FEATURE_DISABLED is set', async () => {
      process.env.RATE_LIMIT_FEATURE_SEARCH_MAX = '1';
      process.env.RATE_LIMIT_FEATURE_DISABLED = '1';
      const identifier = 'org_1:user_1';

      for (let index = 0; index < 5; index += 1) {
        await expect(
          checkFeatureRateLimit(identifier, '/api/patients', 'search'),
        ).resolves.toMatchObject({ allowed: true });
      }
    });

    it('enforceFeatureRateLimit returns null when allowed', async () => {
      await expect(
        enforceFeatureRateLimit('org_1:user_1', '/api/patients', 'search'),
      ).resolves.toBeNull();
    });

    it('enforceFeatureRateLimit returns a 429 with Retry-After and a Japanese message when exceeded', async () => {
      process.env.RATE_LIMIT_FEATURE_SEARCH_MAX = '1';
      const identifier = 'org_1:user_1';

      await expect(
        enforceFeatureRateLimit(identifier, '/api/patients', 'search'),
      ).resolves.toBeNull();

      const response = await enforceFeatureRateLimit(identifier, '/api/patients', 'search');
      expect(response).not.toBeNull();
      expect(response?.status).toBe(429);
      expect(response?.headers.get('Retry-After')).toMatch(/^\d+$/);
      const body = (await response?.json()) as { code: string; message: string };
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.message).toMatch(/[ぁ-んァ-ン一-龯]/);
    });
  });
});
