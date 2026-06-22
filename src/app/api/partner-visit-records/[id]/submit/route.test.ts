import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function createRequest(recordId = 'partner_visit_record_1') {
  return new NextRequest(
    `http://localhost/api/partner-visit-records/${encodeURIComponent(recordId)}/submit`,
    {
      method: 'POST',
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
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: rawRecordId,
        org_id: 'org_1',
        status: { in: ['draft', 'returned'] },
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
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
