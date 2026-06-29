import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, auditLogCreateMock, findManyMock, loggerErrorMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    findManyMock: vi.fn(),
    loggerErrorMock: vi.fn(),
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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-import-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    findManyMock.mockResolvedValue([{ id: 'log_1', source: 'ssk', status: 'completed' }]);
  });

  it('returns no-store 401 before querying import logs when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before querying import logs when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('accepts padded canonical limits and returns latest import logs with no-store headers', async () => {
    const response = await GET(createRequest('?limit=%2050%20'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 50,
      select: expect.any(Object),
    });
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
  });

  it('returns a sanitized no-store 500 when import log lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw import log token secret');
    unsafeError.name = 'DrugMasterImportLogSecretError';
    findManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('token secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_import_logs_get_unhandled_error',
      undefined,
      {
        event: 'drug_master_import_logs_get_unhandled_error',
        route: '/api/drug-master-import-logs',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('token secret');
    expect(logged).not.toContain('DrugMasterImportLogSecretError');
  });
});
