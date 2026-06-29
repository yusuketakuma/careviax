import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  pharmacistShiftFindManyMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  pharmacistShiftUpsertMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  pharmacistShiftFindManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pharmacistShiftUpsertMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn(),
  withRoutePerformanceMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/pharmacist-shifts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = {
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      ipAddress: '203.0.113.10',
      userAgent: 'vitest',
    };
    requireAuthContextMock.mockResolvedValue({ ctx });
    runWithRequestAuthContextMock.mockImplementation(
      (_ctx: typeof ctx, fn: () => Promise<Response>) => fn(),
    );
    withRoutePerformanceMock.mockImplementation((_req: NextRequest, fn: () => Promise<Response>) =>
      fn(),
    );
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistShiftUpsertMock.mockResolvedValue({ id: 'shift_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShift: {
          findMany: pharmacistShiftFindManyMock,
          upsert: pharmacistShiftUpsertMock,
        },
      }),
    );
  });

  it('filters shifts by month range and related ids', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts?month=2026-04-01&user_id=user_2&site_id=site_1',
      ),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: {
          gte: new Date(2026, 3, 1),
          lte: new Date(2026, 4, 0),
        },
        user_id: 'user_2',
        site_id: 'site_1',
      },
      orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
        site: { select: { id: true, name: true } },
      },
    });
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('uses route-local auth, route performance, and explicit RLS request context for GET', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts?month=2026-04-01'),
    ))!;

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: 'シフト情報の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
  });

  it('honors explicit limit queries with overflow metadata', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 401 }, (_, index) => ({ id: `shift_${index}` })),
    );

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts?month=2026-04-01&limit=400'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 401,
      }),
    );
    const body = await response.json();
    expect(body.data).toHaveLength(400);
    expect(body.data.at(-1)).toEqual({ id: 'shift_399' });
    expect(JSON.stringify(body)).not.toContain('shift_400');
    expect(body.meta).toEqual({ limit: 400, has_more: true });
  });

  it.each([
    ['9999', 501, 500],
    ['0', 2, 1],
    ['abc', 401, 400],
  ])('bounds explicit limit=%s to take %i', async (rawLimit, expectedTake, expectedLimit) => {
    const response = (await GET(
      createRequest(`http://localhost/api/pharmacist-shifts?month=2026-04-01&limit=${rawLimit}`),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        limit: expectedLimit,
        has_more: false,
      },
    });
  });

  it('rejects invalid month filters before querying shifts', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts?month=foo'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        month: expect.arrayContaining(['日付形式が不正です（YYYY-MM-DD）']),
      },
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid date range filters before querying shifts', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts?date_from=2026-02-31'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        date_from: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects reversed date ranges before querying shifts', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts?date_from=2026-04-20&date_to=2026-04-01',
      ),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        date_to: ['date_to は date_from 以降を指定してください'],
      },
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw shift lookup failures', async () => {
    pharmacistShiftFindManyMock.mockRejectedValueOnce(
      new Error('raw pharmacist shift failure for user_2'),
    );

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts?month=2026-04-01'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw pharmacist shift failure for user_2');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'pharmacist_shifts_get_unhandled_error',
      undefined,
      {
        event: 'pharmacist_shifts_get_unhandled_error',
        route: '/api/pharmacist-shifts',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'raw pharmacist shift failure for user_2',
    );
  });

  it('returns no-store POST auth failures before parsing body or validating references', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response('forbidden', { status: 403 }),
    });

    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: 'site_2',
        user_id: 'user_2',
        date: '2026-04-15',
      }),
    ))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects non-object shift payloads before reference checks or upsert', async () => {
    const response = (await POST(createRequest('http://localhost/api/pharmacist-shifts', [])))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('upserts shifts and updates site_id on existing rows', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: ' site_2 ',
        user_id: ' user_2 ',
        date: ' 2026-04-15 ',
        available: false,
        available_from: ' 09:00 ',
        available_to: ' 12:00:00 ',
        note: ' 午前のみ ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: 'site_2',
      pharmacist_id: 'user_2',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledWith({
      where: {
        user_id_date: {
          user_id: 'user_2',
          date: new Date('2026-04-15'),
        },
      },
      create: {
        org_id: 'org_1',
        site_id: 'site_2',
        user_id: 'user_2',
        date: new Date('2026-04-15'),
        available: false,
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T12:00:00'),
        note: '午前のみ',
      },
      update: {
        site_id: 'site_2',
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T12:00:00'),
        available: false,
        note: '午前のみ',
      },
    });
  });

  it('clears blank shift times and blank notes with normalized row ids', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: ' site_3 ',
        user_id: ' user_3 ',
        date: '2026-04-16',
        available_from: ' ',
        available_to: ' ',
        note: ' ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: 'site_3',
      pharmacist_id: 'user_3',
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id_date: { user_id: 'user_3', date: new Date('2026-04-16') } },
        create: expect.objectContaining({
          site_id: 'site_3',
          user_id: 'user_3',
          available: true,
          available_from: null,
          available_to: null,
          note: null,
        }),
        update: expect.objectContaining({
          site_id: 'site_3',
          available: true,
          available_from: null,
          available_to: null,
          note: null,
        }),
      }),
    );
  });

  it('rejects blank ids and malformed shift times before reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: '   ',
        user_id: 'user_2',
        date: '2026-04-15',
        available_from: '24:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects reversed shift times before reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: 'site_2',
        user_id: 'user_2',
        date: '2026-04-15',
        available_from: '13:00',
        available_to: '09:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        available_to: ['終了時刻は開始時刻以降を指定してください'],
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar dates before reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shifts', {
        site_id: 'site_2',
        user_id: 'user_2',
        date: '2026-02-31',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftUpsertMock).not.toHaveBeenCalled();
  });
});
