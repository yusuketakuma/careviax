import { describe, expect, it } from 'vitest';

import { resolveConfirmedPrescriptionReplenishmentHorizon } from './prescription-replenishment-horizon';

const baseIntake = {
  id: 'intake_1',
  source_type: 'paper',
  refill_next_dispense_date: null,
  split_dispense_total: null,
  split_dispense_current: null,
  split_next_dispense_date: null,
};

const prescriptionStockItem = {
  source_type: 'prescription',
};

describe('resolveConfirmedPrescriptionReplenishmentHorizon', () => {
  it('uses a strictly future refill next dispense date only for refill intakes', () => {
    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          source_type: 'refill',
          refill_next_dispense_date: new Date('2026-07-12T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toEqual({
      dateKey: '2026-07-12',
      source: 'prescription_refill_next_dispense',
      prescription_intake_id: 'intake_1',
    });

    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          source_type: 'paper',
          refill_next_dispense_date: new Date('2026-07-12T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('uses a split next dispense date only when split progress is incomplete', () => {
    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          split_dispense_total: 3,
          split_dispense_current: 2,
          split_next_dispense_date: new Date('2026-07-13T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toMatchObject({
      dateKey: '2026-07-13',
      source: 'prescription_split_next_dispense',
    });

    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          split_dispense_total: 3,
          split_dispense_current: 3,
          split_next_dispense_date: new Date('2026-07-13T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('selects the earliest future structured date and ignores past or same-day dates', () => {
    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          source_type: 'refill',
          refill_next_dispense_date: new Date('2026-07-08T00:00:00.000Z'),
          split_dispense_total: 3,
          split_dispense_current: 1,
          split_next_dispense_date: new Date('2026-07-10T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:30:00.000Z'),
      }),
    ).toMatchObject({
      dateKey: '2026-07-10',
      source: 'prescription_split_next_dispense',
    });

    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          source_type: 'refill',
          refill_next_dispense_date: new Date('2026-07-07T00:00:00.000Z'),
        },
        stockItem: prescriptionStockItem,
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('does not apply prescription intake horizons to non-prescription stock items', () => {
    expect(
      resolveConfirmedPrescriptionReplenishmentHorizon({
        intake: {
          ...baseIntake,
          source_type: 'refill',
          refill_next_dispense_date: new Date('2026-07-12T00:00:00.000Z'),
        },
        stockItem: { source_type: 'otc' },
        asOf: new Date('2026-07-08T00:00:00.000Z'),
      }),
    ).toBeNull();
  });
});
