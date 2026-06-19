import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerVisitRecordFindManyMock,
  pharmacyVisitRequestFindFirstMock,
  sourceVisitRecordFindFirstMock,
  partnerVisitRecordFindFirstMock,
  partnerVisitRecordCreateMock,
  partnerVisitRecordUpdateManyMock,
  partnerVisitRecordFindUniqueOrThrowMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindManyMock: vi.fn(),
  pharmacyVisitRequestFindFirstMock: vi.fn(),
  sourceVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordCreateMock: vi.fn(),
  partnerVisitRecordUpdateManyMock: vi.fn(),
  partnerVisitRecordFindUniqueOrThrowMock: vi.fn(),
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/partner-visit-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/partner-visit-records POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'accepted',
      share_case_id: 'share_case_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      share_case: {
        status: 'active',
        base_patient_id: 'patient_1',
      },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });
    sourceVisitRecordFindFirstMock.mockResolvedValue({ id: 'visit_record_1' });
    partnerVisitRecordFindFirstMock.mockResolvedValue(null);
    partnerVisitRecordCreateMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      revision_no: 1,
      status: 'draft',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
      claim_note: null,
    });
    partnerVisitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    partnerVisitRecordFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      visit_request_id: 'visit_request_1',
      share_case_id: 'share_case_1',
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
      revision_no: 1,
      status: 'draft',
      visit_at: new Date('2026-06-20T01:30:00.000Z'),
      owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
      claim_note: null,
    });
    partnerVisitRecordFindManyMock.mockResolvedValue([
      {
        id: 'partner_visit_record_1',
        org_id: 'org_1',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_pharmacy_1',
        source_visit_record_id: 'visit_record_1',
        revision_no: 1,
        status: 'submitted',
        pharmacist_id: 'pharmacist_1',
        pharmacist_name: '協力 太郎',
        visit_at: new Date('2026-06-20T01:30:00.000Z'),
        submitted_at: new Date('2026-06-20T02:00:00.000Z'),
        confirmed_at: null,
        confirmed_by: null,
        returned_at: null,
        returned_by: null,
        created_at: new Date('2026-06-20T01:30:00.000Z'),
        updated_at: new Date('2026-06-20T02:00:00.000Z'),
        record_content: {
          medication_adherence: '患者名 山田花子: 飲み忘れあり',
          remaining_medications: 'A薬 10錠',
        },
        attachments: [{ file_id: 'file_1' }],
        returned_reason: null,
        base_confirmation_snapshot: null,
        owner_partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
        visit_request: { id: 'visit_request_1', status: 'accepted', urgency: 'normal' },
        claim_note: null,
      },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyVisitRequest: {
          findFirst: pharmacyVisitRequestFindFirstMock,
        },
        visitRecord: {
          findFirst: sourceVisitRecordFindFirstMock,
        },
        partnerVisitRecord: {
          findMany: partnerVisitRecordFindManyMock,
          findFirst: partnerVisitRecordFindFirstMock,
          create: partnerVisitRecordCreateMock,
          updateMany: partnerVisitRecordUpdateManyMock,
          findUniqueOrThrow: partnerVisitRecordFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('lists records only through active patient share cases with active consent', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/partner-visit-records?share_case_id=share_case_1&status=submitted',
      ),
    );

    expect(response.status).toBe(200);
    const where = partnerVisitRecordFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'submitted',
        share_case_id: 'share_case_1',
      }),
    );
    expect(where.share_case.is).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'active',
        partnership: {
          status: 'active',
          partner_pharmacy: { status: 'active' },
        },
      }),
    );
    expect(JSON.stringify(where.share_case.is)).toContain('"revoked_at":null');
    expect(JSON.stringify(where.share_case.is)).toContain('"valid_until":null');
    const responseText = JSON.stringify(await response.json());
    expect(responseText).toContain('has_record_content');
    expect(responseText).toContain('attachment_count');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('A薬');
  });

  it('creates a partner-owned draft record for an accepted request without auditing clinical content', async () => {
    const response = await POST(
      createRequest({
        visit_request_id: ' visit_request_1 ',
        pharmacist_id: 'pharmacist_1',
        pharmacist_name: '協力 太郎',
        visit_at: '2026-06-20T01:30:00.000Z',
        source_visit_record_id: 'visit_record_1',
        record_content: {
          medication_adherence: '患者名 山田花子: 飲み忘れあり',
          remaining_medications: 'A薬 10錠',
          suspected_adverse_effects: '眠気',
          storage_status: '冷蔵庫保管',
          proposals: '医師へ減量提案',
        },
        attachments: [{ file_id: 'file_1' }],
      }),
    );

    expect(response.status).toBe(201);
    expect(sourceVisitRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'visit_record_1', org_id: 'org_1', patient_id: 'patient_1' },
      select: { id: true },
    });
    expect(partnerVisitRecordCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        visit_request_id: 'visit_request_1',
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_pharmacy_1',
        revision_no: 1,
        status: 'draft',
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'partner_visit_record_created',
        targetType: 'PartnerVisitRecord',
        targetId: 'partner_visit_record_1',
        changes: expect.objectContaining({
          record_content_keys: [
            'medication_adherence',
            'proposals',
            'remaining_medications',
            'storage_status',
            'suspected_adverse_effects',
          ],
          attachment_count: 1,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('飲み忘れ');
    expect(auditText).not.toContain('A薬');
    const responseText = JSON.stringify(await response.json());
    expect(responseText).toContain('has_record_content');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('飲み忘れ');
    expect(responseText).not.toContain('A薬');
  });

  it('rejects unaccepted visit requests before record or audit side effects', async () => {
    pharmacyVisitRequestFindFirstMock.mockResolvedValue({
      id: 'visit_request_1',
      status: 'requested',
      share_case_id: 'share_case_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      share_case: { status: 'active', base_patient_id: 'patient_1' },
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    expect(partnerVisitRecordCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects submitted records before draft overwrite side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      id: 'partner_visit_record_1',
      status: 'submitted',
      revision_no: 1,
      owner_partner_pharmacy_id: 'partner_pharmacy_1',
    });

    const response = await POST(
      createRequest({
        visit_request_id: 'visit_request_1',
        visit_at: '2026-06-20T01:30:00.000Z',
        record_content: { medication_adherence: '確認済み' },
      }),
    );

    expect(response.status).toBe(409);
    expect(partnerVisitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
