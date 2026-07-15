import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  closeBillingCandidatesForMonthMock,
  notifyWebhookEventForOrgMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  closeBillingCandidatesForMonthMock: vi.fn(),
  notifyWebhookEventForOrgMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) =>
    async (req: unknown, routeContext?: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
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

function invokePOST(request: NextRequest) {
  return POST(request, { params: Promise.resolve({}) });
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the authentication response before billing, webhook, or claims-export work', async () => {
    const deniedResponse = Response.json(
      { code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' },
      { status: 401 },
    );
    requireAuthContextMock.mockResolvedValueOnce({ response: deniedResponse });

    const response = await invokePOST(createMalformedJsonRequest());

    expect(response).toBe(deniedResponse);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canManageBilling',
      message: '請求月次締めの権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
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

    const response = await invokePOST(createRequest({ billing_month: '2026-03-01' }));

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
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        billing_domain: 'home_care',
        exported_count: 12,
        summary: {
          exported: 12,
        },
      },
    });
    expect(body).not.toHaveProperty('message');
    expect(body).not.toHaveProperty('billing_domain');
    expect(body).not.toHaveProperty('exported_count');
    expect(body).not.toHaveProperty('summary');
    expect(body).not.toHaveProperty('claims_export');
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

    const response = await invokePOST(
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
      data: {
        billing_domain: 'pca_rental',
        exported_count: 2,
      },
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

    const response = await invokePOST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('closes without implicit claims transmission or claims metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    closeBillingCandidatesForMonthMock.mockResolvedValue({
      blocked: false,
      exported_count: 1,
      exported_candidate_ids: ['candidate_1'],
      summary: {
        total: 1,
        pending_review: 0,
        confirmed: 0,
        excluded: 0,
        exported: 1,
        reviewed: 1,
        ready_to_close: 0,
        blocked_from_close: 0,
        blocker_reasons: [],
      },
    });

    const response = await invokePOST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.exported_count).toBe(1);
    expect(body.data).not.toHaveProperty('claims_export');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
  });

  it('returns stale conflict without webhook when a candidate changes during close', async () => {
    closeBillingCandidatesForMonthMock.mockRejectedValueOnce(
      new Error('BILLING_CLOSE_STALE_CANDIDATE'),
    );

    const response = await invokePOST(
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
    const response = await invokePOST(createRequest(body));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects invalid billing_domain before transaction work', async () => {
    const response = await invokePOST(
      createRequest({ billing_month: '2026-03-01', billing_domain: 'unknown' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(closeBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before closing or webhook side effects', async () => {
    const response = await invokePOST(createMalformedJsonRequest());

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
