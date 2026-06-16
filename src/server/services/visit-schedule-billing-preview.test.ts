import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  careCaseFindFirstMock,
  careCaseFindManyMock,
  patientInsuranceFindManyMock,
  prescriptionIntakeFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  userFindFirstMock,
  userFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  pharmacySiteInsuranceConfigFindFirstMock,
  resolvePatientInsuranceMock,
  findLatestPrescriptionIntakeClassificationMock,
  validateBillingRequirementsMock,
  getBillingCadencePreviewMock,
  resolveBillingRuntimeContextMock,
} = vi.hoisted(() => ({
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  pharmacySiteInsuranceConfigFindFirstMock: vi.fn(),
  resolvePatientInsuranceMock: vi.fn(),
  findLatestPrescriptionIntakeClassificationMock: vi.fn(),
  validateBillingRequirementsMock: vi.fn(),
  getBillingCadencePreviewMock: vi.fn(),
  resolveBillingRuntimeContextMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    patientInsurance: {
      findFirst: vi.fn(),
      findMany: patientInsuranceFindManyMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    user: {
      findFirst: userFindFirstMock,
      findMany: userFindManyMock,
    },
    consentRecord: {
      findMany: consentRecordFindManyMock,
    },
    managementPlan: {
      findMany: managementPlanFindManyMock,
    },
    pharmacySiteInsuranceConfig: {
      findFirst: pharmacySiteInsuranceConfigFindFirstMock,
    },
  },
}));

vi.mock('./patient-insurance', () => ({
  resolvePatientInsurance: resolvePatientInsuranceMock,
}));

vi.mock('./prescription-intake-classification', () => ({
  findLatestPrescriptionIntakeClassification: findLatestPrescriptionIntakeClassificationMock,
}));

vi.mock('./billing-requirement-validator', () => ({
  validateBillingRequirements: validateBillingRequirementsMock,
  getBillingCadencePreview: getBillingCadencePreviewMock,
}));

vi.mock('./billing-runtime-context', () => ({
  resolveBillingRuntimeContext: resolveBillingRuntimeContextMock,
}));

import {
  buildVisitScheduleBillingPreview,
  buildVisitScheduleBillingPreviewBatch,
} from './visit-schedule-billing-preview';

function makeInsuranceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'insurance_1',
    patient_id: 'patient_1',
    insurance_type: 'medical',
    application_status: 'confirmed',
    number: 'INS-001',
    public_program_code: null,
    insurer_number: null,
    previous_care_level: null,
    provisional_care_level: null,
    confirmed_care_level: null,
    is_active: true,
    application_submitted_at: null,
    valid_from: null,
    valid_until: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('buildVisitScheduleBillingPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharm_1',
      required_visit_support: null,
      patient: {
        id: 'patient_1',
      },
    });
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      },
    ]);
    findLatestPrescriptionIntakeClassificationMock.mockResolvedValue({
      prescription_category: 'regular',
    });
    resolvePatientInsuranceMock.mockImplementation(
      (_prisma: unknown, args: { type: 'medical' | 'care' }) => {
        if (args.type === 'medical') {
          return Promise.resolve(makeInsuranceRecord());
        }
        return Promise.resolve(
          makeInsuranceRecord({
            id: 'insurance_care_1',
            insurance_type: 'care',
            number: 'CARE-001',
          }),
        );
      },
    );
    patientInsuranceFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([{ id: 'pharm_1', max_weekly_visits: 24 }]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);
    validateBillingRequirementsMock.mockResolvedValue([]);
    getBillingCadencePreviewMock.mockResolvedValue({
      monthly_cap: 4,
      current_month_count: 1,
      remaining_month_count: 3,
      weekly_cap: null,
      current_week_count: 1,
      scheduled_dates_current_month: ['2026-04-01'],
      next_billable_date: '2026-04-03',
      suggested_dates: ['2026-04-03'],
      reason: '本日以降で算定可能です',
    });
    resolveBillingRuntimeContextMock.mockResolvedValue({
      effectiveRevisionCode: 'r2026',
      effectiveRevisionLabel: '2026年度',
      siteConfigStatus: 'not_required',
      siteConfigRevisionCode: null,
      warnings: [],
      homeComprehensive: null,
    });
  });

  it('surfaces care insurance change-pending state before visit proposal billing', async () => {
    resolvePatientInsuranceMock.mockImplementation(
      (_prisma: unknown, args: { type: 'medical' | 'care'; asOf: Date }) => {
        if (args.type === 'medical') {
          return Promise.resolve(makeInsuranceRecord());
        }
        return Promise.resolve(
          makeInsuranceRecord({
            id: 'insurance_care_1',
            insurance_type: 'care',
            application_status: 'change_pending',
            number: null,
            previous_care_level: 'care_2',
            provisional_care_level: 'care_3',
            confirmed_care_level: null,
          }),
        );
      },
    );

    const preview = await buildVisitScheduleBillingPreview({
      orgId: 'org_1',
      caseId: 'case_1',
      proposedDate: '2026-04-03',
      pharmacistId: 'pharm_1',
    });

    expect(preview?.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'care_insurance_application_pending',
          severity: 'warning',
          message: expect.stringContaining('区分変更中'),
          details: expect.objectContaining({
            application_status: 'change_pending',
            insurance_number_present: false,
            previous_care_level: 'care_2',
            provisional_care_level: 'care_3',
          }),
        }),
      ]),
    );
    expect(resolvePatientInsuranceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'care',
        asOf: new Date('2026-04-03'),
      }),
    );
  });

  it('surfaces pending public subsidy status even when medical insurance is confirmed', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      {
        application_status: 'applying',
        public_program_code: '54',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-03-20T00:00:00.000Z'),
        valid_from: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    const preview = await buildVisitScheduleBillingPreview({
      orgId: 'org_1',
      caseId: 'case_1',
      proposedDate: '2026-04-03',
      pharmacistId: 'pharm_1',
    });

    expect(preview?.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'public_subsidy_application_pending',
          severity: 'warning',
          message: expect.stringContaining('公費54が申請中'),
          details: expect.objectContaining({
            application_status: 'applying',
            public_program_code: '54',
            insurer_number_present: false,
            recipient_number_present: false,
          }),
        }),
      ]),
    );
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          insurance_type: 'public_subsidy',
          application_status: { in: ['applying', 'change_pending'] },
        }),
        take: 1,
      }),
    );
  });

  it('deduplicates identical batch preview inputs while preserving all response keys', async () => {
    const previews = await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'schedule_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['case_1'] },
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        primary_pharmacist_id: true,
        required_visit_support: true,
        patient: {
          select: {
            id: true,
          },
        },
      },
    });
    expect(findLatestPrescriptionIntakeClassificationMock).toHaveBeenCalledTimes(1);
    expect(resolveBillingRuntimeContextMock).toHaveBeenCalledTimes(1);
    expect(validateBillingRequirementsMock).toHaveBeenCalledTimes(1);
    expect(validateBillingRequirementsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pharmacistId: 'pharm_1',
        pharmacistWeeklyCap: 24,
        cadenceScheduleRows: [],
      }),
    );
    expect(getBillingCadencePreviewMock).toHaveBeenCalledTimes(1);
    expect(getBillingCadencePreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        cadenceScheduleRows: [],
      }),
    );
    expect(Object.keys(previews).sort()).toEqual(['proposal_1', 'schedule_1']);
    expect(previews.proposal_1).toBe(previews.schedule_1);
  });

  it('prefetches case-scoped dependencies once for same-case batch previews across different dates', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      makeInsuranceRecord(),
      makeInsuranceRecord({
        id: 'insurance_care_1',
        insurance_type: 'care',
        number: 'CARE-001',
      }),
    ]);

    const previews = await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_1',
          proposedDate: '2026-04-10',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(findLatestPrescriptionIntakeClassificationMock).toHaveBeenCalledTimes(1);
    expect(patientInsuranceFindManyMock).toHaveBeenCalledTimes(1);
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1'] },
          insurance_type: { in: ['medical', 'care', 'public_subsidy'] },
          is_active: true,
        }),
      }),
    );
    expect(resolvePatientInsuranceMock).not.toHaveBeenCalled();
    expect(Object.keys(previews).sort()).toEqual(['proposal_1', 'proposal_2']);
  });

  it('resolves batch insurance snapshots by proposed date after one range read', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      makeInsuranceRecord({
        id: 'insurance_medical_1',
        insurance_type: 'medical',
        number: 'MED-OLD',
        valid_until: new Date('2026-04-05T00:00:00.000Z'),
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      }),
      makeInsuranceRecord({
        id: 'insurance_care_1',
        insurance_type: 'care',
        number: 'CARE-NEW',
        valid_from: new Date('2026-04-06T00:00:00.000Z'),
        created_at: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ]);

    await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_1',
          proposedDate: '2026-04-10',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(patientInsuranceFindManyMock).toHaveBeenCalledTimes(1);
    expect(resolvePatientInsuranceMock).not.toHaveBeenCalled();
    expect(resolveBillingRuntimeContextMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        payerBasis: 'medical',
        asOfDate: new Date('2026-04-03'),
      }),
    );
    expect(resolveBillingRuntimeContextMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        payerBasis: 'care',
        asOfDate: new Date('2026-04-10'),
      }),
    );
  });

  it('reuses runtime context across same-date same-site batch previews', async () => {
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      },
      {
        id: 'case_2',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharm_2',
        required_visit_support: null,
        patient: {
          id: 'patient_2',
        },
      },
    ]);
    patientInsuranceFindManyMock.mockResolvedValue([
      makeInsuranceRecord({
        id: 'insurance_medical_1',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        number: 'MED-001',
      }),
      makeInsuranceRecord({
        id: 'insurance_medical_2',
        patient_id: 'patient_2',
        insurance_type: 'medical',
        number: 'MED-002',
      }),
    ]);

    const previews = await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_2',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_2',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(findLatestPrescriptionIntakeClassificationMock).toHaveBeenCalledTimes(2);
    expect(patientInsuranceFindManyMock).toHaveBeenCalledTimes(1);
    expect(resolveBillingRuntimeContextMock).toHaveBeenCalledTimes(1);
    expect(resolveBillingRuntimeContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        payerBasis: 'medical',
        siteId: 'site_1',
        asOfDate: new Date('2026-04-03'),
        buildingPatientCount: 1,
      }),
    );
    expect(Object.keys(previews).sort()).toEqual(['proposal_1', 'proposal_2']);
  });

  it('prefetches pharmacist weekly caps once for batch validation', async () => {
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      },
      {
        id: 'case_2',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_2',
        },
      },
    ]);
    patientInsuranceFindManyMock.mockResolvedValue([
      makeInsuranceRecord({
        id: 'insurance_medical_1',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        number: 'MED-001',
      }),
      makeInsuranceRecord({
        id: 'insurance_medical_2',
        patient_id: 'patient_2',
        insurance_type: 'medical',
        number: 'MED-002',
      }),
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'pharm_1', max_weekly_visits: 18 }]);

    await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_2',
          proposedDate: '2026-04-10',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(userFindManyMock).toHaveBeenCalledTimes(1);
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['pharm_1'] },
      },
      select: {
        id: true,
        max_weekly_visits: true,
      },
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(validateBillingRequirementsMock).toHaveBeenCalledTimes(2);
    expect(validateBillingRequirementsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        caseId: 'case_1',
        pharmacistId: 'pharm_1',
        pharmacistWeeklyCap: 18,
      }),
    );
    expect(validateBillingRequirementsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        caseId: 'case_2',
        pharmacistId: 'pharm_1',
        pharmacistWeeklyCap: 18,
      }),
    );
  });

  it('prefetches cadence schedules once for batch previews', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      {
        cycle: {
          patient_id: 'patient_1',
        },
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharm_1',
        visit_type: 'regular',
      },
      {
        cycle: {
          patient_id: 'patient_2',
        },
        scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
        pharmacist_id: 'pharm_2',
        visit_type: 'regular',
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      },
      {
        id: 'case_2',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharm_2',
        required_visit_support: null,
        patient: {
          id: 'patient_2',
        },
      },
    ]);

    await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_2',
          proposedDate: '2026-04-10',
          pharmacistId: 'pharm_2',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(visitScheduleFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          cycle: {
            patient_id: { in: ['patient_1', 'patient_2'] },
          },
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
          },
        }),
        select: {
          cycle: {
            select: {
              patient_id: true,
            },
          },
          scheduled_date: true,
          pharmacist_id: true,
          visit_type: true,
        },
      }),
    );
    expect(getBillingCadencePreviewMock).toHaveBeenCalledTimes(2);
    expect(getBillingCadencePreviewMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        patientId: 'patient_1',
        cadenceScheduleRows: [
          {
            patient_id: 'patient_1',
            scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
            pharmacist_id: 'pharm_1',
            visit_type: 'regular',
          },
          {
            patient_id: 'patient_2',
            scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
            pharmacist_id: 'pharm_2',
            visit_type: 'regular',
          },
        ],
      }),
    );
  });

  it('prefetches workflow gate snapshots once for batch validation', async () => {
    const expiredConsentDate = new Date('2026-04-05T00:00:00.000Z');
    const validConsentDate = new Date('2027-05-01T00:00:00.000Z');
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent_expiring',
        patient_id: 'patient_1',
        expiry_date: expiredConsentDate,
        obtained_date: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        id: 'consent_current',
        patient_id: 'patient_2',
        expiry_date: validConsentDate,
        obtained_date: new Date('2026-03-02T00:00:00.000Z'),
      },
    ]);
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_1',
        case_id: 'case_1',
        status: 'approved',
        next_review_date: new Date('2026-04-09T00:00:00.000Z'),
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        version: 1,
        approved_at: new Date('2026-03-25T00:00:00.000Z'),
      },
      {
        id: 'plan_2',
        case_id: 'case_2',
        status: 'approved',
        next_review_date: new Date('2026-05-01T00:00:00.000Z'),
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        version: 1,
        approved_at: new Date('2026-03-26T00:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      },
      {
        id: 'case_2',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharm_2',
        required_visit_support: null,
        patient: {
          id: 'patient_2',
        },
      },
    ]);

    await buildVisitScheduleBillingPreviewBatch(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-10',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        },
        {
          key: 'proposal_2',
          caseId: 'case_2',
          proposedDate: '2026-04-10',
          pharmacistId: 'pharm_2',
          siteId: 'site_1',
          visitType: 'regular',
        },
      ],
      'org_1',
    );

    expect(consentRecordFindManyMock).toHaveBeenCalledTimes(1);
    expect(consentRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1', 'patient_2'] },
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
        }),
        select: {
          id: true,
          patient_id: true,
          expiry_date: true,
          obtained_date: true,
        },
      }),
    );
    expect(managementPlanFindManyMock).toHaveBeenCalledTimes(1);
    expect(managementPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1', 'case_2'] },
          status: 'approved',
          approved_at: { not: null },
        }),
        select: {
          id: true,
          case_id: true,
          status: true,
          next_review_date: true,
          effective_from: true,
          version: true,
          approved_at: true,
        },
      }),
    );

    const firstValidationArgs = validateBillingRequirementsMock.mock.calls[0]?.[0];
    const secondValidationArgs = validateBillingRequirementsMock.mock.calls[1]?.[0];
    expect(firstValidationArgs).toEqual(
      expect.objectContaining({
        patientId: 'patient_1',
        workflowSnapshot: expect.any(Object),
      }),
    );
    expect(secondValidationArgs).toEqual(
      expect.objectContaining({
        patientId: 'patient_2',
        workflowSnapshot: expect.any(Object),
      }),
    );
    expect(
      firstValidationArgs.workflowSnapshot.resolveConsent({
        patientId: 'patient_1',
        asOf: new Date('2026-04-10T00:00:00.000Z'),
      }),
    ).toBe(null);
    expect(
      secondValidationArgs.workflowSnapshot.resolveConsent({
        patientId: 'patient_2',
        asOf: new Date('2026-04-10T00:00:00.000Z'),
      }),
    ).toEqual({ id: 'consent_current', expiry_date: validConsentDate });
    expect(
      firstValidationArgs.workflowSnapshot.resolveManagementPlan({
        caseId: 'case_1',
        asOf: new Date('2026-04-10T00:00:00.000Z'),
      }),
    ).toEqual({
      current: { id: 'plan_1', status: 'approved' },
      reviewOverdue: true,
    });
  });
});
