import { describe, expect, it } from 'vitest';
import {
  getVisitScheduleBillingPreviewTestSupport,
  registerVisitScheduleBillingPreviewBeforeEach,
} from '../visit-schedule-billing-preview.test-support';
import { buildVisitScheduleBillingPreviewBatch } from '../visit-schedule-billing-preview';

const {
  careCaseFindManyMock,
  patientInsuranceFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleProposalFindManyMock,
  userFindFirstMock,
  userFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  findLatestBillingPrescriptionClassificationsByCaseIdsMock,
  validateBillingRequirementsMock,
  getBillingCadencePreviewMock,
  waitForAsyncAssertion,
  makeInsuranceRecord,
} = getVisitScheduleBillingPreviewTestSupport();

describe('buildVisitScheduleBillingPreview', () => {
  registerVisitScheduleBillingPreviewBeforeEach();

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
    findLatestBillingPrescriptionClassificationsByCaseIdsMock.mockResolvedValue(
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
