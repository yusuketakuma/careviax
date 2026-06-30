import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  importManualClinicalRulesMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const txMock = { tx: true };
  return {
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    withOrgContextMock: vi.fn((_orgId, fn) => fn(txMock)),
    importManualClinicalRulesMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock('@/server/services/drug-master-import/manual', () => ({
  importManualClinicalRules: importManualClinicalRulesMock,
  manualClinicalRuleBundleSchema: z.object({
    pim_rules: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
    high_risk_rules: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
    renal_rules: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
    drug_safety_overrides: z
      .array(z.object({ name: z.string() }))
      .optional()
      .default([]),
  }),
}));

import { POST } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-master-imports/manual-clinical', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/manual-clinical', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/manual-clinical', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{"pim_rules":',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-master-imports/manual-clinical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    importManualClinicalRulesMock.mockResolvedValue({
      log: {
        id: 'log_1',
        status: 'success',
        source_file_hash: null,
        source_published_at: null,
        import_mode: 'manual',
        change_summary: {
          mode: 'manual',
          pim_rules: 1,
          high_risk_rules: 1,
          renal_rules: 1,
          drug_safety_overrides: 1,
        },
      },
      importedCount: 4,
      pimCount: 1,
      highRiskCount: 1,
      renalCount: 1,
      safetyOverrideCount: 1,
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before import execution', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
  });

  it('allows empty request bodies for empty manual clinical rule bundles', async () => {
    const response = await POST(createEmptyRequest());

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
          role: 'admin',
        }),
        maxWaitMs: 10_000,
        timeoutMs: 30_000,
      }),
    );
    expect(importManualClinicalRulesMock).toHaveBeenCalledWith(
      { tx: true },
      {
        pim_rules: [],
        high_risk_rules: [],
        renal_rules: [],
        drug_safety_overrides: [],
      },
    );
  });

  it('imports manual clinical rules', async () => {
    const response = await POST(
      createJsonRequest({
        pim_rules: [{ name: 'PIM A' }],
        high_risk_rules: [{ name: 'High Risk A' }],
        renal_rules: [{ name: 'Renal A' }],
        drug_safety_overrides: [{ name: 'Safety A' }],
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importManualClinicalRulesMock).toHaveBeenCalledWith(
      { tx: true },
      {
        pim_rules: [{ name: 'PIM A' }],
        high_risk_rules: [{ name: 'High Risk A' }],
        renal_rules: [{ name: 'Renal A' }],
        drug_safety_overrides: [{ name: 'Safety A' }],
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        logId: 'log_1',
        importedCount: 4,
        safetyOverrideCount: 1,
        sourceFileHash: null,
        sourcePublishedAt: null,
        importMode: 'manual',
        changeSummary: {
          mode: 'manual',
          pim_rules: 1,
          high_risk_rules: 1,
          renal_rules: 1,
          drug_safety_overrides: 1,
        },
      },
    });
  });

  it('returns no-store 403 before reading the body when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'viewer', site_id: null });

    const response = await POST(createJsonRequest({ pim_rules: [{ name: 'PIM A' }] }));

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when manual clinical import fails unexpectedly', async () => {
    const unsafeError = new Error('raw manual clinical import secret');
    unsafeError.name = 'ManualClinicalSecretError';
    importManualClinicalRulesMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ pim_rules: [{ name: 'PIM A' }] }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('clinical import secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_manual_clinical_post_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_manual_clinical_post_unhandled_error',
        route: '/api/drug-master-imports/manual-clinical',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('clinical import secret');
    expect(logged).not.toContain('ManualClinicalSecretError');
  });
});
