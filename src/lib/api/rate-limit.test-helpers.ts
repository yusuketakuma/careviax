import { vi } from 'vitest';

import { resetRateLimitStoreForTests } from './rate-limit';

export const EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST = 'a'.repeat(64);
export const OTHER_EXTERNAL_ACCESS_OTP_LOCKOUT_DIGEST = 'b'.repeat(64);

export function resetRateLimitTestState() {
  resetRateLimitStoreForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.RATE_LIMIT_STORE;
  delete process.env.RATE_LIMIT_DDB_TABLE_NAME;
  delete process.env.RATE_LIMIT_DDB_REGION;
  delete process.env.APP_ENV;
  delete process.env.NEXT_PUBLIC_APP_ENV;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  delete process.env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  delete process.env.RATE_LIMIT_DDB_TIMEOUT_MS;
  delete process.env.RATE_LIMIT_FEATURE_DISABLED;
  delete process.env.RATE_LIMIT_FEATURE_SEARCH_MAX;
  delete process.env.RATE_LIMIT_FEATURE_MUTATION_MAX;
  vi.restoreAllMocks();
}
