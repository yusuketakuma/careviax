import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  pharmacistShiftTemplateFindManyMock,
  pharmacistShiftUpsertMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn(),
  pharmacistShiftTemplateFindManyMock: vi.fn(),
  pharmacistShiftUpsertMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacist-shift-templates/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacist-shift-templates/apply POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
    });
    runWithRequestAuthContextMock.mockImplementation(
      (_ctx: { orgId: string; userId: string; role: string }, fn: () => Promise<Response>) => fn(),
    );
    pharmacistShiftTemplateFindManyMock.mockResolvedValue([
      {
        user_id: 'user_2',
        site_id: 'site_1',
        weekday: 1,
        available: true,
        available_from: new Date('1970-01-01T09:00:00'),
        available_to: new Date('1970-01-01T18:00:00'),
        note: null,
      },
    ]);
    pharmacistShiftUpsertMock.mockResolvedValue({ id: 'shift_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShiftTemplate: {
          findMany: pharmacistShiftTemplateFindManyMock,
        },
        pharmacistShift: {
          upsert: pharmacistShiftUpsertMock,
        },
      }),
    );
  });

  it('rejects non-object apply payloads before loading templates', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistShiftTemplateFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('applies weekday templates across the target month', async () => {
    const response = (await POST(
      createRequest({
        month: ' 2026-04 ',
        user_id: ' user_2 ',
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftTemplateFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: 'user_2',
      },
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'admin' }),
      expect.any(Function),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledTimes(4);
    const appliedDates = pharmacistShiftUpsertMock.mock.calls.map(([args]) => {
      const date = args.where.user_id_date.date as Date;
      expect(args.create.date).toEqual(date);
      return date.toISOString();
    });
    expect(appliedDates).toEqual([
      '2026-04-06T00:00:00.000Z',
      '2026-04-13T00:00:00.000Z',
      '2026-04-20T00:00:00.000Z',
      '2026-04-27T00:00:00.000Z',
    ]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        applied_count: 4,
      },
    });
  });

  it('rejects invalid month keys before loading templates', async () => {
    const response = (await POST(
      createRequest({
        month: '2026-13',
        user_id: 'user_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(pharmacistShiftTemplateFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });
});
