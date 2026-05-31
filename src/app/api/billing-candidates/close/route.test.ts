import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      },
    );
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith('org_1', 'billing.exported', {
      billingMonth: '2026-03-01T00:00:00.000Z',
      exportedCount: 12,
    });
    await expect(response.json()).resolves.toMatchObject({
      exported_count: 12,
      summary: {
        exported: 12,
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

    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it.each([
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
});
