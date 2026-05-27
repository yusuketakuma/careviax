import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { drugMasterImportLogFindManyMock } = vi.hoisted(() => ({
  drugMasterImportLogFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
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

describe('/api/drug-master-import-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterImportLogFindManyMock.mockResolvedValue([
      { id: 'log_1', source: 'ssk', status: 'success' },
    ]);
  });

  it('clamps limit and returns latest import logs', async () => {
    const response = (await GET({
      url: 'http://localhost/api/drug-master-import-logs?limit=100',
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expect(drugMasterImportLogFindManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 50,
      select: expect.any(Object),
    });
  });

  it('filters import logs by valid source and status', async () => {
    const response = (await GET({
      url: 'http://localhost/api/drug-master-import-logs?source=pmda&status=failed&limit=20',
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expect(drugMasterImportLogFindManyMock).toHaveBeenCalledWith({
      where: { source: 'pmda', status: 'failed' },
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: expect.any(Object),
    });
  });

  it('ignores invalid filter values', async () => {
    await GET({
      url: 'http://localhost/api/drug-master-import-logs?source=unknown&status=deleted',
    } as NextRequest, { params: Promise.resolve({}) });

    expect(drugMasterImportLogFindManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 10,
      select: expect.any(Object),
    });
  });
});
