import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineNotificationAdapter } from './index';

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
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer line-token',
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
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const adapter = new LineNotificationAdapter({
      provider: 'line',
      channelAccessToken: 'line-token',
    });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toBeUndefined();

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

  it('silently skips delivery when no provider is configured', async () => {
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new LineNotificationAdapter({ provider: 'stub' });

    await expect(adapter.sendMessage('user-1', '通知本文')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalled();
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
});
