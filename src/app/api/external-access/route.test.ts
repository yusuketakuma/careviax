import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  validateOrgReferencesMock,
  withOrgContextMock,
  issueExternalAccessTokenMock,
  sendSmsMock,
  createMock,
  updateMock,
} = vi.hoisted(() => ({
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  issueExternalAccessTokenMock: vi.fn(),
  sendSmsMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: vi.fn(),
    },
    externalAccessGrant: {
      findMany: vi.fn(),
    },
    patientSelfReport: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/server/services/external-access', () => ({
  issueExternalAccessToken: issueExternalAccessTokenMock,
}));

vi.mock('@/server/adapters/sms', () => ({
  SmsNotificationAdapter: class SmsNotificationAdapter {
    async sendSms(phoneNumber: string, message: string) {
      return sendSmsMock(phoneNumber, message);
    }
  },
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/external-access POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    issueExternalAccessTokenMock.mockResolvedValue('jwt-token');
    createMock.mockResolvedValue({
      id: 'grant_1',
      patient_id: 'patient_1',
      granted_to_name: '田中ケアマネ',
      granted_to_contact: '09012345678',
      scope: { medication_list: true },
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    updateMock.mockResolvedValue({ id: 'grant_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalAccessGrant: {
          create: createMock,
          update: updateMock,
        },
      })
    );
  });

  it('issues a JWT-backed grant and sends the OTP by SMS when the contact is a phone number', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 72,
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(issueExternalAccessTokenMock).toHaveBeenCalledWith({
      grantId: 'grant_1',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'grant_1' },
      data: {
        token_hash: expect.any(String),
      },
    });
    expect(sendSmsMock).toHaveBeenCalledWith(
      '090-1234-5678',
      expect.stringContaining('CareViaX共有OTP:')
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        token: 'jwt-token',
        otp_delivery: 'sms',
        otp_delivery_destination: '090****5678',
      },
    });
  });

  it('keeps OTP delivery manual when the contact is not a phone number', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: 'care@example.com',
        scope: { medication_list: true },
        expires_hours: 48,
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(sendSmsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        token: 'jwt-token',
        otp_delivery: 'manual',
        otp_delivery_destination: null,
      },
    });
  });

  it('accepts a null contact from the share form and still creates a manual-delivery grant', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        granted_to_contact: null,
      }),
      select: expect.any(Object),
    });
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
