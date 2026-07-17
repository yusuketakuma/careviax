import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importMhlwGenericFlagsMock,
  importGenericNameMappingsMock,
  previewMhlwGenericFlagsMock,
  previewGenericNameMappingsMock,
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
    importMhlwGenericFlagsMock: vi.fn(),
    importGenericNameMappingsMock: vi.fn(),
    previewMhlwGenericFlagsMock: vi.fn(),
    previewGenericNameMappingsMock: vi.fn(),
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
  importMhlwGenericFlags: importMhlwGenericFlagsMock,
  importGenericNameMappings: importGenericNameMappingsMock,
  previewMhlwGenericFlags: previewMhlwGenericFlagsMock,
  previewGenericNameMappings: previewGenericNameMappingsMock,
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

describe('/api/drug-master-imports/mhlw-generic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importMhlwGenericFlagsMock.mockResolvedValue({
      log: {
        id: 'log_flags',
        status: 'success',
        source_file_hash: 'mhlw_flags_source_hash',
        source_published_at: new Date('2026-04-01T00:00:00.000Z'),
        import_mode: 'full',
        change_summary: { mode: 'full', parsed_records: 10, imported_records: 10 },
      },
      importedCount: 10,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
    });
    importGenericNameMappingsMock.mockResolvedValue({
      log: {
        id: 'log_mappings',
        status: 'success',
        source_file_hash: 'mhlw_mapping_source_hash',
        source_published_at: new Date('2026-04-02T00:00:00.000Z'),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 20,
          imported_records: 20,
          brand_candidate_count: 12,
        },
      },
      importedCount: 20,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
    });
    previewMhlwGenericFlagsMock.mockResolvedValue({
      dryRun: true,
      operation: 'generic_flags',
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      sourceFileHash: 'mhlw_flags_source_hash',
      sourcePublishedAt: '2026-04-01T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 10,
          drug_master_upsert_count: 10,
          skipped_invalid_yj: 0,
          changed_flag_count: 2,
          sampled_rows: 1,
        },
        rows: [
          {
            yj_code: '1124001F1030',
            drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
            action: 'upsert_generic_flag',
            previous_is_generic: false,
            next_is_generic: true,
          },
        ],
      },
    });
    previewGenericNameMappingsMock.mockResolvedValue({
      dryRun: true,
      operation: 'generic_mapping',
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      sourceFileHash: 'mhlw_mapping_source_hash',
      sourcePublishedAt: '2026-04-02T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 20,
          generic_mapping_replace_count: 7,
          brand_candidate_count: 12,
          skipped_invalid_yj: 0,
          sampled_rows: 1,
        },
        rows: [
          {
            generic_name: 'エスタゾラム',
            standard_name: '【般】エスタゾラム錠１ｍｇ',
            action: 'replace_mapping',
            brand_candidate_count: 2,
            exception_code_count: 1,
            lowest_price: '6.3',
            add_on_scope: '加算1,2',
            brand_candidates: [
              {
                yj_code: '1124001F1030',
                drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
                manufacturer: '共和薬品工業',
              },
            ],
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
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
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', orgId: 'org_1', role: 'admin' }),
      expect.any(Function),
    );
    expect(importMhlwGenericFlagsMock).toHaveBeenCalled();
    expect(importGenericNameMappingsMock).toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    expect(importMhlwGenericFlagsMock.mock.invocationCallOrder[0]).toBeLessThan(
      importGenericNameMappingsMock.mock.invocationCallOrder[0]!,
    );
    expect(importGenericNameMappingsMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSearchCacheMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateDetailCacheMock.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        mode: 'all',
        importedCount: 30,
        flags: {
          logId: 'log_flags',
          sourceFileHash: 'mhlw_flags_source_hash',
          sourcePublishedAt: '2026-04-01T00:00:00.000Z',
          importMode: 'full',
          changeSummary: { mode: 'full', parsed_records: 10, imported_records: 10 },
        },
        mappings: {
          logId: 'log_mappings',
          sourceFileHash: 'mhlw_mapping_source_hash',
          sourcePublishedAt: '2026-04-02T00:00:00.000Z',
          importMode: 'full',
          changeSummary: {
            mode: 'full',
            parsed_records: 20,
            imported_records: 20,
            brand_candidate_count: 12,
          },
        },
      },
    });
  });

  it('returns MHLW generic dry-run previews without executing imports', async () => {
    const response = await POST(
      createJsonRequest({
        mode: 'all',
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
        dryRun: true,
        previewLimit: 1,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(previewMhlwGenericFlagsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      previewLimit: 1,
    });
    expect(previewGenericNameMappingsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      previewLimit: 1,
    });
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(previewMhlwGenericFlagsMock.mock.invocationCallOrder[0]).toBeLessThan(
      previewGenericNameMappingsMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        dryRun: true,
        mode: 'all',
        flags: {
          operation: 'generic_flags',
          preview: {
            summary: {
              parsed_records: 10,
              drug_master_upsert_count: 10,
              changed_flag_count: 2,
              sampled_rows: 1,
            },
            rows: [
              {
                yj_code: '1124001F1030',
                action: 'upsert_generic_flag',
                previous_is_generic: false,
                next_is_generic: true,
              },
            ],
          },
        },
        mappings: {
          operation: 'generic_mapping',
          preview: {
            summary: {
              parsed_records: 20,
              generic_mapping_replace_count: 7,
              brand_candidate_count: 12,
              skipped_invalid_yj: 0,
              sampled_rows: 1,
            },
            rows: [
              {
                generic_name: 'エスタゾラム',
                action: 'replace_mapping',
                brand_candidate_count: 2,
              },
            ],
          },
        },
      },
    });
  });

  it('keeps normal import behavior when dryRun is explicitly false', async () => {
    const response = await POST(
      createJsonRequest({
        mode: 'flags',
        dryRun: false,
        previewLimit: 100,
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: undefined,
    });
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        mode: 'flags',
        importedCount: 10,
        flags: { importedCount: 10 },
        mappings: null,
      },
    });
  });

  it('imports mappings only and returns a null flags projection', async () => {
    const response = await POST(createJsonRequest({ mode: 'mappings' }));

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).toHaveBeenCalledWith(prismaMock, {
      workbookUrl: undefined,
    });
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        mode: 'mappings',
        importedCount: 20,
        flags: null,
        mappings: { importedCount: 20 },
      },
    });
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });

  it.each([
    'http://www.mhlw.go.jp/topics/generic.xlsx',
    'https://example.com/generic.xlsx',
    'https://localhost/generic.xlsx',
    'https://127.0.0.1/generic.xlsx',
  ])('rejects disallowed MHLW workbook URL %s before external work', async (workbookUrl) => {
    const response = await POST(createJsonRequest({ workbookUrl }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(previewMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(previewGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw MHLW workbook auth token secret');
    unsafeError.name = 'MhlwGenericAuthSecretError';
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/mhlw-generic',
        method: 'POST',
        requestId,
        correlationId,
      },
      unsafeError,
    );
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
    expect(importMhlwGenericFlagsMock).toHaveBeenCalledOnce();
    expect(importGenericNameMappingsMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/mhlw-generic',
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
    expect(logged).not.toContain('mhlw generic import secret');
    expect(logged).not.toContain('MhlwGenericImportSecretError');
  });

  it('returns a sanitized no-store 500 when MHLW generic preview fails unexpectedly', async () => {
    const unsafeError = new Error('raw mhlw generic preview secret');
    unsafeError.name = 'MhlwGenericPreviewSecretError';
    previewGenericNameMappingsMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ mode: 'mappings', dryRun: true }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('mhlw generic preview secret');
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/mhlw-generic',
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
    expect(logged).not.toContain('mhlw generic preview secret');
    expect(logged).not.toContain('MhlwGenericPreviewSecretError');
  });

  it('does not run mappings or invalidate caches when the first all-mode import fails', async () => {
    importMhlwGenericFlagsMock.mockRejectedValueOnce(new Error('flags failed'));

    const response = await POST(createJsonRequest({ mode: 'all' }));

    expect(response.status).toBe(500);
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
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
    expect(importMhlwGenericFlagsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('rethrows import control flow without shared logging or cache invalidation', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    importMhlwGenericFlagsMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(POST(createJsonRequest({ mode: 'all' }))).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(importGenericNameMappingsMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });
});
