import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importPmdaPackageInsertsMock,
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
    importPmdaPackageInsertsMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/pmda', () => ({
  importPmdaPackageInserts: importPmdaPackageInsertsMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/pmda', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/pmda', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/pmda', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"zipUrl":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/pmda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importPmdaPackageInsertsMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 88,
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
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
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default full import options', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importPmdaPackageInsertsMock).toHaveBeenCalledWith(prismaMock, { mode: 'full' });
  });

  it('imports PMDA package inserts', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://www.pmda.go.jp/pmda.zip',
        mode: 'delta',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importPmdaPackageInsertsMock).toHaveBeenCalledWith(prismaMock, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
    });
  });

  it('rejects credential-bearing ZIP URLs without echoing credentials', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://importer:secret@www.pmda.go.jp/pmda.zip',
        mode: 'delta',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://importer:secret@www.pmda.go.jp/pmda.zip',
        mode: 'delta',
      }),
    );

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PMDA import fails unexpectedly', async () => {
    const unsafeError = new Error('raw pmda import secret');
    unsafeError.name = 'PmdaImportSecretError';
    importPmdaPackageInsertsMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ mode: 'delta' }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('pmda import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_pmda_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_pmda_post_unhandled_error',
        route: '/api/drug-master-imports/pmda',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('pmda import secret');
    expect(logged).not.toContain('PmdaImportSecretError');
  });
});
