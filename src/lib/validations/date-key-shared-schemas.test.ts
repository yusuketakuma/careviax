import { describe, expect, it } from 'vitest';
import { allergyEntrySchema } from './patient-allergy';
import { createBusinessHolidaySchema } from './business-holiday';
import { updateFirstVisitDocumentSchema } from './first-visit-document';
import { createManagementPlanSchema } from './management-plan';
import { createMedicationProfileSchema } from './medication';
import { createPatientSchema, patientIntakeSchema } from './patient';

describe('shared date-key validation schemas', () => {
  it('rejects non-existent calendar dates across patient and medication validators', () => {
    expect(
      allergyEntrySchema.safeParse({
        drug_name: 'ペニシリン',
        category: 'drug',
        severity: 'severe',
        confirmed_at: '2026-02-31',
      }).success,
    ).toBe(false);

    expect(
      createMedicationProfileSchema.safeParse({
        patient_id: 'patient_1',
        drug_name: '薬剤A',
        start_date: '2026-02-31',
      }).success,
    ).toBe(false);

    expect(
      createPatientSchema.safeParse({
        name: '田中 太郎',
        name_kana: 'タナカ タロウ',
        birth_date: '1940-02-31',
        gender: 'male',
      }).success,
    ).toBe(false);

    expect(
      patientIntakeSchema.safeParse({
        home_start_date: '2026-02-31',
      }).success,
    ).toBe(false);
  });

  it('rejects non-existent calendar dates across operational document validators', () => {
    expect(
      createBusinessHolidaySchema.safeParse({
        date: '2026-02-31',
        name: '臨時休業',
        holiday_type: 'site_closure',
      }).success,
    ).toBe(false);

    expect(
      updateFirstVisitDocumentSchema.safeParse({
        document_action: {
          action: 'generated',
          contract_date: '2026-02-31',
        },
      }).success,
    ).toBe(false);

    expect(
      createManagementPlanSchema.safeParse({
        case_id: 'case_1',
        effective_from: '2026-02-31',
      }).success,
    ).toBe(false);
  });
});
