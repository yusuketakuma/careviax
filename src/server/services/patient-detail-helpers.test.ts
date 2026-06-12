import { describe, expect, it } from 'vitest';
import {
  buildAllergyLabel,
  buildCautionLabels,
  compactPreviewValues,
  sortHandlingTags,
} from './patient-detail-helpers';

describe('patient-detail-helpers', () => {
  it('compacts preview values without preserving blank strings', () => {
    expect(compactPreviewValues(['A', ' ', null, undefined, false, 'B'])).toEqual(['A', 'B']);
  });

  it('sorts handling tags by safety priority and removes duplicates', () => {
    expect(sortHandlingTags(['label_required', 'narcotic', 'unknown', 'narcotic'])).toEqual([
      'narcotic',
      'label_required',
      'unknown',
    ]);
  });

  it('builds allergy labels from valid JSON entries', () => {
    expect(
      buildAllergyLabel([
        { drug_name: 'セフェム系', reaction: '発疹', noted_year: 2019 },
        { drug_name: 'NSAIDs', confirmed_at: '2024-06-01T00:00:00.000Z' },
        { drug_name: '   ' },
        null,
      ]),
    ).toBe('セフェム系(発疹 2019)、NSAIDs(2024)');
    expect(buildAllergyLabel({ drug_name: 'セフェム系' })).toBeNull();
  });

  it('builds active problem caution labels with date and notes', () => {
    expect(
      buildCautionLabels([
        {
          condition_type: 'problem',
          name: 'ふらつき',
          is_active: true,
          noted_at: new Date('2026-06-05T00:00:00.000Z'),
          notes: '経過観察',
        },
        {
          condition_type: 'problem',
          name: '嚥下注意',
          is_active: true,
          noted_at: null,
          notes: 'とろみ',
        },
        {
          condition_type: 'history',
          name: '既往',
          is_active: true,
          noted_at: null,
          notes: null,
        },
      ]),
    ).toEqual(['ふらつき(6/5〜経過観察)', '嚥下注意(とろみ)']);
  });
});
