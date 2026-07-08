import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateDisplayIdMock } = vi.hoisted(() => ({
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  recalculateMedicationStockSnapshot,
  type MedicationStockSnapshotDb,
  type MedicationStockSnapshotItem,
} from './stock-snapshot';

function createDb(events: unknown[]) {
  return {
    medicationStockEvent: {
      findMany: vi.fn().mockResolvedValue(events),
    },
    medicationStockSnapshot: {
      upsert: vi.fn(async (args) => ({
        current_quantity: args.create.current_quantity,
        stock_risk_level: args.create.stock_risk_level,
        calculated_at: args.create.calculated_at,
      })),
    },
  };
}

function stockItem(
  overrides: Partial<MedicationStockSnapshotItem> = {},
): MedicationStockSnapshotItem {
  return {
    id: 'stock_item_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    unit: 'sheet',
    default_usage_amount_per_day: '1',
    medication_category: 'topical',
    ...overrides,
  };
}

function observedEvent(quantity: string) {
  return {
    id: 'stock_event_1',
    event_at: new Date('2026-07-08T01:30:00.000Z'),
    created_at: new Date('2026-07-08T01:30:05.000Z'),
    quantity_kind: 'observed_absolute',
    quantity_delta: null,
    observed_quantity: quantity,
    usage_quantity: null,
    usage_period_days: null,
    unit: 'sheet',
  };
}

describe('recalculateMedicationStockSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateDisplayIdMock.mockReset();
    allocateDisplayIdMock.mockResolvedValue('mss0000000001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses Asia/Tokyo civil date when forecasting around the UTC date boundary', async () => {
    const db = createDb([observedEvent('3')]);

    const snapshot = await recalculateMedicationStockSnapshot({
      db: db as unknown as MedicationStockSnapshotDb,
      orgId: 'org_1',
      stockItem: stockItem(),
      eventId: 'stock_event_1',
      asOf: new Date('2026-07-07T15:30:00.000Z'),
      nextVisitDateKey: '2026-07-10',
    });

    expect(snapshot.stock_risk_level).toBe('watch');
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          estimated_stockout_date: new Date('2026-07-11T00:00:00.000Z'),
          stock_risk_level: 'watch',
        }),
      }),
    );
  });

  it('classifies stockout before the next visit as shortage_expected', async () => {
    const db = createDb([observedEvent('3')]);

    const snapshot = await recalculateMedicationStockSnapshot({
      db: db as unknown as MedicationStockSnapshotDb,
      orgId: 'org_1',
      stockItem: stockItem(),
      eventId: 'stock_event_1',
      asOf: new Date('2026-07-07T15:30:00.000Z'),
      nextVisitDateKey: '2026-07-12',
    });

    expect(snapshot.stock_risk_level).toBe('shortage_expected');
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          estimated_stockout_date: new Date('2026-07-11T00:00:00.000Z'),
          stock_risk_level: 'shortage_expected',
        }),
      }),
    );
  });

  it('keeps the existing buffer-only classification when no next visit is provided', async () => {
    const db = createDb([observedEvent('10')]);

    const snapshot = await recalculateMedicationStockSnapshot({
      db: db as unknown as MedicationStockSnapshotDb,
      orgId: 'org_1',
      stockItem: stockItem(),
      eventId: 'stock_event_1',
      asOf: new Date('2026-07-07T15:30:00.000Z'),
    });

    expect(snapshot.stock_risk_level).toBe('ok');
  });
});
