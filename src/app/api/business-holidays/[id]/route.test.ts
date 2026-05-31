import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  holidayFindFirstMock,
  duplicateFindFirstMock,
  validateOrgReferencesMock,
  holidayUpdateMock,
  holidayDeleteMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  holidayFindFirstMock: vi.fn(),
  duplicateFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  holidayUpdateMock: vi.fn(),
  holidayDeleteMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    businessHoliday: {
      findFirst: vi.fn((args: { where?: { id?: string | { not: string } } }) =>
        typeof args.where?.id === 'string'
          ? holidayFindFirstMock(args)
          : duplicateFindFirstMock(args)
      ),
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

import { DELETE, PATCH } from './route';

function createRequest(body?: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/business-holidays/holiday_1', {
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/business-holidays/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
      },
    });
    holidayFindFirstMock.mockResolvedValue({ id: 'holiday_1', name: '祝日設定' });
    duplicateFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    holidayUpdateMock.mockResolvedValue({ id: 'holiday_1' });
    holidayDeleteMock.mockResolvedValue({ id: 'holiday_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        businessHoliday: {
          update: holidayUpdateMock,
          delete: holidayDeleteMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('updates a holiday record', async () => {
    const response = await PATCH(
      createRequest(
        {
          date: '2026-05-03',
          name: '憲法記念日',
          holiday_type: 'public_holiday',
          is_closed: true,
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'holiday_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(holidayUpdateMock).toHaveBeenCalledWith({
      where: { id: 'holiday_1' },
      data: {
        site_id: null,
        date: new Date('2026-05-03'),
        name: '憲法記念日',
        holiday_type: 'public_holiday',
        is_closed: true,
      },
    });
  });

  it('deletes a holiday record', async () => {
    const response = await DELETE(
      createRequest(undefined, { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'holiday_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(holidayDeleteMock).toHaveBeenCalledWith({
      where: { id: 'holiday_1' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'admin_1',
        action: 'business_holiday_deleted',
        target_id: 'holiday_1',
      }),
    });
  });
});
