import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, withAuthContextMock, listDataExplorerModelsMock } = vi.hoisted(
  () => {
    const requireAuthContextMock = vi.fn();
    const withAuthContextMock = vi.fn(
      (
        handler: (
          req: NextRequest,
          ctx: { orgId: string; userId: string; role: string },
          routeContext: { params: Promise<Record<string, string>> },
        ) => Promise<Response>,
        options: unknown,
      ) => {
        return async (
          req: NextRequest,
          routeContext: { params: Promise<Record<string, string>> },
        ) => {
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
      listDataExplorerModelsMock: vi.fn(),
    };
  },
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  listDataExplorerModels: listDataExplorerModelsMock,
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const createRequest = () =>
  new NextRequest('http://localhost/api/admin/data-explorer/models', {
    headers: { 'x-correlation-id': 'data_explorer_models_test' },
  });

describe('/api/admin/data-explorer/models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      rateLimit: { allowed: true, remaining: 99, resetAt: Date.now() + 1000 },
    });
    listDataExplorerModelsMock.mockResolvedValue([
      { tableName: 'Patient', rowCount: 12, coverageCategory: 'frontend_api' },
    ]);
  });

  it('returns explorer model summaries', async () => {
    const request = createRequest();
    const response = await GET(request, emptyRouteContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_models_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(request, {
      permission: 'canAdmin',
      message: 'データ探索画面の利用権限がありません',
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ tableName: 'Patient', rowCount: 12 }],
    });
    expect(listDataExplorerModelsMock).toHaveBeenCalledWith('org_1');
  });

  it('returns a protected denial without reading model summaries', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_models_test');
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized 500 with no-store headers when the read fails', async () => {
    listDataExplorerModelsMock.mockRejectedValueOnce(
      new Error('raw data-explorer/models read failure'),
    );

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('data_explorer_models_test');

    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('raw data-explorer/models read failure');
  });
});
