import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { importPmdaPackageInsertsMock } = vi.hoisted(() => ({
  importPmdaPackageInsertsMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/pmda', () => ({
  importPmdaPackageInserts: importPmdaPackageInsertsMock,
}));

import { POST } from './route';

describe('/api/drug-master-imports/pmda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importPmdaPackageInsertsMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 88,
      zipUrl: 'https://example.com/pmda.zip',
      mode: 'delta',
    });
  });

  it('imports PMDA package inserts', async () => {
    const response = (await POST({
      json: async () => ({
        zipUrl: 'https://example.com/pmda.zip',
        mode: 'delta',
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(importPmdaPackageInsertsMock).toHaveBeenCalledWith({}, {
      zipUrl: 'https://example.com/pmda.zip',
      mode: 'delta',
    });
  });
});
