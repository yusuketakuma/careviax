import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
  DEFAULT_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
  MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  phosAwsClientConfig,
  phosAwsClientRequestTimeoutMs,
  withPhosAwsClientTimeout,
} from './aws-client-timeout';

describe('PH-OS AWS client timeout helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('wraps AWS send calls with a bounded AbortSignal', async () => {
    const send = vi.fn(async (_command: unknown, options?: { abortSignal?: AbortSignal }) => ({
      signal: options?.abortSignal,
    }));
    const client = withPhosAwsClientTimeout({ send }, 1234);

    await expect(client.send({ command: 'GetItem' })).resolves.toMatchObject({
      signal: expect.any(AbortSignal),
    });
    expect(send).toHaveBeenCalledWith(
      { command: 'GetItem' },
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it('unrefs and clears internally-created timeout timers after AWS send resolves', async () => {
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const abortSignalTimeoutSpy =
      typeof AbortSignal.timeout === 'function' ? vi.spyOn(AbortSignal, 'timeout') : null;
    const send = vi.fn().mockResolvedValue({ ok: true });
    const client = withPhosAwsClientTimeout({ send }, 1234);

    await expect(client.send({ command: 'GetItem' })).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledWith(
      { command: 'GetItem' },
      { abortSignal: expect.any(AbortSignal) },
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
    expect(abortSignalTimeoutSpy).not.toHaveBeenCalled();
  });

  it('preserves caller abort signals when one is provided', async () => {
    const callerController = new AbortController();
    const send = vi.fn(async (_command: unknown, options?: { abortSignal?: AbortSignal }) => ({
      signal: options?.abortSignal,
    }));
    const client = withPhosAwsClientTimeout({ send }, 1234);

    await expect(
      client.send({ command: 'GetItem' }, { abortSignal: callerController.signal }),
    ).resolves.toEqual({ signal: callerController.signal });
  });

  it('normalizes timeout and max attempt environment overrides', () => {
    expect(phosAwsClientRequestTimeoutMs()).toBe(DEFAULT_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS);
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', String(MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS + 1));
    expect(phosAwsClientRequestTimeoutMs()).toBe(MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS);

    expect(phosAwsClientConfig()).toMatchObject({
      maxAttempts: DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
      requestHandler: expect.anything(),
    });
    vi.stubEnv('PHOS_AWS_CLIENT_MAX_ATTEMPTS', String(MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS + 1));
    expect(phosAwsClientConfig()).toMatchObject({
      maxAttempts: MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
      requestHandler: expect.anything(),
    });
  });
});
