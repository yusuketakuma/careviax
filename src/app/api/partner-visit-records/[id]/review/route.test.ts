import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerVisitRecordFindFirstMock,
  partnerVisitRecordUpdateManyMock,
  partnerVisitRecordFindUniqueOrThrowMock,
  pharmacyVisitRequestUpdateManyMock,
  claimCooperationNoteUpsertMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordUpdateManyMock: vi.fn(),
  partnerVisitRecordFindUniqueOrThrowMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  claimCooperationNoteUpsertMock: vi.fn(),
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

import { POST as rawPOST } from './route';

const routeContext = { params: Promise.resolve({ id: 'partner_visit_record_1' }) };

function createRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/partner-visit-records/partner_visit_record_1/review',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
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
    const response = await rawPOST(
      createRequest({ decision: 'confirm', doctor_report_required: true }),
      routeContext,
    );

    expect(response.status).toBe(200);
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
    expect(partnerVisitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'partner_visit_record_1',
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
        create: expect.objectContaining({
          org_id: 'org_1',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_pharmacy_name: '協力薬局',
          prescription_received_by: '基幹薬局',
          dispensing_pharmacy_name: '基幹薬局',
          claim_status: 'pending',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'partner_visit_record_confirmed',
        changes: expect.objectContaining({
          decision: 'confirm',
          previous_status: 'submitted',
          status: 'confirmed',
          visit_request_status: 'confirmed',
          doctor_report_required: true,
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
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).toContain('return_reason_length');
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
    expect(pharmacyVisitRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(claimCooperationNoteUpsertMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
