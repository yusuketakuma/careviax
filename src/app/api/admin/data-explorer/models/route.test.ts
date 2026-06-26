import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, listDataExplorerModelsMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  listDataExplorerModelsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  listDataExplorerModels: listDataExplorerModelsMock,
}));

import { GET } from './route';

const createRequest = () => new NextRequest('http://localhost/api/admin/data-explorer/models');

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
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [{ tableName: 'Patient', rowCount: 12 }],
    });
    expect(listDataExplorerModelsMock).toHaveBeenCalledWith('org_1');
  });

  it('returns a sanitized 500 with no-store headers when the read fails', async () => {
    listDataExplorerModelsMock.mockRejectedValueOnce(
      new Error('raw data-explorer/models read failure'),
    );

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('raw data-explorer/models read failure');
  });
});
