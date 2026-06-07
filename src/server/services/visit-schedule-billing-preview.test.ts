import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  careCaseFindFirstMock,
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

import { buildVisitScheduleBillingPreview } from './visit-schedule-billing-preview';

function makeInsuranceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'insurance_1',
    insurance_type: 'medical',
    application_status: 'confirmed',
    number: 'INS-001',
    public_program_code: null,
    previous_care_level: null,
    provisional_care_level: null,
    confirmed_care_level: null,
    is_active: true,
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
});
