import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  pharmacistShiftUpsertMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pharmacistShiftUpsertMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacist-shifts/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacist-shifts/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/pharmacist-shifts/bulk POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
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
    expectNoStore(response);
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
    expectNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenNthCalledWith(1, 'org_1', {
      site_id: 'site_1',
      pharmacist_id: 'user_1',
    });
    expect(validateOrgReferencesMock).toHaveBeenNthCalledWith(2, 'org_1', {
      site_id: 'site_2',
      pharmacist_id: 'user_2',
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledTimes(2);
    expect(pharmacistShiftUpsertMock).toHaveBeenNthCalledWith(1, {
      where: { user_id_date: { user_id: 'user_1', date: new Date('2026-04-20') } },
      create: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        site_id: 'site_1',
        user_id: 'user_1',
        available: true,
      },
      update: {
        site_id: 'site_1',
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0)),
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
    expectNoStore(response);
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
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth failure before parsing bulk shift body or validating references', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
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
    expectNoStore(response);
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

  it('returns a sanitized no-store 500 when bulk shift upsert fails unexpectedly', async () => {
    const unsafeError = new Error('raw pharmacist shift bulk note secret');
    unsafeError.name = 'PharmacistShiftBulkSecretError';
    pharmacistShiftUpsertMock.mockRejectedValueOnce(unsafeError);

    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: 'site_1',
            user_id: 'user_1',
            date: '2026-04-20',
            note: '患者宅ルート調整',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('bulk note secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'pharmacist_shifts_bulk_post_unhandled_error',
      undefined,
      {
        event: 'pharmacist_shifts_bulk_post_unhandled_error',
        route: '/api/pharmacist-shifts/bulk',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('bulk note secret');
    expect(logged).not.toContain('PharmacistShiftBulkSecretError');
  });
});
