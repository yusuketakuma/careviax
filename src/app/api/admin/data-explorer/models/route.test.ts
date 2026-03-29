import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
    const response = await GET({} as NextRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ tableName: 'Patient', rowCount: 12 }],
    });
    expect(listDataExplorerModelsMock).toHaveBeenCalledWith('org_1');
  });
});
