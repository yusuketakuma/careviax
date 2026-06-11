import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  scriptAwsClientConnectionTimeoutMs,
  scriptAwsClientConfig,
  scriptAwsClientRequestTimeoutMs,
  withScriptAwsClientTimeout,
} from './aws-client';

describe('tools script AWS client helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('clamps retry and timeout settings from environment variables', () => {
    vi.stubEnv('PHOS_AWS_CLIENT_MAX_ATTEMPTS', '99');
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', '999999');

    expect(scriptAwsClientConfig()).toMatchObject({ maxAttempts: 5 });
    expect(scriptAwsClientRequestTimeoutMs()).toBe(30_000);
  });

  it('configures a Node HTTP handler with bounded connection and request timeouts', async () => {
    vi.stubEnv('PHOS_AWS_CLIENT_TIMEOUT_MS', '4000');
    vi.stubEnv('PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS', '900');

    const config = scriptAwsClientConfig();
    expect(config.requestHandler).toBeInstanceOf(NodeHttpHandler);
    expect(scriptAwsClientConnectionTimeoutMs()).toBe(900);

    const handlerConfig = await (
      config.requestHandler as unknown as {
        configProvider: Promise<{ connectionTimeout: number; requestTimeout: number }>;
      }
    ).configProvider;
    expect(handlerConfig.connectionTimeout).toBe(900);
    expect(handlerConfig.requestTimeout).toBe(4000);
  });

  it('adds an abort signal to AWS SDK send calls without overriding caller signals', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const client = withScriptAwsClientTimeout({ send });

    await expect(client.send({ command: 'DescribeUserPool' })).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      { command: 'DescribeUserPool' },
      { abortSignal: expect.any(AbortSignal) },
    );

    const controller = new AbortController();
    await client.send({ command: 'DescribeUserPool' }, { abortSignal: controller.signal });
    expect(send).toHaveBeenLastCalledWith(
      { command: 'DescribeUserPool' },
      { abortSignal: controller.signal },
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
    const client = withScriptAwsClientTimeout({ send }, 1234);

    await expect(client.send({ command: 'DescribeUserPool' })).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledWith(
      { command: 'DescribeUserPool' },
      { abortSignal: expect.any(AbortSignal) },
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
    expect(abortSignalTimeoutSpy).not.toHaveBeenCalled();
  });
});
