import { describe, expect, it } from 'vitest';
import { assertProductionEnvSafety, isProductionEnv } from './assert-env';

describe('isProductionEnv', () => {
  it('treats APP_ENV, NEXT_PUBLIC_APP_ENV, or NODE_ENV production as production', () => {
    expect(isProductionEnv({ APP_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ NEXT_PUBLIC_APP_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
  });

  it('does not treat development or staging as production', () => {
    expect(isProductionEnv({ APP_ENV: 'development', NODE_ENV: 'test' })).toBe(false);
    expect(isProductionEnv({ APP_ENV: 'staging' })).toBe(false);
  });
});

describe('assertProductionEnvSafety', () => {
  const safeProductionEnv = {
    APP_ENV: 'production',
    DATABASE_URL: 'postgresql://example',
    NEXTAUTH_URL: 'https://ph-os.example',
    NEXTAUTH_SECRET: 'nextauth-secret',
  };

  it('passes for a safe production env', () => {
    expect(() => assertProductionEnvSafety(safeProductionEnv)).not.toThrow();
  });

  it('throws when local auth fallback is enabled in production', () => {
    expect(() =>
      assertProductionEnvSafety({
        ...safeProductionEnv,
        ALLOW_LOCAL_AUTH_FALLBACK: 'true',
      }),
    ).toThrow(/ALLOW_LOCAL_AUTH_FALLBACK/);
  });

  it('throws when local demo password login is enabled in production', () => {
    expect(() =>
      assertProductionEnvSafety({
        ...safeProductionEnv,
        ALLOW_LOCAL_DEMO_PASSWORD_LOGIN: '1',
      }),
    ).toThrow(/ALLOW_LOCAL_DEMO_PASSWORD_LOGIN/);
  });

  it('throws when core production env is missing', () => {
    expect(() =>
      assertProductionEnvSafety({
        APP_ENV: 'production',
      }),
    ).toThrow(/DATABASE_URL.*NEXTAUTH_URL.*NEXTAUTH_SECRET or AUTH_SECRET/);
  });

  it('allows local switches outside production', () => {
    expect(() =>
      assertProductionEnvSafety({
        APP_ENV: 'development',
        ALLOW_LOCAL_AUTH_FALLBACK: 'true',
        ALLOW_LOCAL_DEMO_PASSWORD_LOGIN: '1',
      }),
    ).not.toThrow();
  });
});
