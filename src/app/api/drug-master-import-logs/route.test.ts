import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { drugMasterImportLogFindManyMock } = vi.hoisted(() => ({
  drugMasterImportLogFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMasterImportLog: {
      findMany: drugMasterImportLogFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/drug-master-import-logs${search}`);
}

describe('/api/drug-master-import-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterImportLogFindManyMock.mockResolvedValue([
      { id: 'log_1', source: 'ssk', status: 'success' },
    ]);
  });

  it('accepts padded canonical limits and returns latest import logs', async () => {
    const response = (await GET(createRequest('?limit=%2050%20'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(drugMasterImportLogFindManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 50,
      select: expect.any(Object),
    });
  });

  it.each(['', '20abc', '1e1', '10.5', '0', '100'])(
    'rejects malformed limit=%s before querying import logs',
    async (limit) => {
      const response = (await GET(createRequest(`?limit=${encodeURIComponent(limit)}`), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('filters import logs by valid source and status', async () => {
    const response = (await GET(createRequest('?source=pmda&status=failed&limit=20'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(drugMasterImportLogFindManyMock).toHaveBeenCalledWith({
      where: { source: 'pmda', status: 'failed' },
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: expect.any(Object),
    });
  });

  it('returns 400 before querying when the source filter is invalid', async () => {
    const response = await GET(createRequest('?source=unknown'), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: ['対応していない取込ソースです'],
      },
    });
    expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
  });

  it('returns 400 before querying when the status filter is invalid', async () => {
    const response = await GET(createRequest('?status=deleted'), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していない取込ステータスです'],
      },
    });
    expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
  });
});
