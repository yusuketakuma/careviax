import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, withAuthContextMock, listDataExplorerRowsMock } = vi.hoisted(() => {
  const requireAuthContextMock = vi.fn();
  const withAuthContextMock = vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ table: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) => {
      return async (req: NextRequest, routeContext: { params: Promise<{ table: string }> }) => {
        const authResult = await requireAuthContextMock(req, options);
        let response: Response;
        if (authResult && typeof authResult === 'object' && 'response' in authResult) {
          response = authResult.response;
        } else {
          try {
            response = await handler(req, authResult.ctx, routeContext);
          } catch {
            response = new Response(
              JSON.stringify({
                code: 'INTERNAL_ERROR',
                message: 'サーバー内部でエラーが発生しました',
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', '00000000-0000-4000-8000-000000000001');
        response.headers.set(
          'X-Correlation-Id',
          req.headers.get('x-correlation-id') ?? '00000000-0000-4000-8000-000000000001',
        );
        return response;
      };
    },
  );

  return {
    requireAuthContextMock,
    withAuthContextMock,
    listDataExplorerRowsMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  DATA_EXPLORER_MAX_OFFSET: 999_900,
  listDataExplorerRows: listDataExplorerRowsMock,
}));

import { GET } from './route';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/data-explorer/Patient${query}`, {
    headers: { 'x-correlation-id': 'data_explorer_table_test' },
  });
}

describe('/api/admin/data-explorer/[table] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      rateLimit: { allowed: true, remaining: 99, resetAt: Date.now() + 1000 },
    });
    listDataExplorerRowsMock.mockResolvedValue({
      tableName: 'Patient',
      rows: [{ id: 'patient_1' }],
      columns: [],
      totalCount: 1,
      limit: 25,
      offset: 0,
    });
  });

  it('returns explorer rows for the selected table', async () => {
    const request = createRequest('?limit=10&search=花子');
    const response = await GET(request, {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_table_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(request, {
      permission: 'canAdmin',
      message: 'データ探索画面の利用権限がありません',
    });
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      search: '花子',
    });
  });

  it('returns a protected denial without querying explorer rows', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_table_test');
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized 500 with no-store headers when the explorer query throws', async () => {
    const rawError = 'raw data-explorer read failure';
    listDataExplorerRowsMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_table_test');

    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
  });

  it('passes through validated offset parameters', async () => {
    const response = await GET(createRequest('?limit=10&offset=20'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(200);
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      offset: 20,
      search: undefined,
    });
  });

  it('rejects malformed and oversized pagination parameters before querying rows', async () => {
    const response = await GET(createRequest('?limit=1e2&offset=999999999'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['limit', '?limit=10&limit=25'],
    ['offset', '?offset=0&offset=20'],
    ['search', '?search=花子&search=太郎'],
  ])('rejects duplicate %s query parameters before querying rows', async (fieldName, query) => {
    const response = await GET(createRequest(query), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリが不正です',
      details: {
        [fieldName]: [`${fieldName} は1つだけ指定してください`],
      },
    });
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('rejects oversized search terms before querying rows', async () => {
    const response = await GET(createRequest(`?search=${'あ'.repeat(101)}`), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリが不正です',
      details: {
        search: ['search は100文字以内で指定してください'],
      },
    });
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('returns validation error for unknown tables', async () => {
    listDataExplorerRowsMock.mockRejectedValue(new Error('Unknown table: NoSuchTable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ table: 'NoSuchTable' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
