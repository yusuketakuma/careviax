import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, listDataExplorerRowsMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  listDataExplorerRowsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  listDataExplorerRows: listDataExplorerRowsMock,
}));

import { GET } from './route';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/data-explorer/Patient${query}`);
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
    const response = await GET(createRequest('?limit=10&search=花子'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(200);
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      search: '花子',
    });
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
