import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  return {
    headers: {
      get: () => 'org_1',
    },
    json: async () => body,
  } as unknown as NextRequest;
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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({})
    );
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
});
