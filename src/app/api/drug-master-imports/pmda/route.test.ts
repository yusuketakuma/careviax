import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { importPmdaPackageInsertsMock } = vi.hoisted(() => ({
  importPmdaPackageInsertsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
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

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/pmda', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/drug-master-imports/pmda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importPmdaPackageInsertsMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 88,
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
    });
  });

  it('imports PMDA package inserts', async () => {
    const response = (await POST(
      createJsonRequest({
          zipUrl: 'https://www.pmda.go.jp/pmda.zip',
          mode: 'delta',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(importPmdaPackageInsertsMock).toHaveBeenCalledWith(
      {},
      {
        zipUrl: 'https://www.pmda.go.jp/pmda.zip',
        mode: 'delta',
      },
    );
  });

  it('rejects credential-bearing ZIP URLs without echoing credentials', async () => {
    const response = (await POST(
      createJsonRequest({
          zipUrl: 'https://importer:secret@www.pmda.go.jp/pmda.zip',
          mode: 'delta',
      }),
      { params: Promise.resolve({}) },
    ))!;
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });
});
