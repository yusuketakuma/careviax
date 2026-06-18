import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  closeBillingCandidatesForMonthMock,
  notifyWebhookEventForOrgMock,
  isClaimsExportConsumerConfiguredMock,
  resolveClaimsExportConfigMock,
  createClaimsExportAdapterMock,
  exportClaimsMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  closeBillingCandidatesForMonthMock: vi.fn(),
  notifyWebhookEventForOrgMock: vi.fn(),
  isClaimsExportConsumerConfiguredMock: vi.fn(),
  resolveClaimsExportConfigMock: vi.fn(),
  createClaimsExportAdapterMock: vi.fn(),
  exportClaimsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  closeBillingCandidatesForMonth: closeBillingCandidatesForMonthMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/server/adapters/claims-export', () => ({
  isClaimsExportConsumerConfigured: isClaimsExportConsumerConfiguredMock,
  resolveClaimsExportConfig: resolveClaimsExportConfigMock,
  createClaimsExportAdapter: createClaimsExportAdapterMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates/close', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/billing-candidates/close', {
    method: 'POST',
    body: '{"billing_month":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/billing-candidates/close POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({}));
    isClaimsExportConsumerConfiguredMock.mockReturnValue(false);
    resolveClaimsExportConfigMock.mockReturnValue({ provider: 'stub' });
    exportClaimsMock.mockResolvedValue({
      format: 'claims-xml',
      content: '<ClaimsExport />',
      recordCount: 0,
      generatedAt: '2026-03-31T00:00:00.000Z',
    });
    createClaimsExportAdapterMock.mockReturnValue({
      exportClaims: exportClaimsMock,
      getCapabilities: vi.fn(),
    });
  });

  it('closes the month when no review blockers remain', async () => {
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: false,
      exported_count: 12,
      summary: {
        total: 12,
        pending_review: 0,
        confirmed: 10,
        excluded: 2,
        exported: 12,
        reviewed: 12,
        ready_to_close: 10,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });

    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '請求月次締めの権限がありません',
    });
    expect(closeBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01T00:00:00.000Z'),
        actorId: 'user_1',
        billingDomain: 'home_care',
      },
    );
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith('org_1', 'billing.exported', {
      billingMonth: '2026-03-01T00:00:00.000Z',
      billingDomain: 'home_care',
      exportedCount: 12,
    });
    await expect(response.json()).resolves.toMatchObject({
      billing_domain: 'home_care',
      exported_count: 12,
      summary: {
        exported: 12,
      },
    });
  });

  it('closes PCA rental billing candidates when billing_domain is pca_rental', async () => {
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: false,
      exported_count: 2,
      summary: {
        total: 2,
        pending_review: 0,
        confirmed: 2,
        excluded: 0,
        exported: 2,
        reviewed: 2,
        ready_to_close: 0,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });

    const response = await POST(
      createRequest({ billing_month: '2026-06-01', billing_domain: 'pca_rental' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(closeBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_1',
        billingMonth: new Date('2026-06-01T00:00:00.000Z'),
        actorId: 'user_1',
        billingDomain: 'pca_rental',
      },
    );
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith('org_1', 'billing.exported', {
      billingMonth: '2026-06-01T00:00:00.000Z',
      billingDomain: 'pca_rental',
      exportedCount: 2,
    });
    await expect(response.json()).resolves.toMatchObject({
      billing_domain: 'pca_rental',
      exported_count: 2,
    });
  });

  it('returns conflict when review blockers remain', async () => {
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: true,
      blockingCount: 3,
      summary: {
        total: 12,
        pending_review: 3,
        confirmed: 9,
        excluded: 0,
        exported: 0,
        reviewed: 9,
        ready_to_close: 9,
        blocked_from_close: 3,
        blocker_reasons: [{ reason: '同意未取得', count: 3 }],
      },
    });

    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('transmits only candidates exported by this close attempt when claims export is configured', async () => {
    const billingCandidateFindManyMock = vi.fn().mockResolvedValue([
      {
        patient_id: 'patient_new',
        billing_domain: 'home_care',
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 650,
        status: 'exported',
        source_snapshot: { payer_basis: 'medical' },
      },
    ]);
    const auditLogCreateMock = vi.fn().mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    isClaimsExportConsumerConfiguredMock.mockReturnValue(true);
    resolveClaimsExportConfigMock.mockReturnValue({
      provider: 'rececom',
      baseUrl: 'https://rececom.example.test',
    });
    exportClaimsMock.mockImplementation(async (payload: { records: unknown[] }) => ({
      format: 'claims-xml',
      content: '<ClaimsExport />',
      recordCount: payload.records.length,
      generatedAt: '2026-03-31T00:00:00.000Z',
    }));
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: false,
      exported_count: 1,
      exported_candidate_ids: ['candidate_new'],
      summary: {
        total: 2,
        pending_review: 0,
        confirmed: 0,
        excluded: 0,
        exported: 2,
        reviewed: 2,
        ready_to_close: 0,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });

    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          billing_domain: 'home_care',
          status: 'exported',
          id: { in: ['candidate_new'] },
        }),
      }),
    );
    expect(exportClaimsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          expect.objectContaining({
            patientId: 'patient_new',
            billingCode: 'MED_HOME_VISIT_SINGLE',
          }),
        ],
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'billing.claims_export_transmitted',
        changes: expect.objectContaining({
          record_count: 1,
        }),
      }),
    });
    const body = await response.json();
    expect(body).toMatchObject({
      exported_count: 1,
      claims_export: {
        transmitted: true,
        recordCount: 1,
      },
    });
    expect(body).not.toHaveProperty('exported_candidate_ids');
  });

  it('skips configured claims export when this close attempt exported no candidates', async () => {
    isClaimsExportConsumerConfiguredMock.mockReturnValue(true);
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: false,
      exported_count: 0,
      exported_candidate_ids: [],
      summary: {
        total: 1,
        pending_review: 0,
        confirmed: 0,
        excluded: 1,
        exported: 0,
        reviewed: 1,
        ready_to_close: 0,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });

    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createClaimsExportAdapterMock).not.toHaveBeenCalled();
    expect(exportClaimsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      exported_count: 0,
      claims_export: {
        transmitted: false,
        reason: 'no_records',
      },
    });
  });

  it('returns stale conflict without webhook when a candidate changes during close', async () => {
    closeBillingCandidatesForMonthMock.mockRejectedValueOnce(
      new Error('BILLING_CLOSE_STALE_CANDIDATE'),
    );

    const response = await POST(
      createRequest({ billing_month: '2026-03-01', billing_domain: 'home_care' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'BILLING_CLOSE_STALE_CANDIDATES',
      message:
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してから月次締めしてください。',
      details: {
        billing_month: '2026-03-01T00:00:00.000Z',
        billing_domain: 'home_care',
        conflictCount: 1,
      },
    });
  });

  it.each([
    ['non-object root', ['unexpected']],
    ['missing', {}],
    ['empty', { billing_month: '' }],
    ['non-string', { billing_month: 123 }],
    ['incomplete date', { billing_month: '2026-03' }],
    ['non-month-start date', { billing_month: '2026-03-02' }],
    ['invalid calendar date', { billing_month: '2026-02-30' }],
    ['out-of-range month', { billing_month: '2026-13-01' }],
    ['timezone timestamp', { billing_month: '2026-03-01T00:00:00.000Z' }],
  ])('rejects %s billing_month before transaction work', async (_caseName, body) => {
    const response = await POST(createRequest(body));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects invalid billing_domain before transaction work', async () => {
    const response = await POST(
      createRequest({ billing_month: '2026-03-01', billing_domain: 'unknown' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before closing or webhook side effects', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });
});
