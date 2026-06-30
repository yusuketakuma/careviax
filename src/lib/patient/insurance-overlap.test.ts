import { describe, expect, it } from 'vitest';
import { buildPatientInsuranceOverlapWhere } from './insurance-overlap';

describe('buildPatientInsuranceOverlapWhere', () => {
  it('builds bounded interval overlap filters for active patient insurance', () => {
    expect(
      buildPatientInsuranceOverlapWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        insuranceType: 'care',
        validFrom: '2026-04-01',
        validUntil: '2027-03-31',
      }),
    ).toEqual({
      org_id: 'org_1',
      patient_id: 'patient_1',
      insurance_type: 'care',
      is_active: true,
      AND: [
        { OR: [{ valid_from: null }, { valid_from: { lte: new Date('2027-03-31') } }] },
        { OR: [{ valid_until: null }, { valid_until: { gte: new Date('2026-04-01') } }] },
      ],
    });
  });

  it('does not constrain existing start dates for an open-ended new interval', () => {
    expect(
      buildPatientInsuranceOverlapWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        insuranceType: 'medical',
        validFrom: '2026-04-01',
        validUntil: null,
      }),
    ).toEqual({
      org_id: 'org_1',
      patient_id: 'patient_1',
      insurance_type: 'medical',
      is_active: true,
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: new Date('2026-04-01') } }] }],
    });
  });

  it('does not constrain existing end dates when the new start date is unset', () => {
    expect(
      buildPatientInsuranceOverlapWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        insuranceType: 'medical',
        validFrom: null,
        validUntil: '2027-03-31',
      }),
    ).toEqual({
      org_id: 'org_1',
      patient_id: 'patient_1',
      insurance_type: 'medical',
      is_active: true,
      AND: [{ OR: [{ valid_from: null }, { valid_from: { lte: new Date('2027-03-31') } }] }],
    });
  });

  it('treats a fully unbounded active interval as overlapping all active rows of the same scope', () => {
    expect(
      buildPatientInsuranceOverlapWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        insuranceType: 'public_subsidy',
        publicProgramCode: '54',
        validFrom: null,
        validUntil: null,
        excludeInsuranceId: 'insurance_1',
      }),
    ).toEqual({
      org_id: 'org_1',
      patient_id: 'patient_1',
      insurance_type: 'public_subsidy',
      is_active: true,
      id: { not: 'insurance_1' },
      public_program_code: '54',
    });
  });
});
