import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  importPmdaPackageInsertsMock,
  previewPmdaPackageInsertsMock,
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
    previewPmdaPackageInsertsMock: vi.fn(),
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
  previewPmdaPackageInserts: previewPmdaPackageInsertsMock,
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

describe('/api/drug-master-imports/pmda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importPmdaPackageInsertsMock.mockResolvedValue({
      log: {
        id: 'log_1',
        status: 'success',
        source_file_hash: 'pmda_source_hash',
        source_published_at: new Date('2026-06-12T00:00:00.000Z'),
        import_mode: 'delta',
        change_summary: {
          mode: 'delta',
          parsed_records: 88,
          imported_records: 80,
          skipped_unmatched_primary_records: 8,
          create_count: 20,
          update_count: 30,
          unchanged_count: 30,
          matched_interaction_pair_count: 12,
        },
      },
      importedCount: 88,
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
    });
    previewPmdaPackageInsertsMock.mockResolvedValue({
      dryRun: true,
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
      sourceFileHash: 'pmda_source_hash',
      sourcePublishedAt: '2026-06-12T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 88,
          matched_primary_records: 80,
          skipped_unmatched_primary_records: 8,
          create_count: 20,
          update_count: 30,
          unchanged_count: 30,
          matched_interaction_pair_count: 12,
          sampled_rows: 1,
        },
        rows: [
          {
            yj_code: '123456789012',
            drug_name: 'サンプル錠',
            drug_master_id: 'drug_1',
            action: 'update',
            changed_fields: ['contraindications'],
            interaction_candidate_count: 2,
            matched_interaction_pair_count: 1,
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
    expect(previewPmdaPackageInsertsMock).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        logId: 'log_1',
        mode: 'delta',
        sourceFileHash: 'pmda_source_hash',
        sourcePublishedAt: '2026-06-12T00:00:00.000Z',
        importMode: 'delta',
        changeSummary: {
          mode: 'delta',
          parsed_records: 88,
          imported_records: 80,
          skipped_unmatched_primary_records: 8,
          create_count: 20,
          update_count: 30,
          unchanged_count: 30,
          matched_interaction_pair_count: 12,
        },
      },
    });
    expect(payload.data.changeSummary.skipped_unmatched_primary).toBeUndefined();
  });

  it('returns a PMDA dry-run preview without executing the import', async () => {
    const response = await POST(
      createJsonRequest({
        zipUrl: 'https://www.pmda.go.jp/pmda.zip',
        mode: 'delta',
        dryRun: true,
        previewLimit: 1,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(previewPmdaPackageInsertsMock).toHaveBeenCalledWith(prismaMock, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      mode: 'delta',
      previewLimit: 1,
    });
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        dryRun: true,
        sourceFileHash: 'pmda_source_hash',
        preview: {
          summary: {
            parsed_records: 88,
            create_count: 20,
            update_count: 30,
            unchanged_count: 30,
            sampled_rows: 1,
          },
          rows: [
            {
              yj_code: '123456789012',
              action: 'update',
              changed_fields: ['contraindications'],
            },
          ],
        },
      },
    });
  });

  it('accepts previewLimit zero for dry-run previews', async () => {
    const response = await POST(
      createJsonRequest({
        dryRun: true,
        previewLimit: 0,
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(previewPmdaPackageInsertsMock).toHaveBeenCalledWith(prismaMock, {
      mode: 'full',
      previewLimit: 0,
    });
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
  });

  it('keeps normal import behavior when dryRun is explicitly false', async () => {
    const response = await POST(
      createJsonRequest({
        mode: 'delta',
        dryRun: false,
        previewLimit: 100,
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importPmdaPackageInsertsMock).toHaveBeenCalledWith(prismaMock, { mode: 'delta' });
    expect(previewPmdaPackageInsertsMock).not.toHaveBeenCalled();
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
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
    expect(previewPmdaPackageInsertsMock).not.toHaveBeenCalled();
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
      {
        event: 'drug_master_imports_pmda_post_unhandled_error',
        route: '/api/drug-master-imports/pmda',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('pmda import secret');
    expect(logged).not.toContain('PmdaImportSecretError');
  });

  it('returns a sanitized no-store 500 when PMDA dry-run preview fails unexpectedly', async () => {
    const unsafeError = new Error('raw pmda preview secret');
    unsafeError.name = 'PmdaPreviewSecretError';
    previewPmdaPackageInsertsMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ dryRun: true }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('pmda preview secret');
    expect(importPmdaPackageInsertsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'drug_master_imports_pmda_post_unhandled_error',
        route: '/api/drug-master-imports/pmda',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('pmda preview secret');
    expect(logged).not.toContain('PmdaPreviewSecretError');
  });
});
