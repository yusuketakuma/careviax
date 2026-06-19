import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  partnerVisitRecordFindFirstMock,
  correctionRequestFindManyMock,
  correctionRequestCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  correctionRequestFindManyMock: vi.fn(),
  correctionRequestCreateMock: vi.fn(),
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
          actorSiteId: 'site_1',
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

const routeContext = { params: Promise.resolve({ id: 'share_case_1' }) };

function createGetRequest() {
  return new NextRequest(
    'http://localhost/api/patient-share-cases/share_case_1/correction-requests',
    {
      method: 'GET',
    },
  );
}

function createRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/patient-share-cases/share_case_1/correction-requests',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('/api/patient-share-cases/[id]/correction-requests POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'active',
      base_patient_id: 'patient_1',
      base_case_id: 'case_1',
      shared_management_plan_id: 'plan_1',
    });
    partnerVisitRecordFindFirstMock.mockResolvedValue({ id: 'partner_visit_record_1' });
    correctionRequestCreateMock.mockResolvedValue({
      id: 'correction_1',
      status: 'open',
      target_type: 'partner_visit_record',
      target_owner: 'partner_pharmacy',
    });
    correctionRequestFindManyMock.mockResolvedValue([
      {
        id: 'correction_1',
        share_case_id: 'share_case_1',
        target_owner: 'partner_pharmacy',
        target_type: 'partner_visit_record',
        target_id: 'partner_visit_record_1',
        field_path: 'record_content',
        request_type: 'correction',
        status: 'open',
        requested_by: 'user_1',
        responded_by: null,
        resolved_by: null,
        resolved_at: null,
        created_at: new Date('2026-06-19T01:00:00.000Z'),
        updated_at: new Date('2026-06-19T01:00:00.000Z'),
        reason: '患者名 山田花子',
        proposed_value: { address: '東京都港区1-2-3' },
        response_note: '確認済み',
      },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
        },
        pharmacyVisitRequest: {
          findFirst: vi.fn(),
        },
        partnerVisitRecord: {
          findFirst: partnerVisitRecordFindFirstMock,
        },
        claimCooperationNote: {
          findFirst: vi.fn(),
        },
        visitBillingCandidate: {
          findFirst: vi.fn(),
        },
        patientShareCorrectionRequest: {
          findMany: correctionRequestFindManyMock,
          create: correctionRequestCreateMock,
        },
      }),
    );
  });

  it('lists correction requests without raw reason, response note, or proposed value', async () => {
    const response = await rawGET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(correctionRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          reason: true,
          proposed_value: true,
          response_note: true,
        }),
      }),
    );
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain('患者名');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('東京都港区1-2-3');
    expect(bodyText).not.toContain('確認済み');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
      }),
      expect.objectContaining({
        action: 'patient_share_correction_requests_viewed',
        targetType: 'PatientShareCorrectionRequest',
        targetId: 'share_case_1',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          target_screen: 'patient_share_case_correction_requests',
          share_case_id: 'share_case_1',
          viewed_count: 1,
          correction_request_ids: ['correction_1'],
          statuses: ['open'],
        }),
      }),
    );
  });

  it('creates a correction request only for a target that belongs to the share case', async () => {
    const response = await rawPOST(
      createRequest({
        target_type: 'partner_visit_record',
        target_id: 'partner_visit_record_1',
        field_path: 'record_content',
        request_type: 'correction',
        reason: '記録内容に確認したい点があります。患者名: 山田花子',
        proposed_value: { note: '住所 東京都港区1-2-3' },
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expect(partnerVisitRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'partner_visit_record_1', org_id: 'org_1', share_case_id: 'share_case_1' },
      select: { id: true },
    });
    expect(correctionRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        target_owner: 'partner_pharmacy',
        target_type: 'partner_visit_record',
        field_path: 'record_content',
        requested_by: 'user_1',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', actorSiteId: 'site_1' }),
      expect.objectContaining({
        action: 'patient_share_correction_requested',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          requester_owner: 'base_pharmacy',
          target_owner: 'partner_pharmacy',
          reason_length: expect.any(Number),
          has_proposed_value: true,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
  });

  it('rejects unapproved field paths before target lookup or create side effects', async () => {
    const response = await rawPOST(
      createRequest({
        target_type: 'patient_profile',
        field_path: 'medical_insurance_number',
        reason: '保険番号を変更したい',
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(correctionRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects targets that do not belong to the share case before create or audit side effects', async () => {
    partnerVisitRecordFindFirstMock.mockResolvedValue(null);

    const response = await rawPOST(
      createRequest({
        target_type: 'partner_visit_record',
        target_id: 'partner_visit_record_other',
        field_path: 'record_content',
        reason: '記録の修正依頼',
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(correctionRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects correction requests for inactive share cases before target lookup', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'revoked',
      base_patient_id: 'patient_1',
      base_case_id: 'case_1',
      shared_management_plan_id: 'plan_1',
    });

    const response = await rawPOST(
      createRequest({
        target_type: 'partner_visit_record',
        target_id: 'partner_visit_record_1',
        field_path: 'record_content',
        reason: '記録の修正依頼',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(correctionRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
