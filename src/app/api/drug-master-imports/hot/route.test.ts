import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, prismaMock, importHotMasterMock, loggerErrorMock } =
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
      importHotMasterMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/hot', () => ({
  importHotMaster: importHotMasterMock,
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/hot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/hot', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/hot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"fileUrl":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/hot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importHotMasterMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 42,
      fileUrl: 'https://www.medis.or.jp/hot.csv',
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
    expect(importHotMasterMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importHotMasterMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importHotMasterMock).toHaveBeenCalledWith(prismaMock, {});
  });

  it('imports the HOT master', async () => {
    const response = await POST(
      createJsonRequest({
        fileUrl: 'https://www.medis.or.jp/hot.csv',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importHotMasterMock).toHaveBeenCalledWith(prismaMock, {
      fileUrl: 'https://www.medis.or.jp/hot.csv',
    });
  });

  it('rejects credential-bearing file URLs without echoing credentials', async () => {
    const response = await POST(
      createJsonRequest({
        fileUrl: 'https://importer:secret@www.medis.or.jp/hot.csv',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(
      createJsonRequest({
        fileUrl: 'https://importer:secret@www.medis.or.jp/hot.csv',
      }),
    );

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(importHotMasterMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when HOT import fails unexpectedly', async () => {
    const unsafeError = new Error('raw hot import secret');
    unsafeError.name = 'HotImportSecretError';
    importHotMasterMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({}));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('hot import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_hot_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_hot_post_unhandled_error',
        route: '/api/drug-master-imports/hot',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('hot import secret');
    expect(logged).not.toContain('HotImportSecretError');
  });
});
