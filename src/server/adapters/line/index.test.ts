import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LineNotificationAdapter } from './index';

describe('LineNotificationAdapter', () => {
  beforeEach(() => {
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
      }),
    );
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
