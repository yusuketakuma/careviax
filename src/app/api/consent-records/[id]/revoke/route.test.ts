import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  consentRecordFindFirstMock,
  consentRecordUpdateMock,
  externalAccessGrantUpdateManyMock,
  workflowExceptionCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordUpdateMock: vi.fn(),
  externalAccessGrantUpdateManyMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
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

import { POST } from './route';

describe('/api/consent-records/[id]/revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      is_active: true,
    });
    consentRecordUpdateMock.mockResolvedValue({
      id: 'consent_1',
      is_active: false,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          update: consentRecordUpdateMock,
        },
        externalAccessGrant: {
          updateMany: externalAccessGrantUpdateManyMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
        },
      }),
    );
  });

  it('revokes the consent record and related external grants', async () => {
    const response = (await POST({
      json: async () => ({
        reason: '本人希望',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(consentRecordUpdateMock).toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        revoked_at: null,
      },
      data: {
        revoked_at: expect.any(Date),
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalled();
  });
});
