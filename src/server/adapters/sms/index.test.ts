import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmsNotificationAdapter } from './index';

describe('SmsNotificationAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses an unrefed cleanup timer for Twilio delivery requests', async () => {
    vi.stubEnv('SMS_DELIVERY_TIMEOUT_MS', '2200');
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
        signal: expect.any(AbortSignal),
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2200);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
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
