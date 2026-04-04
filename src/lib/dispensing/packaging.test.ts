import { describe, expect, it } from 'vitest';
import {
  buildPackagingInstructions,
  composePackagingDetail,
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
      })
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
      '朝だけ別包 / 昼は服薬カレンダー'
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
});
