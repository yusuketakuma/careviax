import { describe, expect, it } from 'vitest';
import { classifyStockoutRisk, forecastMedicationStockout } from './stockout-forecast';

describe('stockout forecast domain', () => {
  it('forecasts scheduled medication with a point estimate', () => {
    const forecast = forecastMedicationStockout({
      asOfDateKey: '2026-07-06',
      remainingQuantity: { value: 10, unitKey: 'tablet' },
      usePattern: { kind: 'scheduled', dailyQuantity: { value: 2, unitKey: 'tablet' } },
      nextVisitDateKey: '2026-07-12',
    });

    expect(forecast).toMatchObject({
      kind: 'point_estimate',
      daysRemaining: 5,
      projectedStockoutDateKey: '2026-07-11',
      risk: 'before_next_visit',
      confidence: 'high',
      requiresReview: false,
    });
  });

  it('classifies zero remaining stock as already out', () => {
    const forecast = forecastMedicationStockout({
      asOfDateKey: '2026-07-06',
      remainingQuantity: { value: 0, unitKey: 'sheet' },
      usePattern: { kind: 'prn' },
    });

    expect(forecast).toMatchObject({
      kind: 'point_estimate',
      daysRemaining: 0,
      risk: 'already_out',
    });
  });

  it('does not forecast when usage rate is missing or invalid', () => {
    expect(
      forecastMedicationStockout({
        asOfDateKey: '2026-07-06',
        remainingQuantity: { value: 10, unitKey: 'dose' },
        usePattern: { kind: 'prn' },
      }),
    ).toMatchObject({ kind: 'not_forecastable', reason: 'missing_usage_rate' });

    expect(
      forecastMedicationStockout({
        asOfDateKey: '2026-07-06',
        remainingQuantity: { value: 10, unitKey: 'tablet' },
        usePattern: { kind: 'scheduled', dailyQuantity: { value: 0, unitKey: 'tablet' } },
      }),
    ).toMatchObject({ kind: 'not_forecastable', reason: 'invalid_usage_rate' });
  });

  it('does not convert mismatched units implicitly', () => {
    const forecast = forecastMedicationStockout({
      asOfDateKey: '2026-07-06',
      remainingQuantity: { value: 10, unitKey: 'tablet' },
      usePattern: { kind: 'scheduled', dailyQuantity: { value: 1, unitKey: 'ml' } },
    });

    expect(forecast).toMatchObject({
      kind: 'not_forecastable',
      reason: 'unit_mismatch',
      warnings: ['unit_mismatch'],
    });
  });

  it('forecasts PRN medications as a review-required range when typical and max use are known', () => {
    const forecast = forecastMedicationStockout({
      asOfDateKey: '2026-07-06',
      remainingQuantity: { value: 12, unitKey: 'dose' },
      usePattern: {
        kind: 'prn',
        typicalDailyQuantity: { value: 1, unitKey: 'dose' },
        maxDailyQuantity: { value: 3, unitKey: 'dose' },
      },
      nextVisitDateKey: '2026-07-15',
    });

    expect(forecast).toMatchObject({
      kind: 'range_estimate',
      earliestDaysRemaining: 4,
      latestDaysRemaining: 12,
      earliestStockoutDateKey: '2026-07-10',
      latestStockoutDateKey: '2026-07-18',
      risk: 'before_next_visit',
      confidence: 'low',
      requiresReview: true,
    });
  });

  it('keeps topical estimates review-required and low confidence unless measured', () => {
    const forecast = forecastMedicationStockout({
      asOfDateKey: '2026-07-06',
      remainingQuantity: { value: 20, unitKey: 'g' },
      usePattern: {
        kind: 'topical',
        estimatedDailyQuantity: { value: 2, unitKey: 'g' },
        estimationBasis: 'patient_report',
      },
    });

    expect(forecast).toMatchObject({
      kind: 'point_estimate',
      projectedStockoutDateKey: '2026-07-16',
      confidence: 'low',
      requiresReview: true,
      warnings: ['topical_usage_estimate'],
    });
  });

  it('classifies buffer risk without relying on local timezone', () => {
    expect(
      classifyStockoutRisk({
        asOfDateKey: '2026-07-06',
        stockoutDateKey: '2026-07-08',
        bufferDays: 3,
      }),
    ).toBe('within_buffer');
  });

  it('classifies stockout on the next visit date as before_next_visit', () => {
    expect(
      classifyStockoutRisk({
        asOfDateKey: '2026-07-08',
        stockoutDateKey: '2026-07-12',
        nextVisitDateKey: '2026-07-12',
        bufferDays: 7,
      }),
    ).toBe('before_next_visit');
  });
});
