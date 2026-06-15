import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindFirstMock,
  visitScheduleFindUniqueMock,
  patientFindFirstMock,
  medicationCycleFindFirstMock,
  residualMedicationFindManyMock,
  careTeamLinkFindManyMock,
  userFindFirstMock,
  billingEvidenceFindFirstMock,
  careCaseFindFirstMock,
  prescriptionLineFindManyMock,
  careReportFindManyMock,
  careReportCreateManyMock,
  buildPhysicianReportMock,
  buildCareManagerReportMock,
  buildVisitingNurseReportMock,
  buildFacilityReportMock,
  withOrgContextMock,
  getHomeVisitIntakeMock,
} = vi.hoisted(() => ({
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleFindUniqueMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  careTeamLinkFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  billingEvidenceFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  prescriptionLineFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateManyMock: vi.fn(),
  buildPhysicianReportMock: vi.fn(),
  buildCareManagerReportMock: vi.fn(),
  buildVisitingNurseReportMock: vi.fn(),
  buildFacilityReportMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  getHomeVisitIntakeMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    visitSchedule: { findUnique: visitScheduleFindUniqueMock },
    patient: { findFirst: patientFindFirstMock },
    medicationCycle: { findFirst: medicationCycleFindFirstMock },
    residualMedication: { findMany: residualMedicationFindManyMock },
    careTeamLink: { findMany: careTeamLinkFindManyMock },
    user: { findFirst: userFindFirstMock },
    billingEvidence: { findFirst: billingEvidenceFindFirstMock },
    careCase: { findFirst: careCaseFindFirstMock },
    prescriptionLine: { findMany: prescriptionLineFindManyMock },
    careReport: { findMany: careReportFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('./report-templates', () => ({
  buildPhysicianReport: buildPhysicianReportMock,
  buildCareManagerReport: buildCareManagerReportMock,
  buildVisitingNurseReport: buildVisitingNurseReportMock,
  buildFacilityReport: buildFacilityReportMock,
}));

vi.mock('@/lib/patient/home-visit-intake', () => ({
  getHomeVisitIntake: getHomeVisitIntakeMock,
}));

import { generateReportsFromVisit } from './report-generator';

const baseSoap = {
  subjective: { symptom_checks: [], free_text: '変化なし' },
  objective: {
    medication_status: 'full_compliance',
    adherence_score: 5,
    side_effect_checks: [],
    adverse_events: { has_events: false, events: [] },
  },
  assessment: { problem_checks: ['no_issues'] },
  plan: { intervention_checks: [] },
};

describe('generateReportsFromVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHomeVisitIntakeMock.mockReturnValue(null);
  });

  it('throws when visit record not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-missing')).rejects.toThrow(
      'VisitRecord not found',
    );
  });

  it('throws when visit schedule not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue(null);

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'VisitSchedule not found',
    );
  });

  it('throws when schedule org_id does not match', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-WRONG',
    });

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'VisitSchedule not found',
    );
  });

  it('blocks report generation when the visit schedule is not linked to a medication cycle', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: null,
      org_id: 'org-1',
    });

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT',
    );
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(buildPhysicianReportMock).not.toHaveBeenCalled();
  });

  it('blocks report generation when structured SOAP is missing', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'STRUCTURED_SOAP_REQUIRED_FOR_REPORT',
    );
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(buildPhysicianReportMock).not.toHaveBeenCalled();
  });

  it('blocks report generation when the linked medication cycle cannot be resolved', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-missing',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'MEDICATION_CYCLE_NOT_FOUND_FOR_REPORT',
    );
    expect(prescriptionLineFindManyMock).not.toHaveBeenCalled();
    expect(buildPhysicianReportMock).not.toHaveBeenCalled();
  });

  it('allows org-wide roles to use any in-org visit assignment regardless of who is assigned', async () => {
    // 新ポリシー: pharmacist は組織全体アクセス。割当が別薬剤師(pharm-other)でも
    // 組織内であればアクセスを拒否しない。assignment による行スコープは撤廃された。
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-other',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        }),
    );

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1', undefined, {
      userId: 'user-1',
      role: 'pharmacist',
    });

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].report_type).toBe('physician_report');
  });

  it('returns existing reports without creating new ones', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({
      payer_basis: 'medical',
      applied_rule_keys: ['home_visit_single'],
      recommended_rule_keys: ['home_visit_single'],
      validation_notes: ['SSOT確認済み'],
      calculation_context: {
        effective_revision_code: '2026',
        site_config_status: 'resolved',
        site_config_revision_code: '2026',
        jahis_supplemental_record_count: 2,
        jahis_residual_confirmation_count: 1,
      },
    });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'report' });

    // Report already exists
    careReportFindManyMock.mockResolvedValue([
      { id: 'report-existing', report_type: 'physician_report' },
    ]);

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].id).toBe('report-existing');
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates physician_report when not existing', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({
      payer_basis: 'medical',
      applied_rule_keys: ['home_visit_single'],
      recommended_rule_keys: ['home_visit_single'],
      validation_notes: ['SSOT確認済み'],
      calculation_context: {
        effective_revision_code: '2026',
        site_config_status: 'resolved',
        site_config_revision_code: '2026',
        jahis_supplemental_record_count: 2,
        jahis_residual_confirmation_count: 1,
      },
    });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({
      title: 'physician report',
      optional_note: undefined,
    });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        };
        return fn(tx);
      },
    );

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].report_type).toBe('physician_report');
    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            content: expect.objectContaining({
              title: 'physician report',
              billing_context: expect.objectContaining({
                payer_basis: 'medical',
                applied_rule_keys: ['home_visit_single'],
                recommended_rule_keys: ['home_visit_single'],
                validation_notes: ['SSOT確認済み'],
                effective_revision_code: '2026',
                site_config_status: 'resolved',
                site_config_revision_code: '2026',
                jahis_supplemental_record_count: 2,
                jahis_residual_confirmation_count: 1,
              }),
            }),
          }),
        ],
        skipDuplicates: true,
      }),
    );
    const createdContent = careReportCreateManyMock.mock.calls[0][0].data[0].content;
    expect(createdContent).not.toHaveProperty('optional_note');
  });

  it('normalizes malformed billing calculation context in generated report content', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({
      payer_basis: 'medical',
      applied_rule_keys: null,
      recommended_rule_keys: null,
      validation_notes: null,
      calculation_context: ['unexpected'],
    });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        }),
    );

    await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            content: expect.objectContaining({
              billing_context: expect.objectContaining({
                payer_basis: 'medical',
                applied_rule_keys: [],
                recommended_rule_keys: [],
                validation_notes: null,
                effective_revision_code: null,
                site_config_status: null,
                site_config_revision_code: null,
                jahis_supplemental_record_count: null,
                jahis_residual_confirmation_count: null,
              }),
            }),
          }),
        ],
      }),
    );
  });

  it('persists source provenance for the visit, prescription lines, and billing evidence', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date('2026-03-10T01:00:00.000Z'),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({
      id: 'billing-1',
      cycle_id: 'cycle-1',
      patient_id: 'p-1',
      claimable: false,
      exclusion_reason: 'report_delivery_incomplete',
      report_delivery_ref: null,
      updated_at: new Date('2026-03-10T02:00:00.000Z'),
      payer_basis: 'medical',
      applied_rule_keys: ['home_visit_single'],
      recommended_rule_keys: ['home_visit_single'],
      validation_notes: '送付未完了',
      calculation_context: {
        effective_revision_code: '2026',
      },
    });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line-1',
        intake_id: 'intake-1',
        drug_name: '薬A',
        drug_code: '123456789',
        dose: '1錠',
        frequency: '朝食後',
        days: 14,
        quantity: 14,
        unit: '錠',
        route: 'internal',
        dispensing_method: 'standard',
        intake: {
          prescribed_date: new Date('2026-03-09T00:00:00.000Z'),
        },
      },
    ]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        }),
    );

    await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            content: expect.objectContaining({
              billing_context: expect.objectContaining({
                billing_evidence_id: 'billing-1',
                payer_basis: 'medical',
                claimable: false,
                exclusion_reason: 'report_delivery_incomplete',
                updated_at: '2026-03-10T02:00:00.000Z',
              }),
              source_provenance: expect.objectContaining({
                schema_version: 1,
                visit_record_id: 'vr-1',
                schedule_id: 'vs-1',
                patient_id: 'p-1',
                case_id: 'case-1',
                medication_cycle_id: 'cycle-1',
                prescription_intake_ids: ['intake-1'],
                prescription_line_ids: ['line-1'],
                billing_evidence_id: 'billing-1',
                billing_evidence_updated_at: '2026-03-10T02:00:00.000Z',
                patient_insurance_basis: {
                  payer_basis: 'medical',
                  patient_id: 'p-1',
                  cycle_id: 'cycle-1',
                  claimable: false,
                  exclusion_reason: 'report_delivery_incomplete',
                },
                generated_at: expect.any(String),
              }),
            }),
          }),
        ],
      }),
    );
    expect(
      careReportCreateManyMock.mock.calls[0][0].data[0].content.source_provenance,
    ).toMatchObject({
      prescription_lines: [
        {
          prescription_line_id: 'line-1',
          prescription_intake_id: 'intake-1',
          prescribed_date: '2026-03-09T00:00:00.000Z',
          drug_code: '123456789',
          drug_name: '薬A',
          quantity: 14,
          unit: '錠',
        },
      ],
    });
  });

  it('drops non-object template content while keeping generated report metadata', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue(['unexpected']);
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        }),
    );

    await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            content: {
              billing_context: null,
              source_provenance: expect.objectContaining({
                visit_record_id: 'vr-1',
                schedule_id: 'vs-1',
                patient_id: 'p-1',
                case_id: 'case-1',
                prescription_line_ids: [],
              }),
            },
          }),
        ],
      }),
    );
  });

  it('throws when patient not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-missing',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue(null);
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue(null);
    billingEvidenceFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue(null);

    await expect(generateReportsFromVisit('org-1', 'user-1', 'vr-1')).rejects.toThrow(
      'Patient not found',
    );
  });

  it('uses the visit schedule cycle_id instead of the latest case cycle when generating report prescriptions', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-from-schedule',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-from-schedule' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({ payer_basis: 'medical' });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 1 }),
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: 'report-new', report_type: 'physician_report' }]),
          },
        }),
    );

    await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cycle-from-schedule', org_id: 'org-1' },
      }),
    );
    expect(prescriptionLineFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org-1', intake: { cycle_id: 'cycle-from-schedule' } },
      }),
    );
  });

  it('uses createMany skipDuplicates and returns the persisted report after a concurrent duplicate insert', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: baseSoap,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      cycle_id: 'cycle-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle-1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({ payer_basis: 'medical' });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);
    const txFindManyMock = vi
      .fn()
      .mockResolvedValue([{ id: 'report-race-winner', report_type: 'physician_report' }]);

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          careReport: {
            createMany: careReportCreateManyMock.mockResolvedValue({ count: 0 }),
            findMany: txFindManyMock,
          },
        }),
    );

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(careReportCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org-1',
          visit_record_id: 'vr-1',
          report_type: 'physician_report',
        }),
      ],
      skipDuplicates: true,
    });
    expect(txFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org-1',
        visit_record_id: 'vr-1',
        report_type: { in: ['physician_report'] },
      },
      select: { id: true, report_type: true },
    });
    expect(result.reports).toEqual([{ id: 'report-race-winner', report_type: 'physician_report' }]);
  });
});
