import { describe, expect, it } from 'vitest';
import {
  getVisitScheduleBillingPreviewTestSupport,
  registerVisitScheduleBillingPreviewBeforeEach,
} from '../visit-schedule-billing-preview.test-support';
import { buildVisitScheduleBillingPreview } from '../visit-schedule-billing-preview';

const {
  careCaseFindFirstMock,
  patientInsuranceFindManyMock,
  resolvePatientInsuranceMock,
  findLatestBillingPrescriptionClassificationMock,
  validateBillingRequirementsMock,
  getBillingCadencePreviewMock,
  resolveBillingRuntimeContextMock,
  makeInsuranceRecord,
  makeInjectedBillingPreviewDb,
} = getVisitScheduleBillingPreviewTestSupport();

describe('buildVisitScheduleBillingPreview', () => {
  registerVisitScheduleBillingPreviewBeforeEach();

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
    expect(findLatestBillingPrescriptionClassificationMock).toHaveBeenCalledWith(injectedDb, {
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
});
