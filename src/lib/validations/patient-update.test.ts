import { describe, expect, it } from 'vitest';
import { createPatientSchema, updatePatientSchema } from './patient';

const patientIdentity = {
  name: '患者A',
  name_kana: 'カンジャエー',
  birth_date: '1980-01-01',
  gender: 'male' as const,
};

describe('patient PATCH intake clear validation', () => {
  it('accepts explicit null clears for nullable boolean, enum/text, and nested add-on fields', () => {
    expect(
      updatePatientSchema.safeParse({
        expected_updated_at: '2026-07-22T00:00:00.000Z',
        care_case_id: 'case_1',
        expected_care_case_version: 4,
        intake: {
          mcs_linked: null,
          medication_manager: null,
          home_pharmacy_add_on_2: {
            candidate: null,
            comprehensive_support_add_on: null,
          },
        },
      }).success,
    ).toBe(true);
  });

  it('keeps create intake fields non-nullable', () => {
    expect(
      createPatientSchema.safeParse({
        ...patientIdentity,
        intake: {
          mcs_linked: null,
          medication_manager: null,
          home_pharmacy_add_on_2: { candidate: null },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts enabling enteral nutrition without repeating a stored period in the PATCH', () => {
    expect(
      updatePatientSchema.safeParse({
        expected_updated_at: '2026-07-22T00:00:00.000Z',
        care_case_id: 'case_1',
        expected_care_case_version: 4,
        intake: { ent_prescription: true },
      }).success,
    ).toBe(true);
  });

  it('keeps create enteral nutrition strict when no period is provided', () => {
    expect(
      createPatientSchema.safeParse({
        ...patientIdentity,
        intake: { ent_prescription: true },
      }).success,
    ).toBe(false);
  });
});
