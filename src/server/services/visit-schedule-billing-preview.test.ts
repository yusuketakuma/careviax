import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  careCaseFindFirstMock,
  careCaseFindManyMock,
  patientInsuranceFindManyMock,
  prescriptionIntakeFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  userFindFirstMock,
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
    expect(getBillingCadencePreviewMock).toHaveBeenCalledTimes(1);
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
});
