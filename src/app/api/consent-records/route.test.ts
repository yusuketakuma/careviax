import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  consentRecordFindManyMock,
  consentRecordCountMock,
  consentRecordFindFirstMock,
  validateOrgReferencesMock,
  consentRecordCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  consentRecordCountMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  consentRecordCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    consentRecord: {
      findMany: consentRecordFindManyMock,
      count: consentRecordCountMock,
      findFirst: consentRecordFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/consent-records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    consentRecordFindManyMock.mockResolvedValue([
      { id: 'consent_1', patient_id: 'patient_1', consent_type: 'external_sharing' },
    ]);
    consentRecordCountMock.mockResolvedValue(1);
    consentRecordFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    consentRecordCreateMock.mockResolvedValue({
      id: 'consent_2',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          create: consentRecordCreateMock,
        },
      }),
    );
  });

  it('lists consent records for the target patient', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/consent-records?patient_id=patient_1&consent_type=external_sharing')
    ))!;

    expect(response.status).toBe(200);
    expect(consentRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          consent_type: 'external_sharing',
          is_active: true,
        }),
      })
    );
  });

  it('creates a consent record when no active duplicate exists', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      })
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      patient_id: 'patient_1',
    });
    expect(consentRecordCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
      }),
    });
  });
});
