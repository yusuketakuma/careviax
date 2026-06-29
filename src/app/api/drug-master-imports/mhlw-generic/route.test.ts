import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importMhlwGenericFlagsMock,
  importGenericNameMappingsMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const membershipFindFirstMock = vi.fn();
  return {
    authMock: vi.fn(),
    membershipFindFirstMock,
    prismaMock: {
      membership: {
        findFirst: membershipFindFirstMock,
      },
    },
    importMhlwGenericFlagsMock: vi.fn(),
    importGenericNameMappingsMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock('@/server/services/drug-master-import/mhlw', () => ({
  importMhlwGenericFlags: importMhlwGenericFlagsMock,
  importGenericNameMappings: importGenericNameMappingsMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-generic', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"mode":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/mhlw-generic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
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
    const response = await POST(createJsonRequest([]));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default all-mode import options', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: undefined,
    });
    expect(importGenericNameMappingsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: undefined,
    });
  });

  it('imports both generic flags and mappings in all mode', async () => {
    const response = await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalled();
    expect(importGenericNameMappingsMock).toHaveBeenCalled();
  });

  it('rejects credential-bearing workbook URLs without echoing credentials', async () => {
    const response = await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      }),
    );

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when MHLW generic import fails unexpectedly', async () => {
    const unsafeError = new Error('raw mhlw generic import secret');
    unsafeError.name = 'MhlwGenericImportSecretError';
    importGenericNameMappingsMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ mode: 'all' }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('mhlw generic import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_mhlw_generic_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_mhlw_generic_post_unhandled_error',
        route: '/api/drug-master-imports/mhlw-generic',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('mhlw generic import secret');
    expect(logged).not.toContain('MhlwGenericImportSecretError');
  });
});
