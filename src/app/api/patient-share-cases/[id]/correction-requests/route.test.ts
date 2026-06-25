import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  pharmacyVisitRequestFindFirstMock,
  partnerVisitRecordFindFirstMock,
  claimCooperationNoteFindFirstMock,
  visitBillingCandidateFindFirstMock,
  correctionRequestFindManyMock,
  correctionRequestCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  pharmacyVisitRequestFindFirstMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  claimCooperationNoteFindFirstMock: vi.fn(),
  visitBillingCandidateFindFirstMock: vi.fn(),
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
import {
  patientShareCorrectionRequestPageSchema,
  patientShareCorrectionRequestRowSchema,
} from '@/lib/patient-share/correction-request-domain';

const routeContext = { params: Promise.resolve({ id: 'share_case_1' }) };

function createGetRequest(query = '') {
  return new NextRequest(
    `http://localhost/api/patient-share-cases/share_case_1/correction-requests${query}`,
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
    pharmacyVisitRequestFindFirstMock.mockResolvedValue(null);
    partnerVisitRecordFindFirstMock.mockResolvedValue({ id: 'partner_visit_record_1' });
    claimCooperationNoteFindFirstMock.mockResolvedValue(null);
    visitBillingCandidateFindFirstMock.mockResolvedValue(null);
    correctionRequestCreateMock.mockResolvedValue({
      id: 'correction_1',
      share_case_id: 'share_case_1',
      target_id: 'partner_visit_record_1',
      field_path: 'record_content',
      request_type: 'correction',
      target_type: 'partner_visit_record',
      target_owner: 'partner_pharmacy',
      status: 'open',
      requested_by: 'user_1',
      responded_by: null,
      resolved_by: null,
      resolved_at: null,
      created_at: new Date('2026-06-19T02:00:00.000Z'),
      updated_at: new Date('2026-06-19T02:00:00.000Z'),
      reason: '記録内容に確認したい点があります。患者名: 山田花子',
      proposed_value: { note: '住所 東京都港区1-2-3' },
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
          findFirst: pharmacyVisitRequestFindFirstMock,
        },
        partnerVisitRecord: {
          findFirst: partnerVisitRecordFindFirstMock,
        },
        claimCooperationNote: {
          findFirst: claimCooperationNoteFindFirstMock,
        },
        visitBillingCandidate: {
          findFirst: visitBillingCandidateFindFirstMock,
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
    const body = await response.json();
    expect(patientShareCorrectionRequestPageSchema.safeParse(body).success).toBe(true);
    expect(body.data[0]).toMatchObject({
      id: 'correction_1',
      target_type: 'partner_visit_record',
      field_path: 'record_content',
    });
    const bodyText = JSON.stringify(body);
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

  it.each([
    ['empty status', '?status='],
    ['blank status', '?status=%20%20'],
  ])('rejects explicitly %s filters before transaction side effects', async (_label, query) => {
    const response = await rawGET(createGetRequest(query), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { status: ['ステータスを指定してください'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(correctionRequestFindManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('trims valid status filters', async () => {
    const response = await rawGET(createGetRequest('?status=%20open%20'), routeContext);

    expect(response.status).toBe(200);
    expect(correctionRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'open',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        changes: expect.objectContaining({
          has_status_filter: true,
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
    const body = await response.json();
    expect(patientShareCorrectionRequestRowSchema.safeParse(body).success).toBe(true);
    const bodyText = JSON.stringify(body);
    expect(bodyText).toContain('correction_1');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('東京都港区1-2-3');
    expect(bodyText).not.toContain('proposed_value');
    expect(bodyText).not.toContain('reason');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
  });

  it('creates claim-note correction requests only through the share-case-owned visit record', async () => {
    claimCooperationNoteFindFirstMock.mockResolvedValue({ id: 'claim_note_1' });
    correctionRequestCreateMock.mockResolvedValueOnce({
      id: 'correction_claim_1',
      share_case_id: 'share_case_1',
      target_id: 'claim_note_1',
      field_path: 'claim_note_text',
      request_type: 'correction',
      target_type: 'claim_note',
      target_owner: 'base_pharmacy',
      status: 'open',
      requested_by: 'user_1',
      responded_by: null,
      resolved_by: null,
      resolved_at: null,
      created_at: new Date('2026-06-19T02:00:00.000Z'),
      updated_at: new Date('2026-06-19T02:00:00.000Z'),
    });

    const response = await rawPOST(
      createRequest({
        target_type: 'claim_note',
        target_id: 'claim_note_1',
        field_path: 'claim_note_text',
        reason: '請求連携メモの確認依頼',
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expect(claimCooperationNoteFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'claim_note_1',
        org_id: 'org_1',
        partner_visit_record: {
          share_case_id: 'share_case_1',
          org_id: 'org_1',
        },
      },
      select: { id: true },
    });
    expect(correctionRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_owner: 'base_pharmacy',
        target_type: 'claim_note',
        target_id: 'claim_note_1',
        field_path: 'claim_note_text',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        changes: expect.objectContaining({
          requester_owner: 'partner_pharmacy',
          target_owner: 'base_pharmacy',
          target_type: 'claim_note',
        }),
      }),
    );
  });

  it('creates billing-candidate correction requests only through the share-case-owned visit record', async () => {
    visitBillingCandidateFindFirstMock.mockResolvedValue({ id: 'billing_candidate_1' });
    correctionRequestCreateMock.mockResolvedValueOnce({
      id: 'correction_billing_1',
      share_case_id: 'share_case_1',
      target_id: 'billing_candidate_1',
      field_path: 'billing_status',
      request_type: 'correction',
      target_type: 'billing_candidate',
      target_owner: 'base_pharmacy',
      status: 'open',
      requested_by: 'user_1',
      responded_by: null,
      resolved_by: null,
      resolved_at: null,
      created_at: new Date('2026-06-19T02:00:00.000Z'),
      updated_at: new Date('2026-06-19T02:00:00.000Z'),
    });

    const response = await rawPOST(
      createRequest({
        target_type: 'billing_candidate',
        target_id: 'billing_candidate_1',
        field_path: 'billing_status',
        reason: '請求候補の確認依頼',
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expect(visitBillingCandidateFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'billing_candidate_1',
        org_id: 'org_1',
        partner_visit_record: {
          share_case_id: 'share_case_1',
          org_id: 'org_1',
        },
      },
      select: { id: true },
    });
    expect(correctionRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_owner: 'base_pharmacy',
        target_type: 'billing_candidate',
        target_id: 'billing_candidate_1',
        field_path: 'billing_status',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        changes: expect.objectContaining({
          requester_owner: 'partner_pharmacy',
          target_owner: 'base_pharmacy',
          target_type: 'billing_candidate',
        }),
      }),
    );
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

  it.each([
    ['care_case', 'case_other', 'notes'],
    ['management_plan', 'plan_other', 'content'],
  ])(
    'rejects %s targets that do not match the active share case before side effects',
    async (targetType, targetId, fieldPath) => {
      const response = await rawPOST(
        createRequest({
          target_type: targetType,
          target_id: targetId,
          field_path: fieldPath,
          reason: '共有ケース外の対象への修正依頼',
        }),
        routeContext,
      );

      expect(response.status).toBe(400);
      expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(claimCooperationNoteFindFirstMock).not.toHaveBeenCalled();
      expect(visitBillingCandidateFindFirstMock).not.toHaveBeenCalled();
      expect(correctionRequestCreateMock).not.toHaveBeenCalled();
      expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    },
  );

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
