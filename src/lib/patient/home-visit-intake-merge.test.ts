import { describe, expect, it } from 'vitest';
import { mergeHomeVisitIntake, validateMergedHomeVisitIntake } from './home-visit-intake-merge';

describe('mergeHomeVisitIntake explicit clears', () => {
  it('deletes own-key null boolean, enum/text, and nested add-on values', () => {
    expect(
      mergeHomeVisitIntake({
        current: {
          mcs_linked: true,
          medication_manager: 'self',
          home_pharmacy_add_on_2: {
            candidate: 'add_on_2_ro_candidate',
            comprehensive_support_add_on: 'yes',
          },
        },
        intake: {
          mcs_linked: null,
          medication_manager: null,
          home_pharmacy_add_on_2: {
            candidate: null,
            comprehensive_support_add_on: null,
          },
        },
      }),
    ).toBeNull();
  });
});

describe('validateMergedHomeVisitIntake', () => {
  it.each([
    {
      value: { ent_prescription: true },
      message: '在宅経管栄養を有効にする場合は期間を指定してください',
    },
    {
      value: { ent_period_from: '2026-04-02', ent_period_to: '2026-04-01' },
      message: '在宅経管栄養期間の開始日は終了日以前である必要があります',
    },
  ])('rejects an invalid final merged intake', ({ value, message }) => {
    expect(validateMergedHomeVisitIntake(value)).toEqual([message]);
  });
});
