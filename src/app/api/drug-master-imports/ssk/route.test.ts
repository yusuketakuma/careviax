import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { importSskDrugMasterMock } = vi.hoisted(() => ({
  importSskDrugMasterMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
  },
  isAdmin: (role: string) => role === 'admin',
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/drug-master-import/ssk', () => ({
  importSskDrugMaster: importSskDrugMasterMock,
}));

import { POST } from './route';

describe('/api/drug-master-imports/ssk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importSskDrugMasterMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 120,
      entryName: 'master.csv',
      zipUrl: 'https://example.com/ssk.zip',
    });
  });

  it('imports the SSK master and returns the import summary', async () => {
    const response = (await POST({
      json: async () => ({
        zipUrl: 'https://example.com/ssk.zip',
        limit: 100,
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith({}, {
      zipUrl: 'https://example.com/ssk.zip',
      limit: 100,
    });
  });
});
