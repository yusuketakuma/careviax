import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  consentRecordFindFirstMock,
  consentRecordUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

describe('/api/consent-records/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
    });
    consentRecordUpdateMock.mockResolvedValue({
      id: 'consent_1',
      document_url: 'https://example.com/consent.pdf',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          update: consentRecordUpdateMock,
        },
      }),
    );
  });

  it('returns a consent record by id', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'consent_1',
    });
  });

  it('updates expiry date and document url', async () => {
    const response = (await PATCH({
      json: async () => ({
        expiry_date: '2026-12-31',
        document_url: 'https://example.com/consent.pdf',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: { id: 'consent_1' },
      data: {
        expiry_date: new Date('2026-12-31'),
        document_url: 'https://example.com/consent.pdf',
      },
    });
  });
});
