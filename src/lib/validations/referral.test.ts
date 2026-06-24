import { describe, expect, it } from 'vitest';
import { createReferralSchema } from './referral';

const validPayload = {
  name: 'Valid Person',
  name_kana: 'Valid Kana',
  birth_date: '1950-01-01',
  gender: 'female',
  referral_type: 'physician',
  referral_source: 'Clinic',
  referral_date: '2026-06-23',
  referral_notes: 'Needs intake',
  doc_physician_order: true,
  doc_consent: false,
  doc_health_insurance: true,
  doc_care_insurance: false,
};

describe('createReferralSchema', () => {
  it('accepts the current referral form payload shape', () => {
    expect(createReferralSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects missing referral_type before writes', () => {
    const parsed = createReferralSchema.safeParse({
      ...validPayload,
      referral_type: undefined,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.referral_type).toEqual([
        '依頼種別を選択してください',
      ]);
    }
  });

  it('rejects invalid dates and unknown checklist keys', () => {
    const parsed = createReferralSchema.safeParse({
      ...validPayload,
      referral_date: '2026-02-31',
      doc_unknown: true,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.referral_date).toBeTruthy();
      expect(parsed.error.flatten().formErrors.join(' ')).toContain('doc_unknown');
    }
  });
});
