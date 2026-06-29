import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, prismaMock, importMhlwPriceListMock, loggerErrorMock } =
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
      importMhlwPriceListMock: vi.fn(),
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
  importMhlwPriceList: importMhlwPriceListMock,
}));

import { POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-price', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createEmptyPostRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-price', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/mhlw-price', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"workbookUrl":',
  } satisfies NextRequestInit);
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/mhlw-price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importMhlwPriceListMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 55,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
    });
  });

  it('rejects non-object JSON payloads before import execution', async () => {
    const response = await POST(createPostRequest([]));

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonPostRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = await POST(createEmptyPostRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {});
  });

  it('imports the MHLW price workbook', async () => {
    const response = await POST(
      createPostRequest({
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
    });
  });

  it('rejects untrusted workbook URLs before import execution', async () => {
    const response = await POST(
      createPostRequest({
        workbookUrl: 'https://127.0.0.1/internal.xlsx',
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing workbook URLs without echoing credentials', async () => {
    const response = await POST(
      createPostRequest({
        workbookUrl: 'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(
      createPostRequest({ workbookUrl: 'https://127.0.0.1/internal.xlsx' }),
    );

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when MHLW price import fails unexpectedly', async () => {
    const unsafeError = new Error('raw mhlw price import secret');
    unsafeError.name = 'MhlwPriceImportSecretError';
    importMhlwPriceListMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createPostRequest({}));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('mhlw price import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_mhlw_price_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_mhlw_price_post_unhandled_error',
        route: '/api/drug-master-imports/mhlw-price',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('mhlw price import secret');
    expect(logged).not.toContain('MhlwPriceImportSecretError');
  });
});
