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

    expect(phosAwsClientConfig()).toEqual({ maxAttempts: DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS });
    vi.stubEnv('PHOS_AWS_CLIENT_MAX_ATTEMPTS', String(MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS + 1));
    expect(phosAwsClientConfig()).toEqual({ maxAttempts: MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS });
  });
});
