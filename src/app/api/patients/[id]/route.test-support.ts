import { beforeEach, vi } from 'vitest';
import { createPatientDetailRequest } from './route.test-helpers';
export {
  createMalformedPatientDetailPatchRequest as createMalformedJsonPatchRequest,
  createPatientDetailRequest as createRequest,
  expectSensitiveNoStore,
} from './route.test-helpers';

export function createPatientPatchRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === null || Array.isArray(body) || typeof body !== 'object') {
    return createPatientDetailRequest(body, headers);
  }

  return createPatientDetailRequest(
    {
      expected_updated_at: '2026-03-30T09:00:00.000Z',
      ...body,
    },
    headers,
  );
}
export const patientRouteMocks = {
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientUpdateManyMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  residenceUpdateMock: vi.fn(),
  assertFacilityReferenceMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
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
  conferenceNoteFindManyMock: vi.fn(),
  auditLogFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingEvidenceBlockersMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  transactionQueryRawMock: vi.fn(),
  patientSchedulePreferenceUpsertMock: vi.fn(),
  patientSchedulePreferenceUpdateManyMock: vi.fn(),
  patientSchedulePreferenceFindUniqueMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  patientInsuranceUpdateMock: vi.fn(),
  patientInsuranceCreateMock: vi.fn(),
  patientInsuranceUpdateManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseUpdateManyMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  patientRiskSummaryMock: vi.fn(),
  patientHomeCareFeatureSummaryMock: vi.fn(),
  patientVisitBriefMock: vi.fn(),
  getFacilityVisitDefaultsMock: vi.fn(),
  patientFieldRevisionCreateMock: vi.fn(),
  patientFieldRevisionUpdateManyMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  patientMedicalProcedureFindManyMock: vi.fn(),
  patientMedicalProcedureCreateMock: vi.fn(),
  patientMedicalProcedureUpdateManyMock: vi.fn(),
  patientNarcoticUseFindManyMock: vi.fn(),
  patientNarcoticUseCreateMock: vi.fn(),
  patientNarcoticUseUpdateManyMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  contactPartyDeleteManyMock: vi.fn(),
  contactPartyCreateManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
};

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientFindManyMock,
  patientUpdateManyMock,
  residenceFindFirstMock,
  residenceUpdateMock,
  medicationProfileFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  visitRecordFindManyMock,
  visitRecordFindFirstMock,
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
  conferenceNoteFindManyMock,
  auditLogFindManyMock,
  billingEvidenceFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  withOrgContextMock,
  transactionQueryRawMock,
  patientSchedulePreferenceUpsertMock,
  patientSchedulePreferenceUpdateManyMock,
  patientSchedulePreferenceFindUniqueMock,
  patientInsuranceFindFirstMock,
  patientInsuranceUpdateMock,
  patientInsuranceCreateMock,
  patientInsuranceUpdateManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  careCaseUpdateManyMock,
  communicationQueueMock,
  patientRiskSummaryMock,
  patientHomeCareFeatureSummaryMock,
  patientVisitBriefMock,
  getFacilityVisitDefaultsMock,
  patientFieldRevisionCreateMock,
  patientFieldRevisionUpdateManyMock,
  taskUpsertMock,
  patientMedicalProcedureFindManyMock,
  patientMedicalProcedureCreateMock,
  patientMedicalProcedureUpdateManyMock,
  patientNarcoticUseFindManyMock,
  patientNarcoticUseCreateMock,
  patientNarcoticUseUpdateManyMock,
  contactPartyFindManyMock,
  contactPartyDeleteManyMock,
  contactPartyCreateManyMock,
  validateOrgReferencesMock,
  auditLogCreateMock,
} = patientRouteMocks;

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
    birth_date: new Date('1950-01-01T00:00:00.000Z'),
    gender: 'male',
    phone: null,
    updated_at: new Date('2026-03-30T09:00:00.000Z'),
    cases: [],
  });
  patientFindManyMock.mockResolvedValue([]);
  patientUpdateManyMock.mockResolvedValue({ id: 'patient_1', name: '更新後 患者A' });
  patientUpdateManyMock.mockResolvedValue({ count: 1 });
  residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });
  residenceUpdateMock.mockResolvedValue({ id: 'residence_1' });
  patientSchedulePreferenceUpsertMock.mockResolvedValue({ id: 'schedule_pref_1' });
  patientSchedulePreferenceUpdateManyMock.mockResolvedValue({ count: 1 });
  patientSchedulePreferenceFindUniqueMock.mockResolvedValue(null);
  taskUpsertMock.mockResolvedValue({ id: 'task_1', display_id: 'task0000000001' });
  patientMedicalProcedureFindManyMock.mockResolvedValue([]);
  patientNarcoticUseFindManyMock.mockResolvedValue([]);
  patientInsuranceFindFirstMock.mockResolvedValue(null);
  patientInsuranceUpdateMock.mockResolvedValue({ id: 'insurance_1' });
  patientInsuranceCreateMock.mockResolvedValue({ id: 'insurance_1' });
  patientInsuranceUpdateManyMock.mockResolvedValue({ count: 1 });
  contactPartyFindManyMock.mockResolvedValue([]);
  contactPartyDeleteManyMock.mockResolvedValue({ count: 0 });
  contactPartyCreateManyMock.mockResolvedValue({ count: 0 });
  careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
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
    version: 1,
  });
  careCaseUpdateManyMock.mockResolvedValue({ id: 'case_1' });
  careCaseUpdateManyMock.mockResolvedValue({ count: 1 });
  validateOrgReferencesMock.mockResolvedValue({ ok: true });
  auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  medicationProfileFindManyMock.mockResolvedValue([]);
  visitScheduleFindManyMock.mockResolvedValue([]);
  visitScheduleCountMock.mockResolvedValue(0);
  visitRecordFindManyMock.mockResolvedValue([]);
  // 反映導線の出所検証: 既定では同一org/患者の訪問記録が存在するものとして通す
  visitRecordFindFirstMock.mockResolvedValue({ id: 'visit_1' });
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
  conferenceNoteFindManyMock.mockResolvedValue([]);
  auditLogFindManyMock.mockResolvedValue([]);
  billingEvidenceFindManyMock.mockResolvedValue([]);
  billingCandidateFindManyMock.mockResolvedValue([]);
  billingEvidenceBlockersMock.mockResolvedValue([]);
  communicationQueueMock.mockResolvedValue({
    summary: {
      pending_count: 0,
      overdue_count: 0,
      self_reports: 0,
      callback_followups: 0,
      inbound_communications: 0,
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
  transactionQueryRawMock.mockResolvedValue([]);
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      $queryRaw: transactionQueryRawMock,
      patient: {
        findFirst: patientFindFirstMock,
        findMany: patientFindManyMock,
        update: patientUpdateManyMock,
        updateMany: patientUpdateManyMock,
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
        findFirst: visitRecordFindFirstMock,
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
        upsert: taskUpsertMock,
      },
      medicationIssue: {
        findMany: medicationIssueFindManyMock,
      },
      medicationCycle: {
        findMany: medicationCycleFindManyMock,
      },
      billingEvidence: {
        findMany: billingEvidenceFindManyMock,
      },
      billingCandidate: {
        findMany: billingCandidateFindManyMock,
      },
      firstVisitDocument: {
        findMany: firstVisitDocumentFindManyMock,
      },
      patientLabObservation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      residence: {
        findFirst: residenceFindFirstMock,
        update: residenceUpdateMock,
        create: vi.fn(),
      },
      contactParty: {
        findMany: contactPartyFindManyMock,
        deleteMany: contactPartyDeleteManyMock,
        createMany: contactPartyCreateManyMock,
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
        findUnique: patientSchedulePreferenceFindUniqueMock,
      },
      careCase: {
        findMany: careCaseFindManyMock,
        findFirst: careCaseFindFirstMock,
        update: careCaseUpdateManyMock,
        updateMany: careCaseUpdateManyMock,
      },
      patientFieldRevision: {
        updateMany: patientFieldRevisionUpdateManyMock,
        create: patientFieldRevisionCreateMock,
      },
      patientMedicalProcedure: {
        findMany: patientMedicalProcedureFindManyMock,
        create: patientMedicalProcedureCreateMock,
        updateMany: patientMedicalProcedureUpdateManyMock,
      },
      patientNarcoticUse: {
        findMany: patientNarcoticUseFindManyMock,
        create: patientNarcoticUseCreateMock,
        updateMany: patientNarcoticUseUpdateManyMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
    }),
  );
});
