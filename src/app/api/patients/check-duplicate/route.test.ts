import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authContextMock, authFailureResponseMock, patientFindManyMock } = vi.hoisted(() => ({
  authContextMock: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist' as const,
  },
  authFailureResponseMock: vi.fn<() => Response | null>(),
  patientFindManyMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      authFailureResponseMock() ?? handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

import { GET } from './route';

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/patients/check-duplicate${search}`);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/check-duplicate GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFailureResponseMock.mockReturnValue(null);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
        birth_date: new Date('1950-01-01'),
        gender: 'male',
      },
    ]);
  });

  it('returns validation error for missing required query params', async () => {
    const response = (await GET(createGetRequest('?name=山田'), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
      details: {
        date_of_birth: ['date_of_birth は必須です'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('searches duplicates by name, birth date, and gender', async () => {
    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=male'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        name: {
          contains: '山田',
          mode: 'insensitive',
        },
        birth_date: new Date('1950-01-01'),
        gender: 'male',
      },
      select: {
        id: true,
        name: true,
        name_kana: true,
        birth_date: true,
        gender: true,
      },
      take: 10,
    });
    const body = await response.json();
    expect(body.duplicates[0]).toMatchObject({
      id: 'patient_1',
      name: '山田 太郎',
      gender: 'male',
    });
    expect(body.duplicates[0]).not.toHaveProperty('name_kana');
  });

  it('adds sensitive no-store headers to auth failures', async () => {
    authFailureResponseMock.mockReturnValueOnce(
      Response.json({ code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' }, { status: 401 }),
    );

    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=male'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed sensitive no-store error when duplicate lookup fails', async () => {
    patientFindManyMock.mockRejectedValueOnce(new Error('raw duplicate lookup failure'));

    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=male'),
      emptyRouteContext,
    ))!;
    const body = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('raw duplicate lookup failure');
  });

  it.each([
    [
      'duplicate name',
      '?name=山田&name=佐藤&date_of_birth=1950-01-01&gender=male',
      { name: ['name は1つだけ指定してください'] },
    ],
    ['blank name', '?name=%20&date_of_birth=1950-01-01&gender=male', { name: ['name は必須です'] }],
    [
      'too long name',
      `?name=${'山'.repeat(101)}&date_of_birth=1950-01-01&gender=male`,
      { name: ['name の形式が不正です'] },
    ],
    [
      'padded name',
      '?name=%20山田&date_of_birth=1950-01-01&gender=male',
      { name: ['name の形式が不正です'] },
    ],
    [
      'duplicate birth date',
      '?name=山田&date_of_birth=1950-01-01&date_of_birth=1950-01-02&gender=male',
      { date_of_birth: ['date_of_birth は1つだけ指定してください'] },
    ],
    [
      'blank gender',
      '?name=山田&date_of_birth=1950-01-01&gender=',
      { gender: ['gender は必須です'] },
    ],
  ])(
    'rejects malformed %s query before checking duplicates',
    async (_caseName, search, details) => {
      const response = (await GET(createGetRequest(search), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '検索条件が不正です',
        details,
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('returns validation error for unsupported gender before querying patients', async () => {
    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=unknown'),
      emptyRouteContext,
    ))!;
    const body = await response.json();

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.gender).toEqual(['対応していない性別です']);
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects impossible birth dates before querying patients', async () => {
    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-02-31&gender=male'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'date_of_birth の形式が不正です',
      details: {
        date_of_birth: ['YYYY-MM-DD 形式で指定してください'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });
});
