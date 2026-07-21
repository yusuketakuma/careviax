import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSmsProviderReadiness, SmsNotificationAdapter } from './index';

const TWILIO_MESSAGE_SID = `SM${'a'.repeat(32)}`;

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
      .mockResolvedValue(
        Response.json({ sid: TWILIO_MESSAGE_SID, status: 'queued' }, { status: 201 }),
      );
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toEqual({
      status: 'accepted',
      provider: 'twilio',
      providerMessageId: TWILIO_MESSAGE_SID,
    });

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

  it('adds a tenant-bound signed callback URL without placing delivery data in the body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ sid: TWILIO_MESSAGE_SID, status: 'queued' }, { status: 201 }),
      );
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
      statusCallbackUrl: 'https://app.example.test/api/webhooks/twilio/message-status',
    });

    await adapter.sendSms('+819011111111', '通知本文', {
      callbackContext: { orgId: 'org_1', deliveryId: '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb' },
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = new URLSearchParams(String(request?.body));
    expect(body.get('StatusCallback')).toBe(
      'https://app.example.test/api/webhooks/twilio/message-status?org_id=org_1&delivery_id=4fda4c0e-95c0-4a38-8e8f-75822b5e55fb',
    );
    expect(body.get('Body')).toBe('通知本文');
    expect(body.get('Body')).not.toContain('org_1');
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
      .mockResolvedValue(
        Response.json({ sid: TWILIO_MESSAGE_SID, status: 'queued' }, { status: 201 }),
      );
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toMatchObject({
      status: 'accepted',
    });

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

  it('returns not_configured instead of reporting stub delivery success', async () => {
    const adapter = new SmsNotificationAdapter({ provider: 'not_configured' });

    expect(getSmsProviderReadiness()).toEqual({
      status: 'not_configured',
      deliveryTracking: 'not_configured',
    });
    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toEqual({
      status: 'not_configured',
      provider: null,
      providerMessageId: null,
    });
  });

  it('reports partial Twilio configuration as misconfigured readiness and failed delivery', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');

    expect(getSmsProviderReadiness()).toEqual({
      status: 'misconfigured',
      deliveryTracking: 'misconfigured',
    });
    await expect(
      new SmsNotificationAdapter().sendSms('+819011111111', '通知本文'),
    ).resolves.toEqual({
      status: 'failed',
      provider: 'twilio',
      providerMessageId: null,
    });
  });

  it('fails closed when the configured callback URL is not the exact HTTPS route', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'auth-token');
    vi.stubEnv('TWILIO_FROM_NUMBER', '+819012345678');
    vi.stubEnv('TWILIO_STATUS_CALLBACK_URL', 'http://attacker.test/callback');

    expect(getSmsProviderReadiness()).toEqual({
      status: 'misconfigured',
      deliveryTracking: 'misconfigured',
    });
    await expect(
      new SmsNotificationAdapter().sendSms('+819011111111', '通知本文'),
    ).resolves.toMatchObject({ status: 'failed', provider: 'twilio' });
  });

  it('reports sending and delivery-tracking readiness independently', () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'auth-token');
    vi.stubEnv('TWILIO_FROM_NUMBER', '+819012345678');

    expect(getSmsProviderReadiness()).toEqual({
      status: 'ready',
      deliveryTracking: 'not_configured',
    });

    vi.stubEnv(
      'TWILIO_STATUS_CALLBACK_URL',
      'https://app.example.test/api/webhooks/twilio/message-status',
    );
    expect(getSmsProviderReadiness()).toEqual({
      status: 'ready',
      deliveryTracking: 'ready',
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
      response: new Response('{}', { status: 201 }),
      status: 'unknown',
    },
    {
      label: 'provider-declared failure',
      response: Response.json({ sid: TWILIO_MESSAGE_SID, status: 'failed' }, { status: 201 }),
      status: 'failed',
    },
  ])('returns $status for $label', async ({ response, status }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toMatchObject({
      status,
      provider: 'twilio',
      providerMessageId: null,
    });
  });

  it('returns unknown when the request outcome cannot be determined', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network response lost'));
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.sendSms('+819011111111', '通知本文')).resolves.toEqual({
      status: 'unknown',
      provider: 'twilio',
      providerMessageId: null,
    });
  });

  it('fetches a Twilio delivery status by the exact provider message SID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        sid: TWILIO_MESSAGE_SID,
        status: 'delivered',
        error_code: null,
        body: 'must not be returned',
        to: '+819011111111',
      }),
    );
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.fetchTwilioMessageStatus(TWILIO_MESSAGE_SID)).resolves.toEqual({
      status: 'available',
      providerStatus: 'delivered',
      errorCode: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/${TWILIO_MESSAGE_SID}.json`,
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it('fails closed when a Twilio status response does not match the requested SID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ sid: `SM${'b'.repeat(32)}`, status: 'delivered' }),
    );
    const adapter = new SmsNotificationAdapter({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+819012345678',
    });

    await expect(adapter.fetchTwilioMessageStatus(TWILIO_MESSAGE_SID)).resolves.toEqual({
      status: 'unknown',
    });
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
