import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  findFirstMock,
  auditLogCreateMock,
  reviewBillingCandidateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  reviewBillingCandidateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  reviewBillingCandidate: reviewBillingCandidateMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: () => 'org_1',
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/billing-candidates/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    findFirstMock.mockResolvedValue({
      id: 'candidate_1',
      status: 'candidate',
    });
    auditLogCreateMock.mockResolvedValue({});
    reviewBillingCandidateMock.mockResolvedValue({
      id: 'candidate_1',
      status: 'confirmed',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findFirst: findFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('confirms a candidate and records the audit trail', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(reviewBillingCandidateMock).toHaveBeenCalledWith(
      {
        billingCandidate: { findFirst: findFirstMock },
        auditLog: { create: auditLogCreateMock },
      },
      {
        orgId: 'org_1',
        billingCandidateId: 'candidate_1',
        action: 'confirm',
        note: null,
        actorId: 'user_1',
      }
    );
    expect(auditLogCreateMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'candidate_1',
        status: 'confirmed',
      },
    });
  });

  it('rejects updates for exported candidates', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      status: 'exported',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });
});
