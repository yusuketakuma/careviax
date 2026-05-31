import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { importHotMasterMock } = vi.hoisted(() => ({
  importHotMasterMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/hot', () => ({
  importHotMaster: importHotMasterMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/hot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/drug-master-imports/hot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importHotMasterMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 42,
      fileUrl: 'https://www.medis.or.jp/hot.csv',
    });
  });

  it('imports the HOT master', async () => {
    const response = (await POST(
      createJsonRequest({
          fileUrl: 'https://www.medis.or.jp/hot.csv',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(importHotMasterMock).toHaveBeenCalledWith(
      {},
      {
        fileUrl: 'https://www.medis.or.jp/hot.csv',
      },
    );
  });

  it('rejects credential-bearing file URLs without echoing credentials', async () => {
    const response = (await POST(
      createJsonRequest({
          fileUrl: 'https://importer:secret@www.medis.or.jp/hot.csv',
      }),
      { params: Promise.resolve({}) },
    ))!;
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });
});
