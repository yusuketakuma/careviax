import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyVisitRequestFindFirstMock,
  pharmacyVisitRequestUpdateManyMock,
  pharmacyVisitRequestFindUniqueOrThrowMock,
  createAuditLogEntryMock,
  authContextFailureMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
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

describe('/api/pharmacy-visit-requests/[id]/decision POST', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    authContextFailureMock.mockReset();
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
    pharmacyVisitRequestFindUniqueOrThrowMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'accepted',
      accepted_by: 'pharmacist_1',
      accepted_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyVisitRequest: {
          findFirst: pharmacyVisitRequestFindFirstMock,
          updateMany: pharmacyVisitRequestUpdateManyMock,
          findUniqueOrThrow: pharmacyVisitRequestFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('accepts a requested visit request with a guarded status update', async () => {
    const response = await rawPOST(
      createRequest({ decision: 'accept', pharmacist_id: ' pharmacist_1 ' }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: 'requested',
        updated_at: new Date(CURRENT_UPDATED_AT),
        share_case: { status: 'active' },
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
      data: {
        status: 'accepted',
        accepted_by: 'pharmacist_1',
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
          actor_id: 'pharmacist_1',
        }),
      }),
    );
  });

  it('records decline metadata without raw decline reason in audit', async () => {
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
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'declined',
          declined_by: 'user_1',
          decline_reason: '患者名 山田花子: スケジュール都合で不可',
        }),
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
