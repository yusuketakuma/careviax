import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeHttpHandler } from '@smithy/node-http-handler';

import {
  DEFAULT_AWS_CLIENT_MAX_ATTEMPTS,
  DEFAULT_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  MAX_AWS_CLIENT_MAX_ATTEMPTS,
  MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  awsClientConfig,
  awsClientRequestTimeoutMs,
  withAwsClientTimeout,
} from './client-timeout';

describe('AWS client timeout helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('wraps AWS send calls with a bounded AbortSignal', async () => {
    const send = vi.fn(async (_command: unknown, options?: { abortSignal?: AbortSignal }) => ({
      signal: options?.abortSignal,
    }));
    const client = withAwsClientTimeout({ send }, 1234);

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
    const client = withAwsClientTimeout({ send }, 1234);

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
    const client = withAwsClientTimeout({ send }, 1234);

    await expect(
      client.send({ command: 'GetItem' }, { abortSignal: callerController.signal }),
    ).resolves.toEqual({ signal: callerController.signal });
  });

  it('normalizes timeout and max attempt environment overrides', () => {
    expect(awsClientRequestTimeoutMs()).toBe(DEFAULT_AWS_CLIENT_REQUEST_TIMEOUT_MS);
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', String(MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS + 1));
    expect(awsClientRequestTimeoutMs()).toBe(MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS);

    expect(awsClientConfig()).toMatchObject({ maxAttempts: DEFAULT_AWS_CLIENT_MAX_ATTEMPTS });
    vi.stubEnv('PHOS_AWS_CLIENT_MAX_ATTEMPTS', String(MAX_AWS_CLIENT_MAX_ATTEMPTS + 1));
    expect(awsClientConfig()).toMatchObject({ maxAttempts: MAX_AWS_CLIENT_MAX_ATTEMPTS });
  });

  it('configures a Node HTTP handler with bounded connection and request timeouts', async () => {
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', '4000');
    vi.stubEnv('PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS', '900');

    const config = awsClientConfig();
    expect(config.requestHandler).toBeInstanceOf(NodeHttpHandler);

    const handlerConfig = await (
      config.requestHandler as unknown as {
        configProvider: Promise<{ connectionTimeout: number; requestTimeout: number }>;
      }
    ).configProvider;
    expect(handlerConfig.connectionTimeout).toBe(900);
    expect(handlerConfig.requestTimeout).toBe(4000);
  });

  it('keeps connection timeout no longer than the request timeout', async () => {
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', '700');
    vi.stubEnv('PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS', '2000');

    const config = awsClientConfig();
    const handlerConfig = await (
      config.requestHandler as unknown as {
        configProvider: Promise<{ connectionTimeout: number; requestTimeout: number }>;
      }
    ).configProvider;
    expect(handlerConfig.connectionTimeout).toBe(700);
    expect(handlerConfig.requestTimeout).toBe(700);
  });
});
