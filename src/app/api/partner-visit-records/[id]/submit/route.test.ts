import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  withOrgContextMock,
  partnerVisitRecordFindFirstMock,
  partnerVisitRecordUpdateManyMock,
  partnerVisitRecordFindUniqueOrThrowMock,
  pharmacyVisitRequestUpdateManyMock,
  dispatchNotificationEventMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordUpdateManyMock: vi.fn(),
  partnerVisitRecordFindUniqueOrThrowMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { POST as rawPOST } from './route';

function createRouteContext(recordId = 'partner_visit_record_1') {
  return { params: Promise.resolve({ id: recordId }) };
}

const routeContext = createRouteContext();
const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';

function createRequest(recordId = 'partner_visit_record_1', body: unknown = undefined) {
  const requestBody = body ?? { expected_updated_at: CURRENT_UPDATED_AT };
  return new NextRequest(
    `http://localhost/api/partner-visit-records/${encodeURIComponent(recordId)}/submit`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
  );
}

describe('/api/partner-visit-records/[id]/submit POST', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'draft',
      updated_at: new Date(CURRENT_UPDATED_AT),
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      revision_no: 1,
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      attachments: [{ file_id: 'file_1' }],
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      share_case: { status: 'active' },
      visit_request: {
        status: 'recording',
        requested_by: 'base_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
    });
    partnerVisitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    dispatchNotificationEventMock.mockResolvedValue([{ id: 'notification_1' }]);
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'submitted',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      revision_no: 1,
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'submitted', urgency: 'normal' },
      claim_note: null,
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        partnerVisitRecord: {
          findFirst: partnerVisitRecordFindFirstMock,
          updateMany: partnerVisitRecordUpdateManyMock,
          findUniqueOrThrow: partnerVisitRecordFindUniqueOrThrowMock,
        },
        pharmacyVisitRequest: {
          updateMany: pharmacyVisitRequestUpdateManyMock,
        },
      }),
    );
  });

  it('submits a draft record and notifies the base pharmacy without completing or billing it yet', async () => {
    const rawRecordId = 'partner_visit_record/1?tab=x#frag';
    const encodedRecordHref = `/partner-visit-records/${encodeURIComponent(rawRecordId)}`;
    partnerVisitRecordFindFirstMock.mockResolvedValueOnce({
      id: rawRecordId,
      status: 'draft',
      updated_at: new Date(CURRENT_UPDATED_AT),
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      revision_no: 1,
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      attachments: [{ file_id: 'file_1' }],
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      share_case: { status: 'active' },
      visit_request: {
        status: 'recording',
        requested_by: 'base_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
    });
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValueOnce({
      id: rawRecordId,
      status: 'submitted',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      revision_no: 1,
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'submitted', urgency: 'normal' },
      claim_note: null,
    });

    const response = await rawPOST(createRequest(rawRecordId), createRouteContext(rawRecordId));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: rawRecordId,
        org_id: 'org_1',
        status: { in: ['draft', 'returned'] },
        updated_at: new Date(CURRENT_UPDATED_AT),
        share_case: { status: 'active' },
        owner_partner_pharmacy: { status: 'active' },
        visit_request: {
          status: { in: ['accepted', 'recording', 'returned'] },
          partnership: {
            status: 'active',
            partner_pharmacy: { status: 'active' },
          },
        },
      },
      data: {
        status: 'submitted',
        submitted_at: new Date('2026-06-19T00:00:00.000Z'),
        returned_at: null,
        returned_by: null,
        returned_reason: null,
      },
    });
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: { in: ['accepted', 'recording', 'returned'] },
      },
      data: { status: 'submitted' },
    });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'pharmacy_partner_visit_record_submitted',
        type: 'business',
        title: '協力訪問記録が提出されました',
        message: 'アプリで協力訪問記録を確認してください',
        link: encodedRecordHref,
        explicitUserIds: ['base_user_1'],
        metadata: {
          partner_visit_record_id: rawRecordId,
          visit_request_id: 'visit_request_1',
          share_case_id: 'share_case_1',
        },
        dedupeKey: `pharmacy_partner_visit_record_submitted:${rawRecordId}:2026-06-19T00:00:00.000Z`,
      }),
    );
    expect(partnerVisitRecordFindUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_org_id: { id: rawRecordId, org_id: 'org_1' } },
      }),
    );
    expect(JSON.stringify(dispatchNotificationEventMock.mock.calls)).not.toContain('山田');
    expect(JSON.stringify(dispatchNotificationEventMock.mock.calls)).not.toContain(
      `/partner-visit-records/${rawRecordId}`,
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'partner_visit_record_submitted',
        targetId: rawRecordId,
        changes: expect.objectContaining({
          previous_status: 'draft',
          status: 'submitted',
          visit_request_status_before: 'recording',
          visit_request_status_after: 'submitted',
          notify_base_pharmacy: true,
          notification_count: 1,
          attachment_count: 1,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ notify_base_pharmacy: true });
  });

  it('rejects already submitted records before update, claim, or audit side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'submitted',
      updated_at: new Date(CURRENT_UPDATED_AT),
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      revision_no: 1,
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      attachments: null,
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      share_case: { status: 'active' },
      visit_request: {
        status: 'submitted',
        requested_by: 'base_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the partner visit record', async () => {
    const response = await rawPOST(createRequest('partner_visit_record_1', {}), routeContext);

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects stale expected_updated_at before update or notification side effects', async () => {
    const response = await rawPOST(
      createRequest('partner_visit_record_1', {
        expected_updated_at: '2026-06-17T23:59:59.000Z',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '協力訪問記録が更新されています。再読み込みしてください',
    });
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns conflict and skips downstream effects when the visit request transition loses the race', async () => {
    pharmacyVisitRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when submit reads fail unexpectedly', async () => {
    const rawError = '患者A 03-1111-2222 partner visit submit failure';
    partnerVisitRecordFindFirstMock.mockRejectedValueOnce(new Error(rawError));

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
