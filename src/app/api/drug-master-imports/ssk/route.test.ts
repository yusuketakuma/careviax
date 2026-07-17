import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importSskDrugMasterMock,
  previewSskDrugMasterImportMock,
  loggerErrorMock,
  invalidateSearchCacheMock,
  invalidateDetailCacheMock,
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
    importSskDrugMasterMock: vi.fn(),
    previewSskDrugMasterImportMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    invalidateSearchCacheMock: vi.fn(),
    invalidateDetailCacheMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    unstableRethrowMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));
vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/ssk', () => ({
  importSskDrugMaster: importSskDrugMasterMock,
  previewSskDrugMasterImport: previewSskDrugMasterImportMock,
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

describe('/api/drug-master-imports/ssk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importSskDrugMasterMock.mockResolvedValue({
      log: {
        id: 'log_1',
        status: 'success',
        source_file_hash: 'ssk_source_hash',
        source_published_at: new Date('2026-06-11T00:00:00.000Z'),
        import_mode: 'full',
        change_summary: { mode: 'full', parsed_records: 120, imported_records: 120 },
      },
      importedCount: 120,
      entryName: 'master.csv',
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
    });
    previewSskDrugMasterImportMock.mockResolvedValue({
      dryRun: true,
      entryName: 'master.csv',
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
      sourceFileHash: 'ssk_source_hash',
      sourcePublishedAt: '2026-06-11T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 120,
          create_count: 10,
          update_count: 5,
          unchanged_count: 105,
          sampled_rows: 2,
        },
        rows: [
          {
            yj_code: '123456789012',
            drug_name: 'DRUG-A',
            action: 'update',
            changed_fields: ['drug_name'],
          },
          {
            yj_code: '998877665544',
            drug_name: 'DRUG-B',
            action: 'create',
            changed_fields: ['drug_name'],
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
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
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
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    expect(importSskDrugMasterMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSearchCacheMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateDetailCacheMock.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        logId: 'log_1',
        status: 'success',
        importedCount: 120,
        entryName: 'master.csv',
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        sourceFileHash: 'ssk_source_hash',
        sourcePublishedAt: '2026-06-11T00:00:00.000Z',
        importMode: 'full',
        changeSummary: { mode: 'full', parsed_records: 120, imported_records: 120 },
      },
    });
  });

  it('returns an SSK dry-run preview without executing the import', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        limit: 100,
        dryRun: true,
        previewLimit: 2,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(previewSskDrugMasterImportMock).toHaveBeenCalledWith(prismaMock, {
      zipUrl: 'https://www.ssk.or.jp/ssk.zip',
      limit: 100,
      previewLimit: 2,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        dryRun: true,
        entryName: 'master.csv',
        zipUrl: 'https://www.ssk.or.jp/ssk.zip',
        sourceFileHash: 'ssk_source_hash',
        sourcePublishedAt: '2026-06-11T00:00:00.000Z',
        preview: {
          summary: {
            parsed_records: 120,
            create_count: 10,
            update_count: 5,
            unchanged_count: 105,
            sampled_rows: 2,
          },
          rows: [
            {
              yj_code: '123456789012',
              action: 'update',
              changed_fields: ['drug_name'],
            },
            {
              yj_code: '998877665544',
              action: 'create',
            },
          ],
        },
      },
    });
  });

  it.each([1, 5000])('accepts limit boundary %s', async (limit) => {
    const response = await POST(createJsonRequest({ limit }));

    expect(response.status).toBe(201);
    expect(importSskDrugMasterMock).toHaveBeenCalledWith(prismaMock, { limit });
  });

  it.each([
    ['zero limit', { limit: 0 }],
    ['too large limit', { limit: 5001 }],
    ['fractional limit', { limit: 1.5 }],
    ['string limit', { limit: '1' }],
    ['negative previewLimit', { dryRun: true, previewLimit: -1 }],
    ['too large previewLimit', { dryRun: true, previewLimit: 101 }],
    ['fractional previewLimit', { dryRun: true, previewLimit: 1.5 }],
    ['string previewLimit', { dryRun: true, previewLimit: '1' }],
    ['non-boolean dryRun', { dryRun: 'true' }],
  ])('rejects invalid option: %s', async (_label, body) => {
    const response = await POST(createJsonRequest(body));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(previewSskDrugMasterImportMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it.each([0, 100])('accepts previewLimit boundary %s', async (previewLimit) => {
    const response = await POST(createJsonRequest({ dryRun: true, previewLimit }));

    expect(response.status).toBe(200);
    expect(previewSskDrugMasterImportMock).toHaveBeenCalledWith(prismaMock, { previewLimit });
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
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
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });
    const request = createMalformedJsonRequest();

    const response = await POST(request);

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(previewSskDrugMasterImportMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns no-store 401 before reading the body when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);
    const request = createMalformedJsonRequest();
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw SSK auth ZIP token secret');
    unsafeError.name = 'SskAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);
    const request = createMalformedJsonRequest();
    const response = await POST(request);
    const requestId = response.headers.get('X-Request-Id');

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/ssk',
        method: 'POST',
        requestId,
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
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
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/ssk',
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
    expect(logged).not.toContain('ssk import secret');
    expect(logged).not.toContain('SskImportSecretError');
  });

  it('returns a shared safe 500 without cache invalidation when preview fails', async () => {
    const unsafeError = new Error('raw ssk preview secret');
    previewSskDrugMasterImportMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ dryRun: true }));

    expect(response.status).toBe(500);
    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'route_handler_unhandled_error' }),
      unsafeError,
    );
  });

  it('rethrows auth and handler control flow without logging or cache invalidation', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });
    await expect(POST(createMalformedJsonRequest())).rejects.toBe(authControl);
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    importSskDrugMasterMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });
    await expect(POST(createJsonRequest({}))).rejects.toBe(handlerControl);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });
});
