import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordTwilioDeliveryReceiptMock, loggerErrorMock } = vi.hoisted(() => ({
  recordTwilioDeliveryReceiptMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/server/services/twilio-delivery-receipts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/twilio-delivery-receipts')>();
  return { ...actual, recordTwilioDeliveryReceipt: recordTwilioDeliveryReceiptMock };
});

vi.mock('@/lib/utils/logger', () => ({ logger: { error: loggerErrorMock } }));

import { POST } from './route';

const ACCOUNT_SID = `AC${'1'.repeat(32)}`;
const AUTH_TOKEN = 'twilio-auth-token-for-tests';
const MESSAGE_SID = `SM${'a'.repeat(32)}`;
const DELIVERY_ID = '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb';
const CALLBACK_URL = 'https://app.example.test/api/webhooks/twilio/message-status';
const SIGNED_URL = `${CALLBACK_URL}?org_id=org_1&delivery_id=${DELIVERY_ID}`;

function request(params: Record<string, string>, signature?: string) {
  const body = new URLSearchParams(params).toString();
  return new NextRequest(SIGNED_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'x-twilio-signature': signature } : {}),
    },
    body,
  });
}

function signedRequest(params: Record<string, string>) {
  return request(params, twilio.getExpectedTwilioSignature(AUTH_TOKEN, SIGNED_URL, params));
}

describe('/api/webhooks/twilio/message-status POST', () => {
  const originalEnv = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    callbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.TWILIO_STATUS_CALLBACK_URL = CALLBACK_URL;
    recordTwilioDeliveryReceiptMock.mockResolvedValue({ appliedCount: 1, pending: false });
  });

  afterAll(() => {
    for (const [name, value] of [
      ['TWILIO_ACCOUNT_SID', originalEnv.accountSid],
      ['TWILIO_AUTH_TOKEN', originalEnv.authToken],
      ['TWILIO_STATUS_CALLBACK_URL', originalEnv.callbackUrl],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('accepts a valid signed callback without echoing provider data', async () => {
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'delivered',
      To: '+819011111111',
    };

    const response = await POST(signedRequest(params));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toBe('');
    expect(recordTwilioDeliveryReceiptMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      deliveryId: DELIVERY_ID,
      messageSid: MESSAGE_SID,
      status: 'delivered',
      errorCode: undefined,
    });
  });

  it('rejects missing or invalid signatures before persistence', async () => {
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'delivered',
    };
    const missing = await POST(request(params));
    expect(missing.status).toBe(401);
    const invalid = await POST(request(params, 'invalid-signature'));
    expect(invalid.status).toBe(401);
    expect(recordTwilioDeliveryReceiptMock).not.toHaveBeenCalled();
  });

  it('fails closed when verification configuration is unavailable', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'sent',
    };

    const response = await POST(signedRequest(params));

    expect(response.status).toBe(503);
    expect(recordTwilioDeliveryReceiptMock).not.toHaveBeenCalled();
  });

  it('returns a retryable error without logging raw callback fields when persistence fails', async () => {
    recordTwilioDeliveryReceiptMock.mockRejectedValue(new Error('db unavailable'));
    const params = {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'undelivered',
      ErrorCode: '30003',
      To: '+819011111111',
    };

    const response = await POST(signedRequest(params));

    expect(response.status).toBe(500);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'twilio.delivery_callback_failed',
      route: '/api/webhooks/twilio/message-status',
      operation: 'record_twilio_delivery_receipt',
      code: 'TWILIO_DELIVERY_CALLBACK_PROCESSING_FAILED',
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(MESSAGE_SID);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('+819011111111');
  });
});
