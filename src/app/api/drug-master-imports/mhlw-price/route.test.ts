import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importMhlwPriceListMock,
  previewMhlwPriceListMock,
  loggerErrorMock,
  invalidateSearchCacheMock,
  invalidateDetailCacheMock,
  clearRequestAuthContextMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
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
    importMhlwPriceListMock: vi.fn(),
    previewMhlwPriceListMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    invalidateSearchCacheMock: vi.fn(),
    invalidateDetailCacheMock: vi.fn(),
    clearRequestAuthContextMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    unstableRethrowMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: clearRequestAuthContextMock,
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

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
  previewMhlwPriceList: previewMhlwPriceListMock,
}));

vi.mock('@/server/services/drug-master-search-cache', () => ({
  invalidateDrugMasterSearchCache: invalidateSearchCacheMock,
}));

vi.mock('@/server/services/drug-master-detail-cache', () => ({
  invalidateDrugMasterDetailCache: invalidateDetailCacheMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

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

describe('/api/drug-master-imports/mhlw-price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importMhlwPriceListMock.mockResolvedValue({
      log: {
        id: 'log_1',
        status: 'success',
        source_file_hash: 'mhlw_price_source_hash',
        source_published_at: new Date('2026-05-20T00:00:00.000Z'),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          workbook_count: 1,
          parsed_records: 55,
          imported_records: 55,
          skipped_invalid_yj: 0,
        },
      },
      importedCount: 55,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      workbookUrls: ['https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx'],
    });
    previewMhlwPriceListMock.mockResolvedValue({
      dryRun: true,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      workbookUrls: ['https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx'],
      sourceFileHash: 'mhlw_price_source_hash',
      sourcePublishedAt: '2026-05-20T00:00:00.000Z',
      preview: {
        summary: {
          workbook_count: 1,
          parsed_records: 55,
          drug_master_upsert_count: 55,
          skipped_invalid_yj: 0,
          records_with_change_event: 2,
          change_event_count: 3,
          sampled_rows: 1,
        },
        rows: [
          {
            yj_code: '1124001F1022',
            drug_name: 'ユーロジン１ｍｇ錠',
            action: 'upsert',
            change_event_types: ['price_changed'],
            previous_drug_price: '6.30',
            next_drug_price: '7.1',
            previous_transitional_expiry_date: null,
            next_transitional_expiry_date: null,
          },
        ],
      },
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
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
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
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = await POST(createEmptyPostRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {});
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('imports the MHLW price workbook', async () => {
    const response = await POST(
      createPostRequest({
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
    });
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    expect(importMhlwPriceListMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSearchCacheMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateDetailCacheMock.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        logId: 'log_1',
        status: 'success',
        importedCount: 55,
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        workbookUrls: ['https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx'],
        sourceFileHash: 'mhlw_price_source_hash',
        sourcePublishedAt: '2026-05-20T00:00:00.000Z',
        importMode: 'full',
        changeSummary: {
          mode: 'full',
          workbook_count: 1,
          parsed_records: 55,
          imported_records: 55,
          skipped_invalid_yj: 0,
        },
      },
    });
  });

  it('returns a MHLW price dry-run preview without executing the import', async () => {
    const response = await POST(
      createPostRequest({
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        dryRun: true,
        previewLimit: 1,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(previewMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      previewLimit: 1,
    });
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        dryRun: true,
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        workbookUrls: ['https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx'],
        sourceFileHash: 'mhlw_price_source_hash',
        preview: {
          summary: {
            workbook_count: 1,
            parsed_records: 55,
            drug_master_upsert_count: 55,
            skipped_invalid_yj: 0,
            records_with_change_event: 2,
            change_event_count: 3,
            sampled_rows: 1,
          },
          rows: [
            {
              yj_code: '1124001F1022',
              action: 'upsert',
              change_event_types: ['price_changed'],
            },
          ],
        },
      },
    });
  });

  it('keeps normal import behavior when dryRun is explicitly false', async () => {
    const response = await POST(
      createPostRequest({
        dryRun: false,
        previewLimit: 100,
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(prismaMock, {});
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-boolean dryRun', { dryRun: 'true' }],
    ['negative previewLimit', { dryRun: true, previewLimit: -1 }],
    ['too large previewLimit', { dryRun: true, previewLimit: 101 }],
    ['fractional previewLimit', { dryRun: true, previewLimit: 1.5 }],
    ['string previewLimit', { dryRun: true, previewLimit: '1' }],
  ])('rejects invalid preview parameters: %s', async (_label, body) => {
    const response = await POST(createPostRequest(body));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
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
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
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
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });
    const request = createMalformedJsonPostRequest();

    const response = await POST(request);

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns no-store 401 before reading the body when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);
    const request = createMalformedJsonPostRequest();

    const response = await POST(request);

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(previewMhlwPriceListMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw MHLW price auth workbook token secret');
    unsafeError.name = 'MhlwPriceAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);
    const request = createMalformedJsonPostRequest();

    const response = await POST(request);
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(requestId).toBeTruthy();
    expect(correlationId).toBe(requestId);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/mhlw-price',
        method: 'POST',
        requestId,
        correlationId,
      },
      unsafeError,
    );
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
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/mhlw-price',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('mhlw price import secret');
    expect(logged).not.toContain('MhlwPriceImportSecretError');
  });

  it('returns a sanitized no-store 500 when MHLW price preview fails unexpectedly', async () => {
    const unsafeError = new Error('raw mhlw price preview secret');
    unsafeError.name = 'MhlwPricePreviewSecretError';
    previewMhlwPriceListMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createPostRequest({ dryRun: true }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('mhlw price preview secret');
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/mhlw-price',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('mhlw price preview secret');
    expect(logged).not.toContain('MhlwPricePreviewSecretError');
  });

  it('rethrows authentication control flow without logging or side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });
    const request = createMalformedJsonPostRequest();

    await expect(POST(request)).rejects.toBe(controlFlowError);

    expect(request.bodyUsed).toBe(false);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('rethrows import control flow without shared logging or cache invalidation', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    importMhlwPriceListMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(POST(createPostRequest({}))).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });
});
