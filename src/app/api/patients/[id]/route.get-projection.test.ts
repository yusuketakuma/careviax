import { createRequest, patientRouteMocks } from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  auditLogFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  billingEvidenceFindManyMock,
  careCaseFindManyMock,
  externalAccessGrantFindManyMock,
  firstVisitDocumentFindManyMock,
  medicationCycleFindManyMock,
  patientFindFirstMock,
  patientVisitBriefMock,
  requireAuthContextMock,
  visitScheduleCountMock,
} = patientRouteMocks;

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: Record<string, unknown>,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        const authResult = await patientRouteMocks.requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        return noStore(await handler(req, authResult.ctx, routeContext));
      } catch {
        return noStore(
          Response.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          ),
        );
      }
    },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: patientRouteMocks.validateOrgReferencesMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientRouteMocks.patientFindFirstMock,
      findMany: patientRouteMocks.patientFindManyMock,
    },
    medicationProfile: {
      findMany: patientRouteMocks.medicationProfileFindManyMock,
    },
    visitSchedule: {
      findMany: patientRouteMocks.visitScheduleFindManyMock,
      count: patientRouteMocks.visitScheduleCountMock,
    },
    visitRecord: {
      findMany: patientRouteMocks.visitRecordFindManyMock,
      findFirst: patientRouteMocks.visitRecordFindFirstMock,
    },
    careReport: {
      findMany: patientRouteMocks.careReportFindManyMock,
    },
    communicationEvent: {
      findMany: patientRouteMocks.communicationEventFindManyMock,
    },
    patientSelfReport: {
      findMany: patientRouteMocks.patientSelfReportFindManyMock,
    },
    externalAccessGrant: {
      findMany: patientRouteMocks.externalAccessGrantFindManyMock,
    },
    task: {
      findMany: patientRouteMocks.taskFindManyMock,
    },
    medicationIssue: {
      findMany: patientRouteMocks.medicationIssueFindManyMock,
    },
    inquiryRecord: {
      findMany: patientRouteMocks.inquiryRecordFindManyMock,
    },
    prescriptionIntake: {
      findMany: patientRouteMocks.prescriptionIntakeFindManyMock,
    },
    medicationCycle: {
      findMany: patientRouteMocks.medicationCycleFindManyMock,
    },
    dispenseResult: {
      findMany: patientRouteMocks.dispenseResultFindManyMock,
    },
    managementPlan: {
      findMany: patientRouteMocks.managementPlanFindManyMock,
    },
    firstVisitDocument: {
      findMany: patientRouteMocks.firstVisitDocumentFindManyMock,
    },
    conferenceNote: {
      findMany: patientRouteMocks.conferenceNoteFindManyMock,
    },
    auditLog: {
      findMany: patientRouteMocks.auditLogFindManyMock,
    },
    billingEvidence: {
      findMany: patientRouteMocks.billingEvidenceFindManyMock,
    },
    billingCandidate: {
      findMany: patientRouteMocks.billingCandidateFindManyMock,
    },
    patientLabObservation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: patientRouteMocks.userFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: patientRouteMocks.communicationQueueMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: patientRouteMocks.billingEvidenceBlockersMock,
}));

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: patientRouteMocks.patientRiskSummaryMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: patientRouteMocks.patientHomeCareFeatureSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientRouteMocks.patientVisitBriefMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: patientRouteMocks.withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  FacilityUnitReferenceValidationError: class FacilityUnitReferenceValidationError extends Error {},
  assertFacilityReference: patientRouteMocks.assertFacilityReferenceMock,
  assertFacilityUnitReference: vi.fn(),
  getFacilityVisitDefaults: patientRouteMocks.getFacilityVisitDefaultsMock,
}));

import { GET } from './route';

describe('/api/patients/[id] GET projections', () => {
  it('masks insurance and address details for external viewers in the response payload', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_ext',
        role: 'external_viewer',
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      phone: '090-1234-5678',
      medical_insurance_number: '1234567890',
      care_insurance_number: '9988776655',
      residences: [
        {
          id: 'res_1',
          address: '東京都千代田区1-2-3',
        },
      ],
      contacts: [
        {
          id: 'contact_1',
          name: '長男 山田',
          phone: '03-1234-5678',
          fax: '03-9999-9999',
          email: 'family@example.com',
          address: '東京都千代田区4-5-6',
        },
      ],
      conditions: [],
      consents: [],
      cases: [],
    });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        phone: '***-****-5678',
        medical_insurance_number: '***-890',
        care_insurance_number: '***-655',
        residences: [
          {
            address: '東京都千代田***',
          },
        ],
        contacts: [
          {
            phone: '***-****-5678',
            fax: '***-****-9999',
            email: 'f***@example.com',
            address: '東京都千代田***',
          },
        ],
        privacy: {
          sensitive_fields_masked: true,
          address_fields_masked: true,
          can_view_detail: false,
        },
        patient_share_permissions: {
          can_create_external_share: false,
          can_create_reply_request: false,
          can_create_followup_task: false,
        },
      },
    });
  });

  it('projects patient share action permissions from the authenticated role', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_trainee',
        role: 'pharmacist_trainee',
      },
    });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient_share_permissions: {
          can_create_external_share: false,
          can_create_reply_request: true,
          can_create_followup_task: true,
        },
      },
    });
  });

  it('separates clerk follow-up operations from clinical and external-share actions', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_clerk',
        role: 'clerk',
      },
    });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient_share_permissions: {
          can_create_external_share: false,
          can_create_reply_request: true,
          can_create_followup_task: true,
        },
      },
    });
  });

  it.each(['owner', 'admin'] as const)(
    'allows %s to create a follow-up task for an unassigned readable patient',
    async (role) => {
      requireAuthContextMock.mockResolvedValue({
        ctx: {
          orgId: 'corg1234567890123456789012',
          userId: `${role}_1`,
          role,
        },
      });
      careCaseFindManyMock.mockResolvedValueOnce([]);

      const response = await GET(
        createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          patient_share_permissions: {
            can_create_followup_task: true,
          },
        },
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each(['pharmacist', 'pharmacist_trainee'] as const)(
    'denies %s follow-up task affordance for an unassigned readable patient',
    async (role) => {
      requireAuthContextMock.mockResolvedValue({
        ctx: {
          orgId: 'corg1234567890123456789012',
          userId: `${role}_1`,
          role,
        },
      });
      careCaseFindManyMock.mockResolvedValueOnce([]);

      const response = await GET(
        createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          patient_share_permissions: {
            can_create_followup_task: false,
          },
        },
      });
      expect(careCaseFindManyMock).toHaveBeenCalledWith({
        where: {
          org_id: 'corg1234567890123456789012',
          AND: [
            {
              OR: [
                { primary_pharmacist_id: `${role}_1` },
                { backup_pharmacist_id: `${role}_1` },
                { visit_schedules: { some: { pharmacist_id: `${role}_1` } } },
              ],
            },
          ],
        },
        select: { id: true, patient_id: true },
      });
    },
  );

  it('filters external shares by assigned case boundary and strips stored boundary scope', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      phone: '090-1234-5678',
      medical_insurance_number: '1234567890',
      care_insurance_number: '9988776655',
      residences: [],
      contacts: [],
      conditions: [],
      consents: [],
      cases: [{ id: 'case_1' }],
    });
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'grant_visible',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '09012345678',
        scope: { care_reports: true, allowed_case_ids: ['case_1'] },
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        id: 'grant_patient_only',
        granted_to_name: '患者家族',
        granted_to_contact: null,
        scope: { medication_list: true },
        expires_at: new Date('2026-04-04T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          revoked_at: null,
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case_1'] } },
              ]),
            }),
          ]),
        }),
        take: 8,
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(payload.data.external_shares).toEqual([
      expect.objectContaining({
        id: 'grant_visible',
        scope: { care_reports: true },
      }),
      expect.objectContaining({
        id: 'grant_patient_only',
        scope: { medication_list: true },
      }),
    ]);
    expect(JSON.stringify(payload.data.external_shares)).not.toContain('grant_hidden');
    expect(JSON.stringify(payload.data.external_shares)).not.toContain('allowed_case_ids');
  });

  it('includes first-visit documents with normalized emergency contacts', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        id: 'first_visit_1',
        case_id: 'case_1',
        emergency_contacts: [
          null,
          ['legacy-bad-value'],
          {
            id: 'contact_1',
            name: '長男 山田',
            relation: 'child',
            phone: '090-0000-1111',
            is_primary: true,
            is_emergency_contact: true,
          },
        ],
        document_url: '/api/visit-records/record_1/pdf',
        delivered_at: new Date('2026-03-26T10:30:00.000Z'),
        delivered_to: '長男 山田',
        created_at: new Date('2026-03-26T10:00:00.000Z'),
        updated_at: new Date('2026-03-26T10:30:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
        first_visit_documents: [
          {
            id: 'first_visit_1',
            case_id: 'case_1',
            delivered_to: '長男 山田',
            emergency_contacts: [
              {
                id: 'contact_1',
                name: '長男 山田',
                relation: 'child',
                phone: '090-0000-1111',
                is_primary: true,
                is_emergency_contact: true,
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(payload.data.first_visit_documents)).not.toContain('document_url');
    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          document_url: true,
        }),
      }),
    );
  });

  it('omits billing candidate activity for roles without billing management permission', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_trainee',
        role: 'pharmacist_trainee',
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1' }]);
    billingEvidenceFindManyMock.mockResolvedValue([
      {
        id: 'evidence_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        claimable: false,
        exclusion_reason: '請求根拠不足',
        validation_notes: 'payer_name: 山田花子',
      },
    ]);
    billingEvidenceBlockersMock.mockResolvedValue([
      { id: 'evidence_1', blockers: ['請求検証メモ'] },
    ]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'C001',
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 650,
        status: 'candidate',
        exclusion_reason: null,
        updated_at: new Date('2026-03-30T09:00:00.000Z'),
      },
    ]);
    auditLogFindManyMock.mockImplementation((args) =>
      JSON.stringify(args).includes('billing_payment_profile_updated')
        ? Promise.resolve([
            {
              id: 'audit_billing_profile',
              action: 'billing_payment_profile_updated',
              target_type: 'Patient',
              target_id: 'patient_1',
              actor_id: 'billing_user',
              changes: {
                payer_name: '山田花子',
                payment_method: 'bank_transfer',
                collection: {
                  receipt_number: 'R-001',
                  unpaid_reason: '次回訪問時に集金',
                },
              },
              created_at: new Date('2026-03-30T09:10:00.000Z'),
            },
          ])
        : Promise.resolve([]),
    );

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(billingEvidenceFindManyMock).not.toHaveBeenCalled();
    expect(billingEvidenceBlockersMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindManyMock).not.toHaveBeenCalled();
    expect(patientVisitBriefMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('billingContext');
    const json = await response.json();
    expect(json.data.billing_summary.evidence).toEqual([]);
    expect(json.data.billing_summary.candidates).toEqual([]);
    expect(JSON.stringify(json.data.timeline_events)).not.toContain('billing_candidate');
    expect(JSON.stringify(json.data.timeline_events)).not.toContain('/billing/candidates');
    expect(JSON.stringify(json)).not.toContain('在宅患者訪問薬剤管理指導料');
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('R-001');
    expect(JSON.stringify(json)).not.toContain('次回訪問時に集金');
  });

  it('returns the exact current-month visit count for patient detail badges', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    visitScheduleCountMock.mockResolvedValue(5);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      data: {
        monthly_visit_count: 5,
      },
    });
  });
});
