import { beforeEach, vi } from 'vitest';

const {
  careCaseFindFirstMock,
  careCaseFindManyMock,
  patientInsuranceFindManyMock,
  prescriptionIntakeFindFirstMock,
  prescriptionIntakeFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleProposalFindManyMock,
  visitScheduleCountMock,
  userFindFirstMock,
  userFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  pharmacySiteInsuranceConfigFindFirstMock,
  resolvePatientInsuranceMock,
  findLatestBillingPrescriptionClassificationMock,
  findLatestBillingPrescriptionClassificationsByCaseIdsMock,
  validateBillingRequirementsMock,
  getBillingCadencePreviewMock,
  resolveBillingRuntimeContextMock,
} = vi.hoisted(() => ({
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  pharmacySiteInsuranceConfigFindFirstMock: vi.fn(),
  resolvePatientInsuranceMock: vi.fn(),
  findLatestBillingPrescriptionClassificationMock: vi.fn(),
  findLatestBillingPrescriptionClassificationsByCaseIdsMock: vi.fn(),
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
      findMany: prescriptionIntakeFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    visitScheduleProposal: {
      findMany: visitScheduleProposalFindManyMock,
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

vi.mock('./billing-prescription-classification', () => ({
  findLatestBillingPrescriptionClassification: findLatestBillingPrescriptionClassificationMock,
  findLatestBillingPrescriptionClassificationsByCaseIds:
    findLatestBillingPrescriptionClassificationsByCaseIdsMock,
}));

vi.mock('./billing-requirement-validator', () => ({
  validateBillingRequirements: validateBillingRequirementsMock,
  getBillingCadencePreview: getBillingCadencePreviewMock,
}));

vi.mock('./billing-runtime-context', () => ({
  resolveBillingRuntimeContext: resolveBillingRuntimeContextMock,
}));

import type { VisitScheduleBillingPreviewDb } from './visit-schedule-billing-preview';

export async function waitForAsyncAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

export function makeInsuranceRecord(overrides: Record<string, unknown> = {}) {
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

export function makeInjectedBillingPreviewDb(
  overrides: Partial<VisitScheduleBillingPreviewDb> = {},
) {
  return {
    careCase: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: 'patient_1',
        },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'case_1',
          patient_id: 'patient_1',
          primary_pharmacist_id: 'pharm_1',
          required_visit_support: null,
          patient: {
            id: 'patient_1',
          },
        },
      ]),
    },
    patientInsurance: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    visitScheduleProposal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ max_weekly_visits: 24 }),
      findMany: vi.fn().mockResolvedValue([{ id: 'pharm_1', max_weekly_visits: 24 }]),
    },
    consentRecord: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    managementPlan: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    pharmacySiteInsuranceConfig: {
      findFirst: vi.fn(),
    },
    ...overrides,
  } as unknown as VisitScheduleBillingPreviewDb;
}

export function getVisitScheduleBillingPreviewTestSupport() {
  return {
    careCaseFindFirstMock,
    careCaseFindManyMock,
    patientInsuranceFindManyMock,
    prescriptionIntakeFindFirstMock,
    prescriptionIntakeFindManyMock,
    visitScheduleFindManyMock,
    visitScheduleProposalFindManyMock,
    visitScheduleCountMock,
    userFindFirstMock,
    userFindManyMock,
    consentRecordFindManyMock,
    managementPlanFindManyMock,
    pharmacySiteInsuranceConfigFindFirstMock,
    resolvePatientInsuranceMock,
    findLatestBillingPrescriptionClassificationMock,
    findLatestBillingPrescriptionClassificationsByCaseIdsMock,
    validateBillingRequirementsMock,
    getBillingCadencePreviewMock,
    resolveBillingRuntimeContextMock,
    waitForAsyncAssertion,
    makeInsuranceRecord,
    makeInjectedBillingPreviewDb,
  };
}

export function registerVisitScheduleBillingPreviewBeforeEach() {
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
    findLatestBillingPrescriptionClassificationMock.mockResolvedValue({
      prescription_category: 'regular',
      emergency_category: null,
    });
    findLatestBillingPrescriptionClassificationsByCaseIdsMock.mockResolvedValue(
      new Map([
        [
          'case_1',
          {
            prescription_category: 'regular',
            emergency_category: null,
          },
        ],
      ]),
    );
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
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
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
}
