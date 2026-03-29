import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  tracingReportFindManyMock,
  tracingReportCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  tracingReportFindManyMock: vi.fn(),
  tracingReportCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    tracingReport: {
      findMany: tracingReportFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/tracing-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tracingReportFindManyMock.mockResolvedValue([
      { id: 'report_1', patient_id: 'patient_1', status: 'draft' },
    ]);
    tracingReportCreateMock.mockResolvedValue({
      id: 'report_2',
      patient_id: 'patient_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          create: tracingReportCreateMock,
        },
      }),
    );
  });

  it('lists tracing reports', async () => {
    const response = (await GET({
      url: 'http://localhost/api/tracing-reports?patient_id=patient_1&status=draft',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'report_1', patient_id: 'patient_1' }],
    });
  });

  it('creates a tracing report', async () => {
    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        content: { summary: '確認事項' },
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
      }),
    });
  });
});
