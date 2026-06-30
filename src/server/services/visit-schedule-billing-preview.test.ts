import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  findLatestPrescriptionIntakeClassificationMock,
  findLatestPrescriptionIntakeClassificationsByCaseIdsMock,
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
  findLatestPrescriptionIntakeClassificationMock: vi.fn(),
  findLatestPrescriptionIntakeClassificationsByCaseIdsMock: vi.fn(),
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

vi.mock('./prescription-intake-classification', () => ({
  findLatestPrescriptionIntakeClassification: findLatestPrescriptionIntakeClassificationMock,
  findLatestPrescriptionIntakeClassificationsByCaseIds:
    findLatestPrescriptionIntakeClassificationsByCaseIdsMock,
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
  type VisitScheduleBillingPreviewDb,
} from './visit-schedule-billing-preview';

async function waitForAsyncAssertion(assertion: () => void) {
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

function makeInjectedBillingPreviewDb(overrides: Partial<VisitScheduleBillingPreviewDb> = {}) {
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
      emergency_category: null,
    });
    findLatestPrescriptionIntakeClassificationsByCaseIdsMock.mockResolvedValue(
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

  it('uses the injected db for single preview reads instead of the module prisma client', async () => {
    const injectedDb = makeInjectedBillingPreviewDb();

    const preview = await buildVisitScheduleBillingPreview(
      {
        orgId: 'org_1',
        caseId: 'case_1',
        proposedDate: '2026-04-03',
        pharmacistId: 'pharm_1',
        siteId: 'site_1',
      },
      { db: injectedDb },
    );

    expect(preview).toMatchObject({
      recommended_visit_type: 'regular',
      suggested_schedule_slot_count: 1,
    });
    expect(injectedDb.careCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'case_1',
          org_id: 'org_1',
        },
      }),
    );
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(findLatestPrescriptionIntakeClassificationMock).toHaveBeenCalledWith(injectedDb, {
      orgId: 'org_1',
      caseId: 'case_1',
    });
    expect(resolvePatientInsuranceMock).toHaveBeenCalledWith(
      injectedDb,
      expect.objectContaining({
        orgId: 'org_1',
        patientId: 'patient_1',
      }),
    );
    expect(resolveBillingRuntimeContextMock).toHaveBeenCalledWith(
      injectedDb,
      expect.objectContaining({
        orgId: 'org_1',
        siteId: 'site_1',
      }),
    );
    expect(validateBillingRequirementsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: injectedDb,
        orgId: 'org_1',
        pharmacistId: 'pharm_1',
      }),
    );
    expect(getBillingCadencePreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: injectedDb,
        orgId: 'org_1',
        patientId: 'patient_1',
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
          OR: [{ valid_from: null }, { valid_from: { lte: new Date('2026-04-03T00:00:00.000Z') } }],
          AND: [
            {
              OR: [
                { valid_until: null },
                { valid_until: { gte: new Date('2026-04-03T00:00:00.000Z') } },
              ],
            },
          ],
        }),
        take: 1,
      }),
    );
  });

  it('keeps same-day batch insurance prefetch on UTC date sentinels across runtime timezones', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      makeInsuranceRecord({
        id: 'insurance_care_pending',
        insurance_type: 'care',
        application_status: 'change_pending',
        number: null,
        previous_care_level: 'care_2',
        provisional_care_level: 'care_3',
        confirmed_care_level: null,
        valid_from: new Date('2026-04-03T00:00:00.000Z'),
        valid_until: new Date('2026-04-03T00:00:00.000Z'),
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
      ],
      'org_1',
    );

    expect(previews.proposal_1?.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'care_insurance_application_pending',
        }),
      ]),
    );
    expect(validateBillingRequirementsMock.mock.calls[0]?.[0].proposedDate.toISOString()).toBe(
      '2026-04-03T00:00:00.000Z',
    );
    expect(resolveBillingRuntimeContextMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        asOfDate: new Date('2026-04-03T00:00:00.000Z'),
      }),
    );
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ valid_from: null }, { valid_from: { lte: new Date('2026-04-03T00:00:00.000Z') } }],
          AND: [
            {
              OR: [
                { valid_until: null },
                { valid_until: { gte: new Date('2026-04-03T00:00:00.000Z') } },
              ],
            },
          ],
        }),
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
    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1'],
      },
    );
    expect(findLatestPrescriptionIntakeClassificationMock).not.toHaveBeenCalled();
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
    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1'],
      },
    );
    expect(findLatestPrescriptionIntakeClassificationMock).not.toHaveBeenCalled();
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

    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestPrescriptionIntakeClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1', 'case_2'],
      },
    );
    expect(findLatestPrescriptionIntakeClassificationMock).not.toHaveBeenCalled();
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
        org_id: 'org_1',
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
        id: 'schedule_1',
        cycle: {
          patient_id: 'patient_1',
        },
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharm_1',
        visit_type: 'regular',
      },
      {
        id: 'schedule_2',
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
          id: true,
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
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          finalized_schedule_id: null,
          proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
          case_: {
            patient_id: { in: ['patient_1', 'patient_2'] },
          },
        }),
        select: {
          id: true,
          proposal_batch_id: true,
          proposed_date: true,
          proposed_pharmacist_id: true,
          visit_type: true,
          finalized_schedule_id: true,
          reschedule_source_schedule_id: true,
          case_: {
            select: {
              patient_id: true,
            },
          },
        },
      }),
    );
    expect(getBillingCadencePreviewMock).toHaveBeenCalledTimes(2);
    expect(getBillingCadencePreviewMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        patientId: 'patient_1',
        cadenceProposalRows: [],
        cadenceScheduleRows: [
          {
            id: 'schedule_1',
            patient_id: 'patient_1',
            scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
            pharmacist_id: 'pharm_1',
            visit_type: 'regular',
          },
          {
            id: 'schedule_2',
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

  it('bounds concurrent batch preview validation work', async () => {
    const originalConcurrency = process.env.BILLING_PREVIEW_BATCH_CONCURRENCY;
    process.env.BILLING_PREVIEW_BATCH_CONCURRENCY = '2';
    careCaseFindManyMock.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `case_${index + 1}`,
        patient_id: `patient_${index + 1}`,
        primary_pharmacist_id: 'pharm_1',
        required_visit_support: null,
        patient: {
          id: `patient_${index + 1}`,
        },
      })),
    );
    findLatestPrescriptionIntakeClassificationsByCaseIdsMock.mockResolvedValue(
      new Map(
        Array.from({ length: 4 }, (_, index) => [
          `case_${index + 1}`,
          {
            prescription_category: 'regular',
            emergency_category: null,
          },
        ]),
      ),
    );
    patientInsuranceFindManyMock.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) =>
        makeInsuranceRecord({
          id: `insurance_${index + 1}`,
          patient_id: `patient_${index + 1}`,
          insurance_type: 'medical',
        }),
      ),
    );
    let activeValidations = 0;
    let maxActiveValidations = 0;
    const pendingValidations: Array<() => void> = [];
    validateBillingRequirementsMock.mockImplementation(
      async () =>
        new Promise<[]>((resolve) => {
          activeValidations += 1;
          maxActiveValidations = Math.max(maxActiveValidations, activeValidations);
          pendingValidations.push(() => {
            activeValidations -= 1;
            resolve([]);
          });
        }),
    );

    try {
      const run = buildVisitScheduleBillingPreviewBatch(
        Array.from({ length: 4 }, (_, index) => ({
          key: `proposal_${index + 1}`,
          caseId: `case_${index + 1}`,
          proposedDate: '2026-04-03',
          pharmacistId: 'pharm_1',
          siteId: 'site_1',
          visitType: 'regular',
        })),
        'org_1',
      );

      await waitForAsyncAssertion(() => {
        expect(pendingValidations).toHaveLength(2);
      });
      expect(maxActiveValidations).toBe(2);

      pendingValidations.splice(0).forEach((release) => release());
      await waitForAsyncAssertion(() => {
        expect(pendingValidations).toHaveLength(2);
      });
      expect(maxActiveValidations).toBe(2);

      pendingValidations.splice(0).forEach((release) => release());
      await expect(run).resolves.toMatchObject({
        proposal_1: expect.any(Object),
        proposal_2: expect.any(Object),
        proposal_3: expect.any(Object),
        proposal_4: expect.any(Object),
      });
      expect(validateBillingRequirementsMock).toHaveBeenCalledTimes(4);
      expect(maxActiveValidations).toBe(2);
    } finally {
      pendingValidations.splice(0).forEach((release) => release());
      if (originalConcurrency === undefined) {
        delete process.env.BILLING_PREVIEW_BATCH_CONCURRENCY;
      } else {
        process.env.BILLING_PREVIEW_BATCH_CONCURRENCY = originalConcurrency;
      }
    }
  });
});
