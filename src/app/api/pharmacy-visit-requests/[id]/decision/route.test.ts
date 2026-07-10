import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  acquireAdvisoryTxLockMock,
  patientShareCaseFindFirstMock,
  pharmacyVisitRequestFindFirstMock,
  pharmacyVisitRequestUpdateManyMock,
  pharmacyVisitRequestFindUniqueOrThrowMock,
  createAuditLogEntryMock,
  authContextFailureMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  acquireAdvisoryTxLockMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  pharmacyVisitRequestFindFirstMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  pharmacyVisitRequestFindUniqueOrThrowMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  authContextFailureMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) => {
      const failure = authContextFailureMock();
      if (failure) return Promise.reject(failure);

      return handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: acquireAdvisoryTxLockMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { POST as rawPOST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const routeContext = { params: Promise.resolve({ id: 'visit_request_1' }) };
const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';

function createRequest(body: unknown) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/pharmacy-visit-requests/visit_request_1/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
}

function activeShareCaseMutationWhere(asOf = new Date('2026-06-19T00:00:00.000Z')) {
  return {
    org_id: 'org_1',
    status: 'active',
    revoked_at: null,
    ended_at: null,
    partnership: {
      status: 'active',
      partner_pharmacy: { status: 'active' },
      OR: [{ effective_from: null }, { effective_from: { lte: asOf } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: asOf } }] }],
    },
    OR: [{ starts_at: null }, { starts_at: { lte: asOf } }],
    AND: [
      { OR: [{ ends_at: null }, { ends_at: { gte: asOf } }] },
      {
        consents: {
          some: {
            revoked_at: null,
            consent_date: { lte: asOf },
            OR: [{ valid_until: null }, { valid_until: { gte: asOf } }],
          },
        },
      },
    ],
  };
}

describe('/api/pharmacy-visit-requests/[id]/decision POST', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    authContextFailureMock.mockReset();
    acquireAdvisoryTxLockMock.mockResolvedValue(undefined);
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'requested',
      share_case_id: 'share_case_1',
      partnership_id: 'partnership_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      updated_at: new Date(CURRENT_UPDATED_AT),
      share_case: { status: 'active' },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    patientShareCaseFindFirstMock.mockResolvedValue({ id: 'share_case_1' });
    pharmacyVisitRequestFindUniqueOrThrowMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'accepted',
      accepted_by: 'pharmacist_1',
      accepted_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
        },
        pharmacyVisitRequest: {
          findFirst: pharmacyVisitRequestFindFirstMock,
          updateMany: pharmacyVisitRequestUpdateManyMock,
          findUniqueOrThrow: pharmacyVisitRequestFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('accepts a requested visit request with a guarded status update', async () => {
    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const initialRequestWhere = pharmacyVisitRequestFindFirstMock.mock.calls[0]?.[0]?.where;
    const postLockShareCaseWhere = patientShareCaseFindFirstMock.mock.calls[0]?.[0]?.where;
    const { id: postLockShareCaseId, ...activeShareCaseWhere } = postLockShareCaseWhere;
    expect(postLockShareCaseId).toBe('share_case_1');
    expect(initialRequestWhere).toEqual(
      expect.objectContaining({
        id: 'visit_request_1',
        org_id: 'org_1',
        share_case: { is: activeShareCaseWhere },
      }),
    );
    expect(patientShareCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'share_case_1',
        ...activeShareCaseMutationWhere(),
      },
      select: { id: true },
    });
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'patient_share_case_consent',
      'org_1:share_case_1',
    );
    expect(acquireAdvisoryTxLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      patientShareCaseFindFirstMock.mock.invocationCallOrder[0],
    );
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: 'requested',
        updated_at: new Date(CURRENT_UPDATED_AT),
        share_case: {
          is: {
            ...activeShareCaseMutationWhere(),
          },
        },
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
      data: {
        status: 'accepted',
        accepted_by: 'user_1',
        accepted_at: new Date('2026-06-19T00:00:00.000Z'),
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_visit_request_accepted',
        changes: expect.objectContaining({
          decision: 'accept',
          previous_status: 'requested',
          actor_id: 'user_1',
        }),
      }),
    );
  });

  it('rejects caller-supplied actor attribution before RLS or workflow writes', async () => {
    const response = await rawPOST(
      createRequest({ decision: 'accept', pharmacist_id: 'cross_org_user' }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        pharmacist_id: ['実行者は認証情報から記録されるため指定できません'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('hides accept targets that are outside the current active-consent boundary', async () => {
    pharmacyVisitRequestFindFirstMock.mockResolvedValueOnce(null);

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '訪問依頼が見つかりません',
    });
    expect(acquireAdvisoryTxLockMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a generic conflict when consent changes after the initial active lookup', async () => {
    patientShareCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '患者共有ケースが更新されています。再読み込みしてください',
    });
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledOnce();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('fails closed without audit when active consent changes before the guarded accept update', async () => {
    pharmacyVisitRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問依頼はすでに更新されています',
    });
    expect(patientShareCaseFindFirstMock).toHaveBeenCalledOnce();
    expect(pharmacyVisitRequestFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('does not extend the accept-only consent gate to the deferred decline policy', async () => {
    pharmacyVisitRequestFindUniqueOrThrowMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'declined',
    });

    const response = await rawPOST(
      createRequest({
        decision: 'decline',
        decline_reason: '患者名 山田花子: スケジュール都合で不可',
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(acquireAdvisoryTxLockMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ share_case: { status: 'active' } }),
        data: expect.objectContaining({
          status: 'declined',
          declined_by: 'user_1',
          decline_reason: '患者名 山田花子: スケジュール都合で不可',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_visit_request_declined',
        changes: expect.objectContaining({ actor_id: 'user_1' }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).toContain('decline_reason_length');
    expect(auditText).not.toContain('山田花子');
  });

  it('rejects already decided visit requests before update or audit side effects', async () => {
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'accepted',
      share_case_id: 'share_case_1',
      partnership_id: 'partnership_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      updated_at: new Date(CURRENT_UPDATED_AT),
      share_case: { status: 'active' },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the visit request', async () => {
    const response = await rawPOST(
      createRequest({ decision: 'accept', expected_updated_at: undefined }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects stale expected_updated_at before update or audit side effects', async () => {
    const response = await rawPOST(
      createRequest({
        decision: 'accept',
        expected_updated_at: '2026-06-17T23:59:59.000Z',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問依頼が更新されています。再読み込みしてください',
    });
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns no-store validation before loading the visit request when decline reason is missing', async () => {
    const response = await rawPOST(createRequest({ decision: 'decline' }), routeContext);

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected decision failures and keeps sensitive responses no-store', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw visit_request_1 partner_pharmacy_1 山田花子 failure'),
    );

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('visit_request_1');
    expect(serialized).not.toContain('partner_pharmacy_1');
    expect(serialized).not.toContain('山田花子');
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('sanitizes auth plumbing failures before loading the visit request', async () => {
    authContextFailureMock.mockReturnValueOnce(
      new Error('raw auth visit_request_1 partner_pharmacy_1 decision failure'),
    );

    const response = await rawPOST(createRequest({ decision: 'accept' }), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('visit_request_1');
    expect(serialized).not.toContain('partner_pharmacy_1');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestFindFirstMock).not.toHaveBeenCalled();
  });
});
