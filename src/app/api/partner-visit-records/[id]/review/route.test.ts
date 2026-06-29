import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerVisitRecordFindFirstMock,
  partnerVisitRecordUpdateManyMock,
  partnerVisitRecordFindUniqueOrThrowMock,
  pharmacyVisitRequestUpdateManyMock,
  claimCooperationNoteUpsertMock,
  dispatchNotificationEventMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordUpdateManyMock: vi.fn(),
  partnerVisitRecordFindUniqueOrThrowMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  claimCooperationNoteUpsertMock: vi.fn(),
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

function createRequest(body: unknown, recordId = 'partner_visit_record_1') {
  return new NextRequest(
    `http://localhost/api/partner-visit-records/${encodeURIComponent(recordId)}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/partner-visit-records/[id]/review POST', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'submitted',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      revision_no: 1,
      share_case: { status: 'active' },
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      visit_request: {
        status: 'submitted',
        accepted_by: 'partner_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
          base_site: { id: 'site_1', name: '基幹薬局' },
        },
      },
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    claimCooperationNoteUpsertMock.mockResolvedValue({ id: 'claim_note_1' });
    dispatchNotificationEventMock.mockResolvedValue([{ id: 'notification_1' }]);
    partnerVisitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'confirmed',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'confirmed', urgency: 'normal' },
      claim_note: { id: 'claim_note_1', claim_status: 'pending' },
    });
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
        claimCooperationNote: {
          upsert: claimCooperationNoteUpsertMock,
        },
      }),
    );
  });

  it('confirms a submitted partner visit record, marks the request confirmed, and creates claim support', async () => {
    const rawRecordId = 'partner_visit_record/1?tab=x#frag';
    const encodedRecordHref = `/partner-visit-records/${encodeURIComponent(rawRecordId)}`;
    partnerVisitRecordFindFirstMock.mockResolvedValueOnce({
      id: rawRecordId,
      status: 'submitted',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      revision_no: 1,
      share_case: { status: 'active' },
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      visit_request: {
        status: 'submitted',
        accepted_by: 'partner_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
          base_site: { id: 'site_1', name: '基幹薬局' },
        },
      },
    });
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValueOnce({
      id: rawRecordId,
      status: 'confirmed',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'confirmed', urgency: 'normal' },
      claim_note: { id: 'claim_note_1', claim_status: 'pending' },
    });

    const response = await rawPOST(
      createRequest({ decision: 'confirm', doctor_report_required: true }, rawRecordId),
      createRouteContext(rawRecordId),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: 'submitted',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
      data: { status: 'confirmed', completed_at: new Date('2026-06-19T00:00:00.000Z') },
    });
    expect(partnerVisitRecordUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      pharmacyVisitRequestUpdateManyMock.mock.invocationCallOrder[0],
    );
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: rawRecordId,
        org_id: 'org_1',
        status: 'submitted',
        share_case: { status: 'active' },
        owner_partner_pharmacy: { status: 'active' },
        visit_request: {
          status: 'submitted',
          partnership: {
            status: 'active',
            partner_pharmacy: { status: 'active' },
          },
        },
      },
      data: {
        status: 'confirmed',
        confirmed_at: new Date('2026-06-19T00:00:00.000Z'),
        confirmed_by: 'user_1',
        base_confirmation_snapshot: {
          doctor_report_required: true,
          next_action: 'doctor_report_draft',
          confirmed_at: '2026-06-19T00:00:00.000Z',
        },
      },
    });
    expect(claimCooperationNoteUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          partner_visit_record_id_org_id: {
            partner_visit_record_id: rawRecordId,
            org_id: 'org_1',
          },
        },
        create: expect.objectContaining({
          org_id: 'org_1',
          partner_visit_record_id: rawRecordId,
          partner_pharmacy_name: '協力薬局',
          prescription_received_by: '基幹薬局',
          dispensing_pharmacy_name: '基幹薬局',
          claim_status: 'pending',
        }),
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'pharmacy_partner_visit_record_confirmed',
        type: 'business',
        title: '協力訪問記録が確認されました',
        message: 'アプリで協力訪問記録の確認結果を確認してください',
        link: encodedRecordHref,
        explicitUserIds: ['partner_user_1'],
        metadata: {
          partner_visit_record_id: rawRecordId,
          visit_request_id: 'visit_request_1',
          share_case_id: 'share_case_1',
          decision: 'confirm',
          status: 'confirmed',
        },
        dedupeKey: `pharmacy_partner_visit_record_confirmed:${rawRecordId}:2026-06-19T00:00:00.000Z`,
      }),
    );
    expect(partnerVisitRecordFindUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_org_id: { id: rawRecordId, org_id: 'org_1' } },
      }),
    );
    expect(JSON.stringify(dispatchNotificationEventMock.mock.calls)).not.toContain(
      `/partner-visit-records/${rawRecordId}`,
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'partner_visit_record_confirmed',
        targetId: rawRecordId,
        changes: expect.objectContaining({
          decision: 'confirm',
          previous_status: 'submitted',
          status: 'confirmed',
          visit_request_status: 'confirmed',
          doctor_report_required: true,
          notify_partner_pharmacy: true,
          notification_count: 1,
          notification_event_type: 'pharmacy_partner_visit_record_confirmed',
        }),
      }),
    );
  });

  it('stores partner visit claim support dates as Japan business date sentinels', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValueOnce({
      id: 'partner_visit_record_1',
      status: 'submitted',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      visit_at: new Date('2026-06-19T15:30:00.000Z'),
      revision_no: 1,
      share_case: { status: 'active' },
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      visit_request: {
        status: 'submitted',
        accepted_by: 'partner_user_1',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
          base_site: { id: 'site_1', name: '基幹薬局' },
        },
      },
    });

    const response = await rawPOST(createRequest({ decision: 'confirm' }), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(claimCooperationNoteUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          visit_date: new Date('2026-06-20T00:00:00.000Z'),
          claim_note_text: '協力薬局:協力薬局 / 訪問日:2026-06-20 / 処方箋受付薬局:基幹薬局',
        }),
        update: expect.objectContaining({
          visit_date: new Date('2026-06-20T00:00:00.000Z'),
          claim_note_text: '協力薬局:協力薬局 / 訪問日:2026-06-20 / 処方箋受付薬局:基幹薬局',
        }),
      }),
    );
  });

  it('returns a submitted record without putting raw return reason in audit', async () => {
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'returned',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'returned', urgency: 'normal' },
      claim_note: null,
    });

    const response = await rawPOST(
      createRequest({
        decision: 'return',
        return_reason: '患者名 山田花子: 残薬数量の根拠を追記してください',
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visit_request: expect.objectContaining({ status: 'submitted' }),
        }),
        data: expect.objectContaining({
          status: 'returned',
          returned_by: 'user_1',
          returned_reason: expect.anything(),
        }),
      }),
    );
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: 'submitted',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      },
      data: { status: 'returned', completed_at: null },
    });
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'pharmacy_partner_visit_record_returned',
        title: '協力訪問記録が差戻されました',
        message: 'アプリで協力訪問記録の差戻し内容を確認してください',
        explicitUserIds: ['partner_user_1'],
        metadata: expect.objectContaining({
          decision: 'return',
          status: 'returned',
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).toContain('return_reason_length');
    expect(auditText).toContain('notification_count');
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('残薬数量');
  });

  it('rejects non-submitted records before update or audit side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'draft',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      revision_no: 1,
      share_case: { status: 'active' },
      owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
      visit_request: {
        status: 'submitted',
        partnership_id: 'partnership_1',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
          base_site: { id: 'site_1', name: '基幹薬局' },
        },
      },
    });

    const response = await rawPOST(createRequest({ decision: 'confirm' }), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns conflict and skips downstream effects when the visit request transition loses the race after record update', async () => {
    pharmacyVisitRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await rawPOST(createRequest({ decision: 'confirm' }), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalled();
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when review reads fail unexpectedly', async () => {
    const rawError = '患者A 03-1111-2222 partner visit review failure';
    partnerVisitRecordFindFirstMock.mockRejectedValueOnce(new Error(rawError));

    const response = await rawPOST(createRequest({ decision: 'confirm' }), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
