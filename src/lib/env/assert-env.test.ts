import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertProductionEnvSafety,
  assertRuntimeTimezone,
  isProductionEnv,
  resolveRuntimeTimezone,
} from './assert-env';

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

describe('resolveRuntimeTimezone', () => {
  it('reports ok when the offset matches JST (UTC+9 => -540 minutes)', () => {
    const status = resolveRuntimeTimezone({ offsetMinutes: -540, resolvedName: 'Asia/Tokyo' });
    expect(status.ok).toBe(true);
    expect(status.expected).toBe('Asia/Tokyo');
    expect(status.offsetMinutes).toBe(-540);
    expect(status.resolvedName).toBe('Asia/Tokyo');
  });

  it('reports not-ok when the offset is UTC (0 minutes)', () => {
    const status = resolveRuntimeTimezone({ offsetMinutes: 0, resolvedName: 'UTC' });
    expect(status.ok).toBe(false);
    expect(status.offsetMinutes).toBe(0);
  });
});

describe('assertRuntimeTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes silently when the runtime is JST', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertRuntimeTimezone(
        { APP_ENV: 'production', ENFORCE_APP_TZ: '1' },
        { offsetMinutes: -540 },
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (non-fatal) on a non-JST runtime when enforcement is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertRuntimeTimezone({ APP_ENV: 'production' }, { offsetMinutes: 0, resolvedName: 'UTC' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/runtime timezone is not Asia\/Tokyo/);
  });

  it('warns but does not throw outside production even with ENFORCE_APP_TZ', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertRuntimeTimezone(
        { APP_ENV: 'development', ENFORCE_APP_TZ: '1' },
        { offsetMinutes: 0, resolvedName: 'UTC' },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fails fast in production when ENFORCE_APP_TZ is enabled and the runtime is not JST', () => {
    expect(() =>
      assertRuntimeTimezone(
        { APP_ENV: 'production', ENFORCE_APP_TZ: '1' },
        { offsetMinutes: 0, resolvedName: 'UTC' },
      ),
    ).toThrow(/Runtime timezone safety check failed.*Asia\/Tokyo/);
  });
});
