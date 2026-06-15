import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientUpdateMock,
  residenceFindFirstMock,
  residenceUpdateMock,
  assertFacilityReferenceMock,
  medicationProfileFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  visitRecordFindManyMock,
  careReportFindManyMock,
  communicationEventFindManyMock,
  patientSelfReportFindManyMock,
  externalAccessGrantFindManyMock,
  taskFindManyMock,
  medicationIssueFindManyMock,
  inquiryRecordFindManyMock,
  prescriptionIntakeFindManyMock,
  medicationCycleFindManyMock,
  dispenseResultFindManyMock,
  managementPlanFindManyMock,
  userFindManyMock,
  firstVisitDocumentFindManyMock,
  billingEvidenceFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  withOrgContextMock,
  patientSchedulePreferenceUpsertMock,
  patientSchedulePreferenceUpdateManyMock,
  patientInsuranceFindFirstMock,
  patientInsuranceUpdateMock,
  patientInsuranceCreateMock,
  patientInsuranceUpdateManyMock,
  careCaseFindFirstMock,
  careCaseUpdateMock,
  communicationQueueMock,
  patientRiskSummaryMock,
  patientHomeCareFeatureSummaryMock,
  patientVisitBriefMock,
  getFacilityVisitDefaultsMock,
  patientFieldRevisionCreateMock,
  patientFieldRevisionUpdateManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientUpdateMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  residenceUpdateMock: vi.fn(),
  assertFacilityReferenceMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  communicationEventFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  inquiryRecordFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  dispenseResultFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingEvidenceBlockersMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  patientSchedulePreferenceUpsertMock: vi.fn(),
  patientSchedulePreferenceUpdateManyMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  patientInsuranceUpdateMock: vi.fn(),
  patientInsuranceCreateMock: vi.fn(),
  patientInsuranceUpdateManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  patientRiskSummaryMock: vi.fn(),
  patientHomeCareFeatureSummaryMock: vi.fn(),
  patientVisitBriefMock: vi.fn(),
  getFacilityVisitDefaultsMock: vi.fn(),
  patientFieldRevisionCreateMock: vi.fn(),
  patientFieldRevisionUpdateManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    externalAccessGrant: {
      findMany: externalAccessGrantFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
    medicationIssue: {
      findMany: medicationIssueFindManyMock,
    },
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
    },
    dispenseResult: {
      findMany: dispenseResultFindManyMock,
    },
    managementPlan: {
      findMany: managementPlanFindManyMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
    billingEvidence: {
      findMany: billingEvidenceFindManyMock,
    },
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
    },
    patientLabObservation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: communicationQueueMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: billingEvidenceBlockersMock,
}));

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: patientRiskSummaryMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: patientHomeCareFeatureSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientVisitBriefMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  FacilityUnitReferenceValidationError: class FacilityUnitReferenceValidationError extends Error {},
  assertFacilityReference: assertFacilityReferenceMock,
  assertFacilityUnitReference: vi.fn(),
  getFacilityVisitDefaults: getFacilityVisitDefaultsMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === undefined) {
    return new NextRequest('http://localhost/api/patients/patient_1', { headers });
  }
  return new NextRequest('http://localhost/api/patients/patient_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/patients/patient_1', {
    method: 'PATCH',
    body: '{"name":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('/api/patients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [],
    });
    patientUpdateMock.mockResolvedValue({ id: 'patient_1', name: '更新後 患者A' });
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });
    residenceUpdateMock.mockResolvedValue({ id: 'residence_1' });
    patientSchedulePreferenceUpsertMock.mockResolvedValue({ id: 'schedule_pref_1' });
    patientSchedulePreferenceUpdateManyMock.mockResolvedValue({ count: 1 });
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    patientInsuranceUpdateMock.mockResolvedValue({ id: 'insurance_1' });
    patientInsuranceCreateMock.mockResolvedValue({ id: 'insurance_1' });
    patientInsuranceUpdateManyMock.mockResolvedValue({ count: 1 });
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      required_visit_support: {
        legacy_debug: undefined,
        home_visit_intake: {
          requester: {
            organization_name: '旧紹介元',
          },
          primary_disease: '高血圧',
        },
      },
    });
    careCaseUpdateMock.mockResolvedValue({ id: 'case_1' });
    medicationProfileFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    visitRecordFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    communicationEventFindManyMock.mockResolvedValue([]);
    patientSelfReportFindManyMock.mockResolvedValue([]);
    externalAccessGrantFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    inquiryRecordFindManyMock.mockResolvedValue([]);
    prescriptionIntakeFindManyMock.mockResolvedValue([]);
    medicationCycleFindManyMock.mockResolvedValue([]);
    dispenseResultFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    billingEvidenceFindManyMock.mockResolvedValue([]);
    billingCandidateFindManyMock.mockResolvedValue([]);
    billingEvidenceBlockersMock.mockResolvedValue([]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [],
      timeline: [],
      emergency_drafts: [],
    });
    patientRiskSummaryMock.mockResolvedValue({
      patient_id: 'patient_1',
      patient_name: '患者A',
      score: 0,
      level: 'stable',
      reasons: [],
      unresolved_self_reports: 0,
      open_issues: 0,
      disrupted_visits_30d: 0,
      pending_reports: 0,
      open_tasks: 0,
      missing_visit_consent: false,
      missing_management_plan: false,
    });
    patientHomeCareFeatureSummaryMock.mockResolvedValue({
      totals: { blocked: 0, attention: 0, monitoring: 0, ready: 20 },
      features: [],
    });
    patientVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A' },
      context: 'patient',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: '2026-03-26T00:00:00.000Z',
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
      ai_summary: {
        provider: 'rule',
        requested_provider: 'disabled',
        is_fallback: true,
        model: null,
        fallback_reason: 'provider_unavailable',
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
    getFacilityVisitDefaultsMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          update: patientUpdateMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
          update: residenceUpdateMock,
          create: vi.fn(),
        },
        contactParty: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
        patientCondition: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
        patientInsurance: {
          findFirst: patientInsuranceFindFirstMock,
          update: patientInsuranceUpdateMock,
          create: patientInsuranceCreateMock,
          updateMany: patientInsuranceUpdateManyMock,
        },
        patientSchedulePreference: {
          upsert: patientSchedulePreferenceUpsertMock,
          updateMany: patientSchedulePreferenceUpdateManyMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
          update: careCaseUpdateMock,
        },
        patientFieldRevision: {
          updateMany: patientFieldRevisionUpdateManyMock,
          create: patientFieldRevisionCreateMock,
        },
      }),
    );
  });

  it('loads patient detail with expanded patient master relations', async () => {
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
      contacts: [],
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

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
      },
      include: expect.objectContaining({
        residences: true,
        contacts: true,
        consents: true,
        conditions: expect.objectContaining({
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        }),
        cases: expect.objectContaining({
          include: {
            care_team_links: true,
          },
        }),
      }),
    });
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(medicationProfileFindManyMock).toHaveBeenCalled();
    expect(externalAccessGrantFindManyMock).toHaveBeenCalled();
    expect(taskFindManyMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      monthly_visit_count: 0,
      first_visit_documents: [],
      home_care_feature_summary: {
        totals: {
          blocked: 0,
          attention: 0,
          monitoring: 0,
          ready: 20,
        },
      },
      visit_brief: {
        context: 'patient',
        ai_summary: {
          provider: 'rule',
        },
      },
    });
    expect(patientRiskSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      caseIds: [],
    });
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
    });
    expect(communicationQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      caseIds: [],
      limit: 6,
    });
    expect(patientVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      context: 'patient',
      caseIds: [],
      role: 'pharmacist',
      userId: 'user_1',
    });
  });

  it('does not load related PHI when the scoped patient lookup fails', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(billingEvidenceFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before loading patient detail', async () => {
    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(patientRiskSummaryMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing patch payloads or loading the patient', async () => {
    const response = await PATCH(
      createMalformedJsonPatchRequest({ 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: '\t\n' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the patient', async () => {
    const response = await PATCH(createRequest([], { 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the patient', async () => {
    const response = await PATCH(
      createMalformedJsonPatchRequest({ 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed patch contact numbers before loading the patient', async () => {
    const response = await PATCH(
      createRequest(
        {
          phone: '090-ABCD-1234',
          requester: {
            phone: '03-ABCD-2222',
            fax: 'FAX-3333',
          },
          intake: {
            contact_phone: '03-4444-ABCD',
            care_manager: {
              phone: '03-9999-ABCD',
            },
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

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
    });
  });

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
    expect(payload.external_shares).toEqual([
      expect.objectContaining({
        id: 'grant_visible',
        scope: { care_reports: true },
      }),
      expect.objectContaining({
        id: 'grant_patient_only',
        scope: { medication_list: true },
      }),
    ]);
    expect(JSON.stringify(payload.external_shares)).not.toContain('grant_hidden');
    expect(JSON.stringify(payload.external_shares)).not.toContain('allowed_case_ids');
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
    await expect(response.json()).resolves.toMatchObject({
      first_visit_documents: [
        {
          id: 'first_visit_1',
          case_id: 'case_1',
          document_url: '/api/visit-records/record_1/pdf',
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
    });
  });

  it('updates patient master and primary residence fields', async () => {
    const response = await PATCH(
      createRequest(
        {
          name: '更新後 患者A',
          name_kana: 'コウシンゴ カンジャエー',
          birth_date: '1940-01-02',
          gender: 'female',
          phone: ' 090-1111-2222 ',
          address: '東京都千代田区1-2-3',
          building_id: 'building_1',
          facility_id: 'facility_1',
          unit_name: '301',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: expect.objectContaining({
        name: '更新後 患者A',
        name_kana: 'コウシンゴ カンジャエー',
        birth_date: new Date('1940-01-02'),
        gender: 'female',
        phone: '090-1111-2222',
      }),
    });
    expect(residenceFindFirstMock).toHaveBeenCalledWith({
      where: { patient_id: 'patient_1', is_primary: true },
      select: {
        id: true,
        address: true,
        building_id: true,
        facility_id: true,
        facility_unit_id: true,
        unit_name: true,
      },
    });
    expect(assertFacilityReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.any(Object),
        residence: expect.any(Object),
      }),
      'corg1234567890123456789012',
      'facility_1',
    );
    expect(residenceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'residence_1' },
      data: {
        address: '東京都千代田区1-2-3',
        building_id: 'building_1',
        facility_id: 'facility_1',
        facility_unit_id: null,
        unit_name: '301',
      },
    });
    expect(getFacilityVisitDefaultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.any(Object),
        residence: expect.any(Object),
        patientSchedulePreference: expect.any(Object),
      }),
      'corg1234567890123456789012',
      'facility_1',
    );
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        facility_time_from: null,
        facility_time_to: null,
      },
      update: {
        facility_time_from: null,
        facility_time_to: null,
      },
    });
  });

  it('records a basic field revision for changed fields and skips no-op fields on PATCH', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      phone: '090-0000-0000',
      cases: [],
    });

    const response = await PATCH(
      createRequest(
        { phone: '080-1111-2222', name: '山田 太郎' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    // phone は変更 → 現在行クローズ + 新現在行作成
    expect(patientFieldRevisionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          field_key: 'phone',
          is_current: true,
        }),
      }),
    );
    const phoneCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'phone',
    );
    expect(phoneCreate?.[0]?.data).toMatchObject({
      category: 'basic',
      field_key: 'phone',
      old_value: '090-0000-0000',
      new_value: '080-1111-2222',
      updated_by: 'user_1',
      is_current: true,
    });

    // name は無変更 → 偽の履歴は作られない(no-op スキップ)
    const nameCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'name',
    );
    expect(nameCreate).toBeUndefined();
  });

  it('snapshots contacts into a field revision when contacts are replaced on PATCH', async () => {
    const response = await PATCH(
      createRequest(
        {
          contacts: [
            { name: '山田 花子', relation: 'child', is_primary: true, is_emergency_contact: true },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const contactsCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'contacts',
    );
    expect(contactsCreate?.[0]?.data).toMatchObject({
      category: 'contacts',
      field_key: 'contacts',
    });
    expect((contactsCreate?.[0]?.data?.new_value as unknown[]).length).toBe(1);
  });

  it('syncs facility acceptance window into patient schedule preferences on PATCH', async () => {
    getFacilityVisitDefaultsMock.mockResolvedValue({
      id: 'facility_1',
      acceptance_time_from: new Date('1970-01-01T10:00:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T16:30:00.000Z'),
      regular_visit_weekdays: [2, 4],
    });

    const response = await PATCH(
      createRequest(
        {
          facility_id: 'facility_1',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        facility_time_from: new Date('1970-01-01T10:00:00.000Z'),
        facility_time_to: new Date('1970-01-01T16:30:00.000Z'),
      },
      update: {
        facility_time_from: new Date('1970-01-01T10:00:00.000Z'),
        facility_time_to: new Date('1970-01-01T16:30:00.000Z'),
      },
    });
  });

  it('syncs normalized insurance, intake JSON, and schedule preference fields on PATCH', async () => {
    // existing active insurance has a different number → triggers close+create
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_current_1',
      number: 'OLD_NUM',
    });

    const response = await PATCH(
      createRequest(
        {
          medical_insurance_number: '1234567890',
          billing_support_flag: true,
          requester: {
            organization_name: '新しい紹介元',
            contact_name: '相談員 田中',
            phone: ' 03-1111-2222 ',
            fax: ' 03-1111-3333 ',
          },
          intake: {
            primary_contact_preference: 'phone',
            visit_before_contact_required: true,
            first_visit_preferred_date: '2026-04-15',
            first_visit_time_slot: 'afternoon',
            mcs_linked: true,
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            contact_phone: ' 090-9999-8888 ',
            primary_disease: '慢性心不全',
            ent_prescription: true,
            ent_period_from: '2026-04-01',
            ent_period_to: '2026-04-30',
            home_pharmacy_add_on_2: {
              candidate: 'add_on_2_i_single_building_candidate',
              single_building_medical_patient_count: 'one',
              single_building_resident_count: 'one',
              home_care_billing_category: 'care_home_management',
              medical_home_management_section: 'one_i_1',
              comprehensive_support_add_on: 'no',
              table_8_3_applicable: 'yes',
              pediatric_home_care: 'no',
              weekly_visiting_nurse: 'yes',
              nursing_or_family_procedure: 'yes',
              narcotic_use_categories: ['continuous_pca'],
              aseptic_preparation_need: 'unnecessary',
            },
            infection_isolation: 'droplet',
            care_manager: {
              name: 'ケア 山田',
              phone: ' 03-9999-0000 ',
              fax: ' 03-9999-1111 ',
            },
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: expect.objectContaining({
        medical_insurance_number: '1234567890',
        billing_support_flag: true,
      }),
    });
    expect(patientInsuranceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        is_active: true,
      },
      orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
      select: { id: true, number: true },
    });
    // Fix #2/#3: close all active rows, then create a new one (history preserved)
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          insurance_type: 'medical',
          is_active: true,
        }),
        data: expect.objectContaining({
          is_active: false,
          valid_until: expect.any(Date),
        }),
      }),
    );
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        number: '1234567890',
        valid_from: expect.any(Date),
        is_active: true,
      }),
    });
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: expect.objectContaining({
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        preferred_contact_name: '相談員 田中',
        preferred_contact_phone: '090-9999-8888',
        primary_contact_preference: 'phone',
        visit_before_contact_required: true,
        first_visit_preferred_date: new Date('2026-04-15'),
        first_visit_time_slot: 'afternoon',
        mcs_linked: true,
        care_level: 'care_3',
        adl_level: 'b',
        dementia_level: 'ii',
        infection_isolation: true,
      }),
      update: expect.objectContaining({
        preferred_contact_name: '相談員 田中',
        preferred_contact_phone: '090-9999-8888',
        primary_contact_preference: 'phone',
        visit_before_contact_required: true,
        first_visit_preferred_date: new Date('2026-04-15'),
        first_visit_time_slot: 'afternoon',
        mcs_linked: true,
        care_level: 'care_3',
        adl_level: 'b',
        dementia_level: 'ii',
        infection_isolation: true,
      }),
    });
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: {
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
              contact_name: '相談員 田中',
              phone: '03-1111-2222',
              fax: '03-1111-3333',
            }),
            contact_phone: '090-9999-8888',
            primary_disease: '慢性心不全',
            primary_contact_preference: 'phone',
            visit_before_contact_required: true,
            first_visit_date: '2026-04-15',
            first_visit_time_slot: 'afternoon',
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            mcs_linked: true,
            ent_prescription: true,
            ent_period_from: '2026-04-01',
            ent_period_to: '2026-04-30',
            home_pharmacy_add_on_2: expect.objectContaining({
              candidate: 'add_on_2_i_single_building_candidate',
              single_building_medical_patient_count: 'one',
              single_building_resident_count: 'one',
              home_care_billing_category: 'care_home_management',
              medical_home_management_section: 'one_i_1',
              comprehensive_support_add_on: 'no',
              table_8_3_applicable: 'yes',
              pediatric_home_care: 'no',
              weekly_visiting_nurse: 'yes',
              nursing_or_family_procedure: 'yes',
              narcotic_use_categories: ['continuous_pca'],
              aseptic_preparation_need: 'unnecessary',
            }),
            infection_isolation: 'droplet',
            care_manager: expect.objectContaining({
              name: 'ケア 山田',
              phone: '03-9999-0000',
              fax: '03-9999-1111',
            }),
          }),
        },
      },
    });
    expect(
      (careCaseUpdateMock.mock.calls[0][0].data.required_visit_support as Record<string, unknown>)
        .legacy_debug,
    ).toBeUndefined();
  });

  it('updates requester and intake fields on the latest in-org care case for org-wide roles regardless of assignment', async () => {
    careCaseFindFirstMock.mockImplementation(
      async (args: { where: { AND?: unknown }; select: unknown }) => {
        // 新ポリシー: pharmacist は組織内フルアクセス。担当割当(AND)は付与されないため、
        // org 内の最新ケース(未割当でも)が解決・更新される。
        if (args.where.AND) {
          return {
            id: 'case_assigned_old',
            required_visit_support: {
              home_visit_intake: {
                requester: {
                  organization_name: '旧紹介元',
                },
              },
            },
          };
        }

        return {
          id: 'case_unassigned_latest',
          required_visit_support: {
            home_visit_intake: {
              requester: {
                organization_name: '未割当紹介元',
              },
            },
          },
        };
      },
    );

    const response = await PATCH(
      createRequest(
        {
          requester: {
            organization_name: '新しい紹介元',
          },
          intake: {
            primary_disease: '慢性心不全',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        status: { in: ['referral_received', 'assessment', 'active', 'on_hold'] },
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        id: true,
        required_visit_support: true,
      },
    });
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_unassigned_latest' },
      data: {
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
            }),
            primary_disease: '慢性心不全',
          }),
        },
      },
    });
    expect(careCaseUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_assigned_old' },
      }),
    );
  });

  it('rebuilds intake support from an empty object when required_visit_support is malformed', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      required_visit_support: ['unexpected'],
    });

    const response = await PATCH(
      createRequest(
        {
          requester: {
            organization_name: '新しい紹介元',
          },
          intake: {
            primary_disease: '慢性心不全',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: {
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
            }),
            primary_disease: '慢性心不全',
          }),
        },
      },
    });
  });

  it('does not close or recreate insurance when submitted number is identical to existing', async () => {
    // idempotence: same number → no close, no create
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_current_1',
      number: '1234567890',
    });

    const response = await PATCH(
      createRequest(
        { medical_insurance_number: '1234567890' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
    // updateMany is called for the "deactivate actives" path only when closing; not here
    // The null-number path calls updateMany to deactivate, but we passed a non-empty number
    // so the only updateMany call should NOT have occurred for the close step
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('maps infection_isolation false-value strings to boolean false', async () => {
    const response = await PATCH(
      createRequest(
        {
          intake: {
            infection_isolation: '不要',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ infection_isolation: false }),
        update: expect.objectContaining({ infection_isolation: false }),
      }),
    );
  });

  it('includes inquiry history in patient timeline events', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    inquiryRecordFindManyMock.mockResolvedValue([
      {
        id: 'inquiry_1',
        reason: '相互作用',
        inquiry_to_physician: '在宅主治医',
        inquiry_content: '併用可否を確認',
        result: 'pending',
        change_detail: null,
        inquired_at: new Date('2026-03-28T09:00:00.000Z'),
        resolved_at: null,
        created_at: new Date('2026-03-28T08:50:00.000Z'),
      },
      {
        id: 'inquiry_2',
        reason: '用量疑義',
        inquiry_to_physician: '在宅主治医',
        inquiry_content: '減量で合意',
        result: 'changed',
        change_detail: '5mgへ減量',
        inquired_at: new Date('2026-03-27T09:00:00.000Z'),
        resolved_at: new Date('2026-03-27T10:00:00.000Z'),
        created_at: new Date('2026-03-27T08:50:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'inquiry',
          title: '疑義照会 回答待ち',
        }),
        expect.objectContaining({
          event_type: 'inquiry',
          title: '疑義照会 変更あり',
          summary: expect.stringContaining('5mgへ減量'),
        }),
      ]),
    });
  });

  it('includes prescription, dispensing, and management plan activity in patient timeline events', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-29T00:00:00.000Z'),
        prescriber_name: '在宅主治医',
        prescriber_institution: null,
        original_collected_by: '受付A',
        created_at: new Date('2026-03-29T09:00:00.000Z'),
        cycle: {
          overall_status: 'ready_to_dispense',
        },
        lines: [{ id: 'line_1' }],
      },
    ]);
    dispenseResultFindManyMock.mockResolvedValue([
      {
        id: 'dispense_1',
        actual_drug_name: 'アムロジピン',
        actual_quantity: 30,
        actual_unit: '錠',
        carry_type: 'carry',
        dispensed_by: 'user_2',
        dispensed_at: new Date('2026-03-29T11:00:00.000Z'),
        task: {
          cycle: {
            overall_status: 'dispensed',
          },
        },
        line: {
          intake: {
            id: 'intake_1',
          },
        },
      },
    ]);
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_1',
        status: 'approved',
        title: '訪問薬剤管理指導計画書',
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        next_review_date: new Date('2026-05-01T00:00:00.000Z'),
        created_by: 'user_1',
        approved_by: 'user_2',
        approved_at: new Date('2026-03-30T09:00:00.000Z'),
        reviewed_by: 'user_2',
        reviewed_at: new Date('2026-03-30T09:00:00.000Z'),
        created_at: new Date('2026-03-29T08:00:00.000Z'),
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'user_2', name: '薬剤師B' }]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'prescription_intake',
          category: 'prescription',
          href: '/prescriptions/intake_1',
          status_label: '調剤待ち',
          actor_name: '受付A',
        }),
        expect.objectContaining({
          event_type: 'dispense_result',
          title: '調剤を記録',
          actor_name: '薬剤師B',
          href: '/prescriptions/intake_1',
        }),
        expect.objectContaining({
          event_type: 'management_plan',
          category: 'document',
          title: '管理計画書を承認',
          href: '/patients/patient_1/management-plan',
        }),
      ]),
    });
  });

  it('falls back to visit record detail when a visit timeline event has no schedule id', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'record_1',
        schedule_id: null,
        visit_date: new Date('2026-03-28T10:00:00.000Z'),
        outcome_status: 'completed',
        next_visit_suggestion_date: null,
        cancellation_reason: null,
        postpone_reason: null,
        revisit_reason: null,
        created_at: new Date('2026-03-28T09:00:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'visit_record',
          href: '/visits/record_1',
        }),
      ]),
    });
  });

  it('links scheduled visit timeline events to record detail when a record exists', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        schedule_status: 'completed',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        confirmed_at: new Date('2026-03-28T08:00:00.000Z'),
        route_order: 1,
        created_at: new Date('2026-03-27T08:00:00.000Z'),
        updated_at: new Date('2026-03-28T08:00:00.000Z'),
        visit_record: {
          id: 'record_1',
          outcome_status: 'completed',
          visit_date: new Date('2026-03-28T09:00:00.000Z'),
          next_visit_suggestion_date: null,
          created_at: new Date('2026-03-28T09:10:00.000Z'),
        },
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'visit_schedule',
          href: '/visits/record_1',
          action_label: '訪問記録を開く',
        }),
      ]),
    });
  });

  it('links scheduled visit timeline events without a record to the record input page', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        schedule_status: 'ready',
        priority: 'normal',
        pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        confirmed_at: null,
        route_order: 1,
        created_at: new Date('2026-03-27T08:00:00.000Z'),
        updated_at: new Date('2026-03-28T08:00:00.000Z'),
        visit_record: null,
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'visit_schedule',
          href: '/visits/schedule_1/record',
          action_label: '訪問記録を入力',
        }),
      ]),
    });
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
      monthly_visit_count: 5,
    });
  });
});
