import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const { validateOrgReferencesMock, withOrgContextMock, pharmacistShiftUpsertMock } = vi.hoisted(
  () => ({
    validateOrgReferencesMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    pharmacistShiftUpsertMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown): AuthenticatedTestRequest {
  return Object.assign(
    new NextRequest('http://localhost/api/pharmacist-shifts/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
  );
}

describe('/api/pharmacist-shifts/bulk POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistShiftUpsertMock.mockResolvedValue({ id: 'shift_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShift: {
          upsert: pharmacistShiftUpsertMock,
        },
      }),
    );
  });

  it('rejects non-object bulk payloads before validating row references', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('bulk upserts shift rows and returns the applied count', async () => {
    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: ' site_1 ',
            user_id: ' user_1 ',
            date: ' 2026-04-20 ',
            available: true,
            available_from: ' 09:00 ',
            available_to: ' 18:00:00 ',
          },
          {
            site_id: 'site_2',
            user_id: 'user_2',
            date: '2026-04-21',
            available: false,
            available_from: ' ',
            available_to: ' ',
            note: ' 休暇 ',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenNthCalledWith(1, 'org_1', {
      site_id: 'site_1',
      pharmacist_id: 'user_1',
    });
    expect(validateOrgReferencesMock).toHaveBeenNthCalledWith(2, 'org_1', {
      site_id: 'site_2',
      pharmacist_id: 'user_2',
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledTimes(2);
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledTimes(2);
    expect(pharmacistShiftUpsertMock).toHaveBeenNthCalledWith(1, {
      where: { user_id_date: { user_id: 'user_1', date: new Date('2026-04-20') } },
      create: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T18:00:00'),
        site_id: 'site_1',
        user_id: 'user_1',
        available: true,
      },
      update: {
        site_id: 'site_1',
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T18:00:00'),
        available: true,
      },
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenNthCalledWith(2, {
      where: { user_id_date: { user_id: 'user_2', date: new Date('2026-04-21') } },
      create: {
        org_id: 'org_1',
        date: new Date('2026-04-21'),
        available_from: null,
        available_to: null,
        site_id: 'site_2',
        user_id: 'user_2',
        available: false,
        note: '休暇',
      },
      update: {
        site_id: 'site_2',
        available_from: null,
        available_to: null,
        available: false,
        note: '休暇',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        applied_count: 2,
      },
    });
  });

  it('rejects blank ids and malformed shift times before validating row references', async () => {
    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: '   ',
            user_id: 'user_1',
            date: '2026-04-20',
            available_from: '24:00',
            available_to: '18:00:00',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar dates before validating row references', async () => {
    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: 'site_1',
            user_id: 'user_1',
            date: '2026-02-31',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects invalid row references even when the reference error body is not JSON', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: new Response('{"details":', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: 'site_1',
            user_id: 'user_1',
            date: '2026-04-20',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2 行目の参照先が不正です',
      details: {
        row: 2,
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });
});
