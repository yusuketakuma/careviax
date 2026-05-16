import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientSelfReportFindFirstMock,
  patientFindFirstMock,
  patientSelfReportUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientSelfReportFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientSelfReportUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientSelfReport: {
      findFirst: patientSelfReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

describe('/api/patient-self-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientSelfReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      triaged_at: null,
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientSelfReportUpdateMock.mockResolvedValue({ id: 'report_1', status: 'resolved' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          update: patientSelfReportUpdateMock,
        },
      }),
    );
  });

  it('stamps triage metadata when moving out of submitted', async () => {
    const response = (await PATCH(
      {
        json: async () => ({
          status: 'resolved',
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientSelfReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        status: 'resolved',
        triaged_by: 'user_1',
      }),
    });
  });

  it('does not return detail for an unassigned self report', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
    expect(patientSelfReportFindFirstMock).toHaveBeenCalledTimes(1);
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
  });

  it('does not update an unassigned self report', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      {
        json: async () => ({
          status: 'resolved',
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(patientSelfReportUpdateMock).not.toHaveBeenCalled();
  });
});
