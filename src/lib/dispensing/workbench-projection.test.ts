import { describe, expect, it } from 'vitest';
import {
  buildWorkbenchAllergyLabel,
  buildWorkbenchRenalLabel,
  detectDoseDirection,
} from './workbench-projection';

describe('workbench-projection', () => {
  it('buildWorkbenchAllergyLabel: 「なし」エントリは確認日つきで表示する', () => {
    expect(
      buildWorkbenchAllergyLabel([{ drug_name: 'なし', confirmed_at: '2026-06-01' }]),
    ).toBe('なし(確認済 6/1)');
  });

  it('buildWorkbenchAllergyLabel: 通常エントリは反応と年を併記する', () => {
    expect(
      buildWorkbenchAllergyLabel([
        { drug_name: 'セフェム系', reaction: '発疹', noted_year: 2019 },
      ]),
    ).toBe('セフェム系(発疹 2019)');
    expect(buildWorkbenchAllergyLabel([])).toBeNull();
    expect(buildWorkbenchAllergyLabel(null)).toBeNull();
  });

  it('buildWorkbenchRenalLabel: eGFR < 45 は「用量に注意」を付す', () => {
    expect(
      buildWorkbenchRenalLabel({
        value_numeric: 41,
        value_text: null,
        measured_at: new Date('2026-06-01'),
      }),
    ).toBe('eGFR 41 — 用量に注意');
    expect(
      buildWorkbenchRenalLabel({
        value_numeric: 62,
        value_text: null,
        measured_at: new Date('2026-06-01'),
      }),
    ).toBe('eGFR 62(6/1)');
    expect(buildWorkbenchRenalLabel(null)).toBeNull();
  });

  it('detectDoseDirection: 先頭数値の増減で減量/増量を判定する', () => {
    expect(detectDoseDirection('20mg 朝夕', '10mg 朝夕')).toBe('decrease');
    expect(detectDoseDirection('10mg', '20mg')).toBe('increase');
    expect(detectDoseDirection('10mg', '10mg')).toBeNull();
    expect(detectDoseDirection(null, '10mg')).toBeNull();
  });
});
