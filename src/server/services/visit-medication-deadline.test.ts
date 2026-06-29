import { describe, expect, it } from 'vitest';

import {
  isPrescriptionLineAsNeeded,
  resolveMedicationDeadlineSummary,
} from './visit-medication-deadline';

describe('resolveMedicationDeadlineSummary', () => {
  it('uses the earliest continuing non-PRN line end date inclusively', () => {
    const summary = resolveMedicationDeadlineSummary([
      {
        refill_next_dispense_date: null,
        split_next_dispense_date: null,
        lines: [
          {
            drug_name: '疼痛時薬',
            frequency: '疼痛時',
            end_date: new Date('2026-03-24T00:00:00.000Z'),
          },
          {
            drug_name: '継続薬A',
            frequency: '朝食後',
            end_date: new Date('2026-03-30T00:00:00.000Z'),
          },
          {
            drug_name: '継続薬B',
            frequency: '夕食後',
            start_date: new Date('2026-03-20T00:00:00.000Z'),
            days: 20,
          },
        ],
      },
    ]);

    expect(summary.medicationEndDate).toEqual(new Date('2026-03-30T00:00:00.000Z'));
    expect(summary.visitDeadlineDate).toEqual(new Date('2026-03-30T00:00:00.000Z'));
  });

  it('folds medication, next dispensing, and visit-record suggestion dates by minimum', () => {
    const summary = resolveMedicationDeadlineSummary(
      [
        {
          refill_next_dispense_date: new Date('2026-04-04T00:00:00.000Z'),
          split_next_dispense_date: new Date('2026-04-06T00:00:00.000Z'),
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
            },
          ],
        },
      ],
      {
        nextVisitSuggestionDate: new Date('2026-04-02T00:00:00.000Z'),
      },
    );

    expect(summary.medicationEndDate).toEqual(new Date('2026-04-08T00:00:00.000Z'));
    expect(summary.nextDispenseDate).toEqual(new Date('2026-04-04T00:00:00.000Z'));
    expect(summary.nextVisitSuggestionDate).toEqual(new Date('2026-04-02T00:00:00.000Z'));
    expect(summary.visitDeadlineDate).toEqual(new Date('2026-04-02T00:00:00.000Z'));
  });

  it('does not treat non-PRN topical continuing medication as as-needed', () => {
    expect(
      isPrescriptionLineAsNeeded({
        drug_name: '貼付剤',
        route: 'external',
        dosage_form: '貼付剤',
        frequency: '1日1回',
      }),
    ).toBe(false);
    expect(
      isPrescriptionLineAsNeeded({
        drug_name: '疼痛時外用薬',
        route: 'external',
        dosage_form: '軟膏',
        frequency: '必要時',
      }),
    ).toBe(true);
  });
});
