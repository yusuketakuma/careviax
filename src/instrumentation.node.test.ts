import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assertProductionEnvSafetyMock, assertRuntimeTimezoneMock, bootstrapSecretsForStartupMock } =
  vi.hoisted(() => ({
    assertProductionEnvSafetyMock: vi.fn(),
    assertRuntimeTimezoneMock: vi.fn(),
    bootstrapSecretsForStartupMock: vi.fn(),
  }));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/config/secrets', () => ({
  bootstrapSecretsForStartup: bootstrapSecretsForStartupMock,
}));

vi.mock('@/lib/env/assert-env', () => ({
  assertProductionEnvSafety: assertProductionEnvSafetyMock,
  assertRuntimeTimezone: assertRuntimeTimezoneMock,
}));

vi.mock('../sentry.server.config', () => ({}));

import { registerNodeInstrumentation } from './instrumentation.node';

describe('registerNodeInstrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertRuntimeTimezoneMock.mockReturnValue({
      ok: true,
      expected: 'Asia/Tokyo',
      resolvedName: 'Asia/Tokyo',
      offsetMinutes: -540,
    });
  });

  it('awaits secret readiness before evaluating production safety consumers', async () => {
    let resolveBootstrap: (() => void) | undefined;
    bootstrapSecretsForStartupMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    const registration = registerNodeInstrumentation();
    await Promise.resolve();

    expect(bootstrapSecretsForStartupMock).toHaveBeenCalledOnce();
    expect(assertProductionEnvSafetyMock).not.toHaveBeenCalled();

    resolveBootstrap?.();
    await registration;

    expect(assertProductionEnvSafetyMock).toHaveBeenCalledOnce();
    expect(assertRuntimeTimezoneMock).toHaveBeenCalledOnce();
  });

  it('fails closed without evaluating later startup checks when bootstrap rejects', async () => {
    bootstrapSecretsForStartupMock.mockRejectedValue(new Error('startup secret failure'));

    await expect(registerNodeInstrumentation()).rejects.toThrow('startup secret failure');
    expect(assertProductionEnvSafetyMock).not.toHaveBeenCalled();
    expect(assertRuntimeTimezoneMock).not.toHaveBeenCalled();
  });
});
