import { describe, expect, it } from 'vitest';
import {
  hasAsNeededPrescriptionText,
  isPrescriptionLineAsNeededByClinicalText,
  parseFrequencyToSlots,
} from './prescription-line-classification';

describe('parseFrequencyToSlots', () => {
  it('maps fixed daily frequencies to slots', () => {
    expect(parseFrequencyToSlots('毎食後')).toEqual(['morning', 'noon', 'evening']);
    expect(parseFrequencyToSlots('朝夕')).toEqual(['morning', 'evening']);
    expect(parseFrequencyToSlots('就寝前')).toEqual(['bedtime']);
  });

  it('maps as-needed frequencies to prn', () => {
    expect(parseFrequencyToSlots('疼痛時')).toEqual(['prn']);
    expect(parseFrequencyToSlots('必要時')).toEqual(['prn']);
  });
});

describe('isPrescriptionLineAsNeededByClinicalText', () => {
  it('detects PRN text across frequency and notes', () => {
    expect(isPrescriptionLineAsNeededByClinicalText({ frequency: '頓服' })).toBe(true);
    expect(isPrescriptionLineAsNeededByClinicalText({ notes: '疼痛時のみ使用' })).toBe(true);
    expect(hasAsNeededPrescriptionText({ drug_name: 'PRN rescue dose' })).toBe(true);
  });

  it('does not classify regular text as as-needed', () => {
    expect(
      isPrescriptionLineAsNeededByClinicalText({
        drug_name: 'アムロジピン錠5mg',
        frequency: '1日1回朝食後',
      }),
    ).toBe(false);
  });
});
