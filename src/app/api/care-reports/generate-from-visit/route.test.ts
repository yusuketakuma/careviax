import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { generateReportsFromVisitMock } = vi.hoisted(() => ({
  generateReportsFromVisitMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      } as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
  },
}));

vi.mock('@/server/services/report-generator', () => ({
  generateReportsFromVisit: generateReportsFromVisitMock,
}));

import { POST } from './route';

describe('/api/care-reports/generate-from-visit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates reports from a visit record', async () => {
    generateReportsFromVisitMock.mockResolvedValue({
      reports: [{ id: 'report_1', report_type: 'physician_report' }],
    });

    const response = (await POST({
      json: async () => ({
        visit_record_id: 'visit_1',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'report_1', report_type: 'physician_report' }],
    });
    expect(generateReportsFromVisitMock).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'visit_1',
      undefined,
      { userId: 'user_1', role: 'pharmacist' },
    );
  });

  it('returns 404 when the visit record is missing', async () => {
    generateReportsFromVisitMock.mockRejectedValue(new Error('visit record not found'));

    const response = (await POST({
      json: async () => ({
        visit_record_id: 'visit_missing',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(404);
  });

  it('returns 403 when the caller cannot access the visit record assignment', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('VisitRecord not accessible: visit_1'),
    );

    const response = (await POST({
      json: async () => ({
        visit_record_id: 'visit_1',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(403);
  });
});
