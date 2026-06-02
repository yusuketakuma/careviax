import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { importSskDrugMasterMock } = vi.hoisted(() => ({
  importSskDrugMasterMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/ssk', () => ({
  importSskDrugMaster: importSskDrugMasterMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"zipUrl":',
  });
}

describe('/api/drug-master-imports/ssk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importSskDrugMasterMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 120,
      entryName: 'master.csv',
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
    });
  });

  it('rejects non-object JSON payloads before import execution', async () => {
    const response = (await POST(createJsonRequest([]), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = (await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = (await POST(createEmptyRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(201);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith({}, {});
  });

  it('imports the SSK master and returns the import summary', async () => {
    const response = (await POST(
      createJsonRequest({
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        limit: 100,
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith(
      {},
      {
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        limit: 100,
      },
    );
  });

  it('rejects credential-bearing ZIP URLs without echoing credentials', async () => {
    const response = (await POST(
      createJsonRequest({
        zipUrl: 'https://importer:secret@www.ssk.or.jp/ssk.zip',
        limit: 100,
      }),
      { params: Promise.resolve({}) },
    ))!;
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });
});
