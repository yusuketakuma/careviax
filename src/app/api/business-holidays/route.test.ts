import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  businessHolidayFindManyMock,
  businessHolidayFindFirstMock,
  businessHolidayCreateMock,
  auditLogCreateMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  businessHolidayFindManyMock: vi.fn(),
  businessHolidayFindFirstMock: vi.fn(),
  businessHolidayCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string; userId: string; ipAddress?: string; userAgent?: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      } as NextRequest & { orgId: string; userId: string; ipAddress?: string; userAgent?: string });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
      findFirst: businessHolidayFindFirstMock,
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

describe('/api/business-holidays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    businessHolidayFindManyMock.mockResolvedValue([{ id: 'holiday_1', name: '祝日' }]);
    businessHolidayFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    businessHolidayCreateMock.mockResolvedValue({ id: 'holiday_2', name: '臨時休業' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        businessHoliday: {
          create: businessHolidayCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists business holidays', async () => {
    const response = (await GET({
      url: 'http://localhost/api/business-holidays?site_id=site_1',
    } as NextRequest))!;

    expect(response.status).toBe(200);
  });

  it('creates a business holiday and records an audit log', async () => {
    const response = (await POST({
      json: async () => ({
        date: '2026-03-30',
        name: '臨時休業',
        holiday_type: 'site_closure',
        is_closed: true,
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(businessHolidayCreateMock).toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalled();
  });
});
