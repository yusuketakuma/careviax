import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  patientSelfReportFindFirstMock,
  patientSelfReportUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  patientSelfReportFindFirstMock: vi.fn(),
  patientSelfReportUpdateMock: vi.fn(),
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
    patientSelfReport: {
      findFirst: patientSelfReportFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

describe('/api/patient-self-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientSelfReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      triaged_at: null,
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
    const response = (await PATCH({
      json: async () => ({
        status: 'resolved',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(patientSelfReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        status: 'resolved',
        triaged_by: 'user_1',
      }),
    });
  });
});
