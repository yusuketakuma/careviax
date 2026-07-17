import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  importManualClinicalRulesMock,
  loggerErrorMock,
  invalidateSearchCacheMock,
  invalidateDetailCacheMock,
  clearRequestAuthContextMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => {
  const txMock = { tx: true };
  return {
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    withOrgContextMock: vi.fn((_orgId, fn) => fn(txMock)),
    importManualClinicalRulesMock: vi.fn(),
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

vi.mock('@/server/services/drug-master-import/manual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/drug-master-import/manual')>()),
  importManualClinicalRules: importManualClinicalRulesMock,
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

const pimRule = {
  condition: { yj_codes: ['1124001F1022'] },
  message: 'PIM A',
};
const highRiskRule = {
  condition: { therapeutic_categories: ['high-risk'] },
  severity: 'critical' as const,
  message: 'High Risk A',
};
const renalAdjustment = {
  yj_code: '1124001F1022',
  dosage_adjustment_renal: [{ egfr_max: 30, recommendation: 'Renal A' }],
};
const safetyOverride = {
  yj_code: '1124001F1022',
  is_high_risk: true,
};

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
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', orgId: 'org_1', role: 'admin' }),
      expect.any(Function),
    );
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
        renal_adjustments: [],
        drug_safety_overrides: [],
      },
    );
    expect(invalidateSearchCacheMock).toHaveBeenCalledOnce();
    expect(invalidateDetailCacheMock).toHaveBeenCalledOnce();
    expect(importManualClinicalRulesMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSearchCacheMock.mock.invocationCallOrder[0]!,
    );
    expect(invalidateSearchCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateDetailCacheMock.mock.invocationCallOrder[0]!,
    );
  });

  it('imports manual clinical rules', async () => {
    const response = await POST(
      createJsonRequest({
        pim_rules: [pimRule],
        high_risk_rules: [highRiskRule],
        renal_adjustments: [renalAdjustment],
        drug_safety_overrides: [safetyOverride],
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(importManualClinicalRulesMock).toHaveBeenCalledWith(
      { tx: true },
      {
        pim_rules: [{ ...pimRule, severity: 'warning', is_active: true }],
        high_risk_rules: [{ ...highRiskRule, is_active: true }],
        renal_adjustments: [renalAdjustment],
        drug_safety_overrides: [safetyOverride],
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

  it.each([
    ['alert without condition', { pim_rules: [{ message: 'PIM A' }] }],
    ['alert without message', { high_risk_rules: [{ condition: { yj_codes: ['1124001F1022'] } }] }],
    [
      'renal adjustment without yj_code',
      {
        renal_adjustments: [{ dosage_adjustment_renal: [{ recommendation: 'Reduce dose' }] }],
      },
    ],
    ['safety override without yj_code', { drug_safety_overrides: [{ is_high_risk: true }] }],
  ])('rejects invalid real clinical schema input: %s', async (_label, body) => {
    const response = await POST(createJsonRequest(body));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(importManualClinicalRulesMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('raw clinical auth patient rule secret');
    unsafeError.name = 'ManualClinicalAuthSecretError';
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/manual-clinical',
        method: 'POST',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('patient');
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(
      'ManualClinicalAuthSecretError',
    );
  });

  it('returns a sanitized no-store 500 when manual clinical import fails unexpectedly', async () => {
    const unsafeError = new Error('raw manual clinical import secret');
    unsafeError.name = 'ManualClinicalSecretError';
    importManualClinicalRulesMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createJsonRequest({ pim_rules: [pimRule] }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('clinical import secret');
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/manual-clinical',
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
    expect(logged).not.toContain('clinical import secret');
    expect(logged).not.toContain('ManualClinicalSecretError');
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });

  it('rethrows transaction control flow without shared logging or cache invalidation', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    importManualClinicalRulesMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(POST(createJsonRequest({ pim_rules: [pimRule] }))).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(invalidateSearchCacheMock).not.toHaveBeenCalled();
    expect(invalidateDetailCacheMock).not.toHaveBeenCalled();
  });
});
