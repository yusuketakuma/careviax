import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  auditLogCreateMock,
  findManyMock,
  loggerErrorMock,
  clearRequestAuthContextMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  findManyMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  clearRequestAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: clearRequestAuthContextMock,
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      create: auditLogCreateMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    drugMasterImportLog: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function GET(req: NextRequest) {
  return rawGET(req, emptyRouteContext);
}

function createRequest(search = '', headers: Record<string, string> = { 'x-org-id': 'org_1' }) {
  return new NextRequest(`http://localhost/api/drug-master-import-logs${search}`, { headers });
}

describe('/api/drug-master-import-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    findManyMock.mockResolvedValue([
      {
        id: 'log_1',
        source: 'ssk',
        status: 'completed',
        error_log: 'authorized import details',
        source_url: 'https://example.invalid/import.csv',
        source_file_hash: 'sha256:authorized',
        change_summary: { added: 1 },
      },
    ]);
  });

  it('returns no-store 401 before querying import logs when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest('?source=unknown'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before querying import logs when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });

    const response = await GET(createRequest('?status=deleted'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品マスター取込履歴の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw auth source_url token secret');
    unsafeError.name = 'DrugMasterImportLogAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest('?source=unknown&token=secret'));

    if (!response) throw new Error('response is required');
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');
    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(requestId).toBeTruthy();
    expect(correlationId).toBe(requestId);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-import-logs',
        method: 'GET',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('token');
    expect(loggedContext).not.toContain('source_url');
    expect(loggedContext).not.toContain('DrugMasterImportLogAuthSecretError');
  });

  it('accepts padded canonical limits and returns latest import logs with no-store headers', async () => {
    const response = await GET(createRequest('?limit=%2050%20'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      }),
      expect.any(Function),
    );
    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 50,
      select: {
        id: true,
        source: true,
        imported_at: true,
        record_count: true,
        status: true,
        error_log: true,
        source_url: true,
        source_file_hash: true,
        source_published_at: true,
        import_mode: true,
        change_summary: true,
        created_at: true,
        updated_at: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          error_log: 'authorized import details',
          source_url: 'https://example.invalid/import.csv',
          source_file_hash: 'sha256:authorized',
          change_summary: { added: 1 },
        },
      ],
    });
  });

  it('allows owners with canAdmin to view import logs', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'owner', site_id: null });

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledOnce();
  });

  it.each(['', '20abc', '1e1', '10.5', '0', '100'])(
    'rejects malformed limit=%s before querying import logs',
    async (limit) => {
      const response = await GET(createRequest(`?limit=${encodeURIComponent(limit)}`));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(findManyMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).not.toHaveBeenCalled();
    },
  );

  it('filters import logs by valid source and status', async () => {
    const response = await GET(createRequest('?source=pmda&status=failed&limit=20'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { source: 'pmda', status: 'failed' },
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: expect.any(Object),
    });
  });

  it('returns no-store 400 before querying when the source filter is invalid', async () => {
    const response = await GET(createRequest('?source=unknown'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: ['対応していない取込ソースです'],
      },
    });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns no-store 400 before querying when the status filter is invalid', async () => {
    const response = await GET(createRequest('?status=deleted'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していない取込ステータスです'],
      },
    });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when import log lookup fails unexpectedly', async () => {
    const unsafeError = new Error(
      'raw import log token secret source_url=https://example.invalid/import.csv?token=secret error_log=raw stack token',
    );
    unsafeError.name = 'DrugMasterImportLogSecretError';
    findManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('token secret');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-import-logs',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('token secret');
    expect(loggedContext).not.toContain('DrugMasterImportLogSecretError');
    expect(loggedContext).not.toContain('source_url');
    expect(loggedContext).not.toContain('error_log');
    expect(loggedContext).not.toContain('https://example.invalid');
    expect(loggedContext).not.toContain('raw stack token');
  });

  it('rethrows authentication control flow without logging or query work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest('?source=unknown'))).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control flow without shared logging', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    findManyMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest())).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
  });
});
