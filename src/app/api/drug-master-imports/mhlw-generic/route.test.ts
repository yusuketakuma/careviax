import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { importMhlwGenericFlagsMock, importGenericNameMappingsMock } = vi.hoisted(() => ({
  importMhlwGenericFlagsMock: vi.fn(),
  importGenericNameMappingsMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/mhlw', () => ({
  importMhlwGenericFlags: importMhlwGenericFlagsMock,
  importGenericNameMappings: importGenericNameMappingsMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"mode":',
  });
}

describe('/api/drug-master-imports/mhlw-generic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importMhlwGenericFlagsMock.mockResolvedValue({
      log: { id: 'log_flags', status: 'success' },
      importedCount: 10,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
    });
    importGenericNameMappingsMock.mockResolvedValue({
      log: { id: 'log_mappings', status: 'success' },
      importedCount: 20,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default all-mode import options', async () => {
    const response = (await POST(createEmptyRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(201);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalledWith({}, { workbookUrl: undefined });
    expect(importGenericNameMappingsMock).toHaveBeenCalledWith({}, { workbookUrl: undefined });
  });

  it('imports both generic flags and mappings in all mode', async () => {
    const response = (await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalled();
    expect(importGenericNameMappingsMock).toHaveBeenCalled();
  });

  it('rejects credential-bearing workbook URLs without echoing credentials', async () => {
    const response = (await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      }),
      { params: Promise.resolve({}) },
    ))!;
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });
});
