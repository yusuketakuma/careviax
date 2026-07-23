import { describe, expect, it } from 'vitest';
import {
  getVisitScheduleBillingPreviewTestSupport,
  registerVisitScheduleBillingPreviewBeforeEach,
} from '../visit-schedule-billing-preview.test-support';
import { buildVisitScheduleBillingPreviewBatch } from '../visit-schedule-billing-preview';

const {
  careCaseFindFirstMock,
  careCaseFindManyMock,
  patientInsuranceFindManyMock,
  resolvePatientInsuranceMock,
  findLatestBillingPrescriptionClassificationMock,
  findLatestBillingPrescriptionClassificationsByCaseIdsMock,
  validateBillingRequirementsMock,
  getBillingCadencePreviewMock,
  resolveBillingRuntimeContextMock,
  makeInsuranceRecord,
} = getVisitScheduleBillingPreviewTestSupport();

describe('buildVisitScheduleBillingPreview', () => {
  registerVisitScheduleBillingPreviewBeforeEach();

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
    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1'],
      },
    );
    expect(findLatestBillingPrescriptionClassificationMock).not.toHaveBeenCalled();
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
    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1'],
      },
    );
    expect(findLatestBillingPrescriptionClassificationMock).not.toHaveBeenCalled();
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

    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledTimes(1);
    expect(findLatestBillingPrescriptionClassificationsByCaseIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        caseIds: ['case_1', 'case_2'],
      },
    );
    expect(findLatestBillingPrescriptionClassificationMock).not.toHaveBeenCalled();
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
