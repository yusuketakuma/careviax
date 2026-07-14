import { describe, expect, it } from 'vitest';
import {
  buildEffectivePatientInsuranceInput,
  incompatiblePatientInsuranceFieldClears,
  patientInsuranceCreateSchema,
  patientInsuranceUpdateSchema,
  validateEffectivePatientInsuranceUpdate,
} from './patient-insurance';

const existingCareInsurance = {
  insurance_type: 'care' as const,
  application_status: 'confirmed' as const,
  public_program_code: null,
  valid_from: new Date('2026-04-01T00:00:00.000Z'),
  valid_until: new Date('2027-03-31T00:00:00.000Z'),
  application_submitted_at: new Date('2026-03-01T00:00:00.000Z'),
  decision_at: new Date('2026-03-20T00:00:00.000Z'),
  previous_care_level: null,
  provisional_care_level: null,
  confirmed_care_level: 'care_2',
  is_active: true,
};

describe('patient insurance validation', () => {
  it('requires the official confirmed level for confirmed care insurance', () => {
    const result = patientInsuranceCreateSchema.safeParse({
      insurance_type: 'care',
      application_status: 'confirmed',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('validation should fail');
    expect(result.error.flatten().fieldErrors).toMatchObject({
      confirmed_care_level: ['確定済みの介護保険には要介護状態区分が必要です'],
    });

    expect(
      patientInsuranceCreateSchema.safeParse({
        insurance_type: 'care',
        application_status: 'confirmed',
        confirmed_care_level: 'support_2',
      }).success,
    ).toBe(true);
  });

  it('requires previous and provisional official levels while a care classification change is pending', () => {
    const result = patientInsuranceCreateSchema.safeParse({
      insurance_type: 'care',
      application_status: 'change_pending',
      previous_care_level: 'care_2',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('validation should fail');
    expect(result.error.flatten().fieldErrors).toMatchObject({
      provisional_care_level: ['区分変更中の介護保険には暫定区分が必要です'],
    });

    expect(
      patientInsuranceCreateSchema.safeParse({
        insurance_type: 'care',
        application_status: 'change_pending',
        previous_care_level: 'care_2',
        provisional_care_level: 'care_3',
      }).success,
    ).toBe(true);
  });

  it('keeps applying and not-applicable care records status-driven', () => {
    expect(
      patientInsuranceCreateSchema.safeParse({
        insurance_type: 'care',
        application_status: 'applying',
      }).success,
    ).toBe(true);
    expect(
      patientInsuranceCreateSchema.safeParse({
        insurance_type: 'care',
        application_status: 'not_applicable',
      }).success,
    ).toBe(true);
  });

  it('preserves incomplete inactive care history while requiring classification on reactivation', () => {
    expect(
      patientInsuranceCreateSchema.safeParse({
        insurance_type: 'care',
        application_status: 'confirmed',
        is_active: false,
      }).success,
    ).toBe(true);

    const incompleteHistory = {
      ...existingCareInsurance,
      confirmed_care_level: null,
      is_active: false,
    };
    expect(
      validateEffectivePatientInsuranceUpdate(incompleteHistory, { notes: '履歴を保持' }).success,
    ).toBe(true);
    expect(
      validateEffectivePatientInsuranceUpdate(incompleteHistory, { is_active: true }).success,
    ).toBe(false);
  });

  it('treats an unknown persisted care level as missing while preserving inactive history', () => {
    const legacyHistory = {
      ...existingCareInsurance,
      confirmed_care_level: 'legacy_unknown_level',
      is_active: false,
    };

    expect(
      buildEffectivePatientInsuranceInput(legacyHistory, { notes: '履歴を保持' }),
    ).toMatchObject({
      confirmed_care_level: null,
      is_active: false,
    });
    expect(
      validateEffectivePatientInsuranceUpdate(legacyHistory, { notes: '履歴を保持' }).success,
    ).toBe(true);

    const reactivation = validateEffectivePatientInsuranceUpdate(legacyHistory, {
      is_active: true,
    });
    expect(reactivation.success).toBe(false);
    if (reactivation.success) throw new Error('validation should fail');
    expect(reactivation.error.flatten().fieldErrors).toMatchObject({
      confirmed_care_level: ['確定済みの介護保険には要介護状態区分が必要です'],
    });
  });

  it('requires a two-digit public program code for public subsidy records', () => {
    const missing = patientInsuranceCreateSchema.safeParse({
      insurance_type: 'public_subsidy',
      application_status: 'applying',
    });
    const invalid = patientInsuranceCreateSchema.safeParse({
      insurance_type: 'public_subsidy',
      public_program_code: '5A',
    });

    expect(missing.success).toBe(false);
    expect(invalid.success).toBe(false);
    if (missing.success) throw new Error('validation should fail');
    expect(missing.error.flatten().fieldErrors).toMatchObject({
      public_program_code: ['公費保険には公費制度コードが必要です'],
    });
  });

  it('validates effective one-sided date updates against persisted boundaries', () => {
    const patch = patientInsuranceUpdateSchema.parse({ valid_from: '2027-04-01' });
    const result = validateEffectivePatientInsuranceUpdate(existingCareInsurance, patch);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('validation should fail');
    expect(result.error.flatten().fieldErrors).toMatchObject({
      valid_until: ['有効期限は有効開始日以降の日付を指定してください'],
    });
  });

  it('merges effective update state and clears fields incompatible with the next type', () => {
    const patch = patientInsuranceUpdateSchema.parse({ insurance_type: 'medical' });
    const effective = buildEffectivePatientInsuranceInput(existingCareInsurance, patch);

    expect(effective).toMatchObject({
      insurance_type: 'medical',
      public_program_code: null,
      previous_care_level: null,
      provisional_care_level: null,
      confirmed_care_level: null,
    });
    expect(validateEffectivePatientInsuranceUpdate(existingCareInsurance, patch).success).toBe(
      true,
    );
    expect(incompatiblePatientInsuranceFieldClears('medical')).toEqual({
      public_program_code: null,
      previous_care_level: null,
      provisional_care_level: null,
      confirmed_care_level: null,
    });
  });

  it('rejects an explicitly incompatible field instead of silently accepting it', () => {
    const result = patientInsuranceUpdateSchema.safeParse({
      insurance_type: 'medical',
      confirmed_care_level: 'care_3',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('validation should fail');
    expect(result.error.flatten().fieldErrors).toMatchObject({
      previous_care_level: ['介護度情報は介護保険でのみ指定できます'],
    });
  });
});
