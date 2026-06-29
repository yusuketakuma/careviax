import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, prismaMock, importSskDrugMasterMock, loggerErrorMock } =
  vi.hoisted(() => {
    const membershipFindFirstMock = vi.fn();
    return {
      authMock: vi.fn(),
      membershipFindFirstMock,
      prismaMock: {
        membership: {
          findFirst: membershipFindFirstMock,
        },
      },
      importSskDrugMasterMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/ssk', () => ({
  importSskDrugMaster: importSskDrugMasterMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/ssk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"zipUrl":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/ssk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importSskDrugMasterMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 120,
      entryName: 'master.csv',
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
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
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith(prismaMock, {});
  });

  it('imports the SSK master and returns the import summary', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        limit: 100,
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith(prismaMock, {
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
      limit: 100,
    });
  });

  it('rejects credential-bearing ZIP URLs without echoing credentials', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://importer:secret@www.ssk.or.jp/ssk.zip',
        limit: 100,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(createJsonRequest({ limit: 100 }));

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when SSK import fails unexpectedly', async () => {
    const unsafeError = new Error('raw ssk import secret');
    unsafeError.name = 'SskImportSecretError';
    importSskDrugMasterMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ limit: 100 }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('ssk import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_ssk_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_ssk_post_unhandled_error',
        route: '/api/drug-master-imports/ssk',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('ssk import secret');
    expect(logged).not.toContain('SskImportSecretError');
  });
});
