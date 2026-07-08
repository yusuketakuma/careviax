import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  businessHolidayFindManyMock,
  businessHolidayFindFirstMock,
  businessHolidayCreateMock,
  auditLogCreateMock,
  validateOrgReferencesMock,
  advisoryLockMock,
  withOrgContextMock,
  withAuthContextOptions,
} = vi.hoisted(() => ({
  businessHolidayFindManyMock: vi.fn(),
  businessHolidayFindFirstMock: vi.fn(),
  businessHolidayCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  advisoryLockMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  withAuthContextOptions: [] as unknown[],
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) => {
    withAuthContextOptions.push(options);
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
        routeContext,
      );
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

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: advisoryLockMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/business-holidays${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/business-holidays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/business-holidays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/business-holidays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    businessHolidayFindManyMock.mockResolvedValue([{ id: 'holiday_1', name: '祝日' }]);
    businessHolidayFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    businessHolidayCreateMock.mockResolvedValue({ id: 'holiday_2', name: '臨時休業' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    advisoryLockMock.mockResolvedValue(undefined);
    // dedup の存在チェックは tx 内で行うため、tx クライアントにも findFirst を提供する。
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        businessHoliday: {
          findFirst: businessHolidayFindFirstMock,
          create: businessHolidayCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists business holidays', async () => {
    const response = (await GET(
      createGetRequest('?date_from=2026-03-01&date_to=2026-03-31&site_id=%20site_1%20&limit=5'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: [{ id: 'holiday_1', name: '祝日' }],
    });
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canAdmin',
        message: '休日設定の閲覧権限がありません',
      }),
    );
    expect(businessHolidayFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: {
          gte: new Date('2026-03-01'),
          lte: new Date('2026-03-31'),
        },
        site_id: 'site_1',
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }],
      take: 5,
    });
  });

  it('uses a default list bound and clamps overly large limits', async () => {
    const defaultResponse = (await GET(createGetRequest()))!;
    expect(defaultResponse.status).toBe(200);
    expectSensitiveNoStore(defaultResponse);
    expect(businessHolidayFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );

    const clampedResponse = (await GET(createGetRequest('?limit=9999')))!;
    expect(clampedResponse.status).toBe(200);
    expectSensitiveNoStore(clampedResponse);
    expect(businessHolidayFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 400,
      }),
    );
  });

  it('rejects invalid date range filters before querying holidays', async () => {
    const response = (await GET(createGetRequest('?date_from=2026-02-31')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        date_from: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects reversed date ranges before querying holidays', async () => {
    const response = (await GET(createGetRequest('?date_from=2026-04-20&date_to=2026-04-01')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        date_to: ['date_to は date_from 以降を指定してください'],
      },
    });
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank site filters before querying holidays', async () => {
    const response = (await GET(createGetRequest('?site_id=%20%20')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw holiday lookup failures', async () => {
    businessHolidayFindManyMock.mockRejectedValueOnce(
      new Error('raw business holiday lookup failure for site_1'),
    );

    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw business holiday lookup failure for site_1');
  });

  it('creates a business holiday and records an audit log', async () => {
    const response = (await POST(
      createPostRequest({
        date: '2026-03-30',
        name: '臨時休業',
        holiday_type: 'site_closure',
        is_closed: true,
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'holiday_2', name: '臨時休業' },
    });
    expect(advisoryLockMock).toHaveBeenCalled();
    expect(businessHolidayCreateMock).toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalled();
  });

  it('serializes duplicate creation inside the transaction and skips the insert (TOCTOU guard)', async () => {
    // 同時作成レース: advisory lock 取得後の tx 内再チェックで既存行が見つかった場合は
    // create せず 400 を返す。tx 外 read→create の窓を塞いだことの回帰確認。
    businessHolidayFindFirstMock.mockResolvedValue({ id: 'holiday_existing' });

    const response = (await POST(
      createPostRequest({
        date: '2026-03-30',
        name: '臨時休業',
        holiday_type: 'site_closure',
        is_closed: true,
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ日の休日設定が既に存在します',
    });
    // advisory lock は tx 内・存在チェック前に取得されている。
    expect(advisoryLockMock).toHaveBeenCalledTimes(1);
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'business_holiday_dedup',
      'org_1::2026-03-30:site_closure',
    );
    // 存在チェックは prisma ではなく tx クライアント上で行われる。
    expect(businessHolidayFindFirstMock).toHaveBeenCalled();
    expect(businessHolidayCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before reference validation or duplicate lookup', async () => {
    const response = (await POST(createPostRequest([])))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(businessHolidayFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(businessHolidayCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before reference validation or duplicate lookup', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(businessHolidayFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(businessHolidayCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
