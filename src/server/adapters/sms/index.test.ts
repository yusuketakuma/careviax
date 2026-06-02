import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmsNotificationAdapter } from './index';

describe('SmsNotificationAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends SMS via Twilio when configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }));
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
  });

  it('silently skips delivery when no provider is configured', async () => {
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new SmsNotificationAdapter({ provider: 'stub' });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalled();
  });

  it('rejects blank delivery targets and messages before calling Twilio', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }));
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('   ', '通知本文')).rejects.toThrow(
      'SMS delivery target is required',
    );
    await expect(adapter.sendSms('+819011111111', '   ')).rejects.toThrow(
      'SMS delivery message is required',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
