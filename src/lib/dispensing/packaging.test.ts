import { describe, expect, it } from 'vitest';
import {
  PACKAGING_INSTRUCTION_TAG_OPTIONS,
  buildPackagingInstructions,
  composePackagingDetail,
  extractPackagingInstructionTags,
  parsePackagingMethod,
  resolvePackagingSettings,
  splitPackagingDetail,
} from './packaging';

describe('packaging helpers', () => {
  it('parses known legacy instructions into an enum and detail', () => {
    expect(parsePackagingMethod('朝夕で一包化 7日分')).toEqual({
      method: 'morning_evening_unit_dose',
      detail: '7日分',
    });
  });

  it('applies patient packaging defaults when a line has no explicit setting', () => {
    expect(
      resolvePackagingSettings({
        profile: {
          default_packaging_method: 'medication_box',
          medication_box_color: '青',
          notes: '昼は別袋',
        },
      }),
    ).toEqual({
      packaging_method: 'medication_box',
      packaging_instructions: 'お薬BOX / BOX色:青 / 昼は別袋',
    });
  });

  it('keeps none as no display instruction', () => {
    expect(buildPackagingInstructions({ method: 'none', detail: null })).toBeNull();
  });

  it('combines a preset detail and free text without duplication', () => {
    expect(composePackagingDetail('朝だけ別包', '昼は服薬カレンダー')).toBe(
      '朝だけ別包 / 昼は服薬カレンダー',
    );
    expect(composePackagingDetail('朝だけ別包', '朝だけ別包')).toBe('朝だけ別包');
  });

  it('splits a stored detail into preset and custom parts', () => {
    expect(splitPackagingDetail('朝だけ別包 / 眠前薬は別袋')).toEqual({
      preset: '朝だけ別包',
      custom: '眠前薬は別袋',
    });
    expect(splitPackagingDetail('家族確認後に手渡し')).toEqual({
      preset: '家族確認後に手渡し',
      custom: '',
    });
  });

  it('keeps existing packaging tag option order and appends expanded work tags', () => {
    expect(PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => option.value)).toEqual([
      'cold_storage',
      'narcotic',
      'half_tablet',
      'crush_prohibited',
      'separate_pack',
      'unit_dose',
      'staple_required',
      'label_required',
      'ptp',
      'mixing',
      'excipient',
      'decapsulation',
      'no_unit_dose',
      'manual_ptp',
    ]);
  });

  it('extracts expanded packaging instruction tags from free text', () => {
    expect(
      extractPackagingInstructionTags({
        packagingInstructions:
          'PTPヒートのシート管理 / 混合 / 賦形 / 脱カプセル / 一包化しない / 手撒き',
      }),
    ).toEqual(['ptp', 'mixing', 'excipient', 'decapsulation', 'no_unit_dose', 'manual_ptp']);
  });

  it('does not infer unit_dose from explicit no-unit-dose instructions', () => {
    expect(
      extractPackagingInstructionTags({
        packagingInstructions: '別包 / 一包化しない / 分包しない / 一包化不可 / 分包不要',
      }),
    ).toEqual(['separate_pack', 'no_unit_dose']);
    expect(parsePackagingMethod('一包化不可')).toEqual({
      method: 'other',
      detail: '一包化不可',
    });
  });

  it('does not infer unit_dose from spaced or shorthand no-unit-dose instructions', () => {
    for (const text of ['一包化 しない', '一包化　しない', '一包化せず', '一包化中止']) {
      expect(extractPackagingInstructionTags({ packagingInstructions: text })).toEqual([
        'no_unit_dose',
      ]);
      expect(parsePackagingMethod(text)).toEqual({
        method: 'other',
        detail: text.replace(/\s+/g, ' ').trim(),
      });
    }

    expect(extractPackagingInstructionTags({ packagingInstructions: '分包せず' })).toEqual([
      'no_unit_dose',
    ]);
  });
});
