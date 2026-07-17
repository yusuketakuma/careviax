import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importHotMasterMock,
  previewHotMasterMock,
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
    importHotMasterMock: vi.fn(),
    previewHotMasterMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/hot', () => ({
  importHotMaster: importHotMasterMock,
  previewHotMaster: previewHotMasterMock,
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

describe('/api/drug-master-imports/hot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importHotMasterMock.mockResolvedValue({
      log: {
        id: 'log_1',
        status: 'success',
        source_file_hash: 'hot_source_hash',
        source_published_at: new Date('2026-06-11T00:00:00.000Z'),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 42,
          imported_records: 40,
          skipped_missing_yj: 2,
        },
      },
      importedCount: 42,
      packageImportedCount: 17,
      fileUrl: 'https://www.medis.or.jp/hot.csv',
    });
    previewHotMasterMock.mockResolvedValue({
      dryRun: true,
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      sourceFileHash: 'hot_source_hash',
      sourcePublishedAt: '2026-06-11T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 42,
          drug_master_upsert_count: 40,
          package_upsert_count: 17,
          skipped_missing_yj: 2,
          skipped_invalid_yj: 1,
          skipped_invalid_package_code: 3,
          skipped_package_conflict_count: 1,
          sampled_rows: 2,
        },
        rows: [
          {
            hot_code: '1234567890123',
            yj_code: '1124001F1022',
            drug_name: 'ユーロジン１ｍｇ錠',
            drug_master_action: 'upsert',
            package_action: 'upsert',
            gtin: '04900000000000',
            jan_code: '4900000000000',
            package_quantity: '100',
            package_quantity_unit: '錠',
            manufacturer: 'Ｔ’ｓ販売',
          },
          {
            hot_code: '2234567890123',
            yj_code: 'NOT_A_YJ',
            drug_name: '不正YJ薬',
            drug_master_action: 'skip_invalid_yj',
            package_action: 'none',
            gtin: null,
            jan_code: null,
            package_quantity: null,
            package_quantity_unit: null,
            manufacturer: '不正販売',
          },
        ],
      },
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
    expect(previewHotMasterMock).not.toHaveBeenCalled();
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
    expect(previewHotMasterMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for default import options', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importHotMasterMock).toHaveBeenCalledWith(prismaMock, {});
    expect(previewHotMasterMock).not.toHaveBeenCalled();
  });

  it('imports the HOT master', async () => {
    const response = await POST(
      createJsonRequest({
        fileUrl: 'https://www.medis.or.jp/hot.csv',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      }),
      expect.any(Function),
    );
    expect(importHotMasterMock).toHaveBeenCalledWith(prismaMock, {
      fileUrl: 'https://www.medis.or.jp/hot.csv',
    });
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    expect(importHotMasterMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSearchCacheMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateDetailCacheMock.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        logId: 'log_1',
        importedCount: 42,
        packageImportedCount: 17,
        sourceFileHash: 'hot_source_hash',
        sourcePublishedAt: '2026-06-11T00:00:00.000Z',
        importMode: 'full',
        changeSummary: {
          mode: 'full',
          parsed_records: 42,
          imported_records: 40,
          skipped_missing_yj: 2,
        },
      },
    });
  });

  it('returns a HOT dry-run preview without executing the import', async () => {
    const response = await POST(
      createJsonRequest({
        fileUrl: 'https://www.medis.or.jp/hot.csv',
        dryRun: true,
        previewLimit: 1,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(previewHotMasterMock).toHaveBeenCalledWith(prismaMock, {
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      previewLimit: 1,
    });
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        dryRun: true,
        sourceFileHash: 'hot_source_hash',
        preview: {
          summary: {
            parsed_records: 42,
            drug_master_upsert_count: 40,
            package_upsert_count: 17,
            skipped_invalid_yj: 1,
            skipped_package_conflict_count: 1,
            sampled_rows: 2,
          },
          rows: [
            {
              hot_code: '1234567890123',
              drug_master_action: 'upsert',
              package_action: 'upsert',
            },
            {
              hot_code: '2234567890123',
              yj_code: 'NOT_A_YJ',
              drug_master_action: 'skip_invalid_yj',
              package_action: 'none',
            },
          ],
        },
      },
    });
  });

  it('keeps normal import behavior when dryRun is explicitly false', async () => {
    const response = await POST(
      createJsonRequest({
        dryRun: false,
        previewLimit: 100,
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importHotMasterMock).toHaveBeenCalledWith(prismaMock, {});
    expect(previewHotMasterMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-boolean dryRun', { dryRun: 'true' }],
    ['negative previewLimit', { dryRun: true, previewLimit: -1 }],
    ['too large previewLimit', { dryRun: true, previewLimit: 101 }],
    ['fractional previewLimit', { dryRun: true, previewLimit: 1.5 }],
    ['string previewLimit', { dryRun: true, previewLimit: '1' }],
  ])('rejects invalid preview parameters: %s', async (_label, body) => {
    const response = await POST(createJsonRequest(body));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
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
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it.each([
    'http://www.medis.or.jp/hot.csv',
    'https://example.com/hot.csv',
    'https://localhost/hot.csv',
    'https://127.0.0.1/hot.csv',
  ])('rejects disallowed HOT source URL %s before external work', async (fileUrl) => {
    const response = await POST(createJsonRequest({ fileUrl }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns no-store 401 before reading the body when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);
    const request = createMalformedJsonRequest();

    const response = await POST(request);

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });
    const request = createMalformedJsonRequest();

    const response = await POST(request);

    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品マスター取込は管理者のみ実行できます',
    });
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw HOT auth URL token secret');
    unsafeError.name = 'HotImportAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);
    const request = createMalformedJsonRequest();

    const response = await POST(request);
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(requestId).toBeTruthy();
    expect(correlationId).toBe(requestId);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/hot',
        method: 'POST',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('token');
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(
      'HotImportAuthSecretError',
    );
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
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/hot',
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
    expect(logged).not.toContain('hot import secret');
    expect(logged).not.toContain('HotImportSecretError');
  });

  it('returns a sanitized no-store 500 when HOT preview fails unexpectedly', async () => {
    const unsafeError = new Error('raw hot preview secret');
    unsafeError.name = 'HotPreviewSecretError';
    previewHotMasterMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ dryRun: true }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('hot preview secret');
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/hot',
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
    expect(logged).not.toContain('hot preview secret');
    expect(logged).not.toContain('HotPreviewSecretError');
  });

  it('rethrows authentication control flow without logging or side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });
    const request = createMalformedJsonRequest();

    await expect(POST(request)).rejects.toBe(controlFlowError);

    expect(request.bodyUsed).toBe(false);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importHotMasterMock).not.toHaveBeenCalled();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('rethrows import control flow without shared logging or cache invalidation', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    importHotMasterMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(POST(createJsonRequest({}))).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(previewHotMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });
});
