import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLineProviderReadiness, LineNotificationAdapter } from './index';

describe('LineNotificationAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends LINE messages through the Messaging API when configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'x-line-request-id': 'line-request-1' } }),
      );
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(
      adapter.sendMessage('user-1', '通知本文', {
        idempotencyKey: '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb',
      }),
    ).resolves.toEqual({
      status: 'accepted',
      provider: 'line',
      providerMessageId: 'line-request-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer line-token',
          'X-Line-Retry-Key': '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses an unrefed cleanup timer for LINE delivery requests', async () => {
    vi.stubEnv('LINE_DELIVERY_TIMEOUT_MS', '1800');
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'x-line-request-id': 'line-request-1' } }),
      );
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toMatchObject({
      status: 'accepted',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1800);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('returns not_configured instead of reporting stub delivery success', async () => {
    const adapter = new LineNotificationAdapter({ provider: 'not_configured' });

    expect(getLineProviderReadiness()).toEqual({ status: 'not_configured' });
    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toEqual({
      status: 'not_configured',
      provider: null,
      providerMessageId: null,
    });
  });

  it.each([
    {
      label: 'provider rejection',
      response: new Response('{}', { status: 400 }),
      status: 'failed',
    },
    {
      label: 'missing provider ID',
      response: new Response('{}', { status: 200 }),
      status: 'unknown',
    },
  ])('returns $status for $label', async ({ response, status }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toMatchObject({
      status,
      provider: 'line',
      providerMessageId: null,
    });
  });

  it('returns unknown when the request outcome cannot be determined', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network response lost'));
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toEqual({
      status: 'unknown',
      provider: 'line',
      providerMessageId: null,
    });
  });

  it('rejects blank delivery targets and messages before calling LINE', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('   ', '通知本文')).rejects.toThrow(
      'LINE delivery target is required',
    );
    await expect(adapter.sendMessage('user-1', '   ')).rejects.toThrow(
      'LINE delivery message is required',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed retry keys before calling LINE', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(
      adapter.sendMessage('user-1', '通知本文', { idempotencyKey: 'not-a-uuid' }),
    ).rejects.toThrow('LINE idempotency key must be a UUID');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
