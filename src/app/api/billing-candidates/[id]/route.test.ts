import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-06-17T00:00:00.000Z';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1', {
    method: 'PATCH',
    body: '{"action":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
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
      updated_at: new Date(CURRENT_UPDATED_AT),
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
      }),
    );
  });

  it('confirms a candidate and records the audit trail', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: '  candidate_1  ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '請求候補の更新権限がありません',
    });
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
        expectedUpdatedAt: new Date(CURRENT_UPDATED_AT),
      },
    );
    expect(auditLogCreateMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'candidate_1',
        status: 'confirmed',
      },
    });
  });

  it('accepts a null note for existing clients while using expected_updated_at', async () => {
    const response = await PATCH(
      createRequest({
        action: 'exclude',
        expected_updated_at: CURRENT_UPDATED_AT,
        note: null,
      }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(reviewBillingCandidateMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: 'exclude',
        note: null,
        expectedUpdatedAt: new Date(CURRENT_UPDATED_AT),
      }),
    );
  });

  it('rejects blank candidate ids before parsing request bodies or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects updates for exported candidates', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      status: 'exported',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });

  it('requires expected_updated_at before transaction or audit work', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict for stale expected_updated_at before review or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: STALE_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(findFirstMock).toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without audit work when the review service detects a stale race', async () => {
    reviewBillingCandidateMock.mockRejectedValueOnce(new Error('BILLING_CANDIDATE_STALE'));

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(reviewBillingCandidateMock).toHaveBeenCalledOnce();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid review action before transaction or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'delete', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before transaction or audit work', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction or audit work', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found without audit work when the candidate is missing', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'missing_candidate' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not write an audit record when the review service throws', async () => {
    reviewBillingCandidateMock.mockRejectedValueOnce(new Error('review service failed'));

    await expect(
      PATCH(createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }), {
        params: Promise.resolve({ id: 'candidate_1' }),
      }),
    ).rejects.toThrow('review service failed');

    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
