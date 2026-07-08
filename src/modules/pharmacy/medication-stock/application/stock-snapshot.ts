import { Prisma } from '@prisma/client';

import { allocateDisplayId } from '@/lib/db/display-id';
import {
  forecastMedicationStockout,
  type DateKey,
  type MedicationUsePattern,
  type StockQuantity,
} from '../domain/stockout-forecast';

export type MedicationStockSnapshotDb = Pick<
  Prisma.TransactionClient,
  'medicationStockEvent' | 'medicationStockSnapshot'
>;

export type MedicationStockSnapshotItem = {
  id: string;
  patient_id: string;
  case_id: string | null;
  unit: string;
  default_usage_amount_per_day: Prisma.Decimal | number | string | null;
  medication_category: string;
};

type MedicationStockEventRow = {
  id: string;
  event_at: Date;
  created_at: Date;
  quantity_kind: string;
  quantity_delta: Prisma.Decimal | number | string | null;
  observed_quantity: Prisma.Decimal | number | string | null;
  usage_quantity: Prisma.Decimal | number | string | null;
  usage_period_days: number | null;
  unit: string;
};

const SNAPSHOT_VERSION = 'medication-stock-snapshot:v1';
const RISK_BUFFER_DAYS = 7;

export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateKeyJst(value: Date): DateKey {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}` as DateKey;
}

function dateKeyToDate(value: DateKey | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function usagePatternForStockItem(
  item: MedicationStockSnapshotItem,
  dailyUsageOverride?: number | null,
): MedicationUsePattern {
  const dailyQuantity =
    dailyUsageOverride != null
      ? dailyUsageOverride
      : decimalToNumber(item.default_usage_amount_per_day);
  if (dailyQuantity == null || dailyQuantity <= 0) return { kind: 'unknown' };

  const quantity: StockQuantity = {
    value: dailyQuantity,
    unitKey: item.unit,
  };

  if (item.medication_category === 'prn') {
    return { kind: 'prn', typicalDailyQuantity: quantity };
  }
  if (item.medication_category === 'topical' || item.medication_category === 'external') {
    return {
      kind: 'topical',
      estimatedDailyQuantity: quantity,
      estimationBasis: 'professional_estimate',
    };
  }
  return { kind: 'scheduled', dailyQuantity: quantity };
}

function mapForecastRisk(risk: ReturnType<typeof forecastMedicationStockout>['risk']) {
  switch (risk) {
    case 'already_out':
      return 'urgent';
    case 'before_next_visit':
      return 'shortage_expected';
    case 'within_buffer':
      return 'watch';
    case 'sufficient_until_next_visit':
      return 'ok';
    case 'unknown':
      return 'unknown';
  }
}

function foldStockEvents(events: MedicationStockEventRow[]) {
  let currentQuantity: number | null = null;
  let lastObservedQuantity: number | null = null;
  let lastObservedAt: Date | null = null;
  let lastEventId: string | null = null;
  let latestDailyUsage: number | null = null;

  for (const event of events) {
    lastEventId = event.id;
    const observed = decimalToNumber(event.observed_quantity);
    const delta = decimalToNumber(event.quantity_delta);
    const usageQuantity = decimalToNumber(event.usage_quantity);

    if (event.quantity_kind === 'observed_absolute' && observed != null) {
      currentQuantity = observed;
      lastObservedQuantity = observed;
      lastObservedAt = event.event_at;
      continue;
    }

    if (event.quantity_kind === 'delta' && currentQuantity != null && delta != null) {
      currentQuantity = Math.max(0, currentQuantity + delta);
      continue;
    }

    if (
      event.quantity_kind === 'usage_rate' &&
      usageQuantity != null &&
      event.usage_period_days != null &&
      event.usage_period_days > 0
    ) {
      latestDailyUsage = usageQuantity / event.usage_period_days;
    }
  }

  return {
    currentQuantity,
    lastObservedQuantity,
    lastObservedAt,
    lastEventId,
    latestDailyUsage,
  };
}

export async function recalculateMedicationStockSnapshot(args: {
  db: MedicationStockSnapshotDb;
  orgId: string;
  stockItem: MedicationStockSnapshotItem;
  eventId: string;
  asOf: Date;
  nextVisitDateKey?: DateKey | null;
}) {
  const events = (await args.db.medicationStockEvent.findMany({
    where: {
      org_id: args.orgId,
      stock_item_id: args.stockItem.id,
    },
    orderBy: [{ event_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      event_at: true,
      created_at: true,
      quantity_kind: true,
      quantity_delta: true,
      observed_quantity: true,
      usage_quantity: true,
      usage_period_days: true,
      unit: true,
    },
  })) as MedicationStockEventRow[];

  const folded = foldStockEvents(events);
  const remainingQuantity =
    folded.currentQuantity == null
      ? null
      : {
          value: folded.currentQuantity,
          unitKey: args.stockItem.unit,
        };
  const forecast = forecastMedicationStockout({
    asOfDateKey: toDateKeyJst(args.asOf),
    remainingQuantity,
    usePattern: usagePatternForStockItem(args.stockItem, folded.latestDailyUsage),
    nextVisitDateKey: args.nextVisitDateKey ?? undefined,
    bufferDays: RISK_BUFFER_DAYS,
  });
  const estimatedDailyUsage =
    folded.latestDailyUsage ?? decimalToNumber(args.stockItem.default_usage_amount_per_day);

  const daysUntilStockout =
    forecast.kind === 'point_estimate'
      ? forecast.daysRemaining
      : forecast.kind === 'range_estimate'
        ? forecast.earliestDaysRemaining
        : null;
  const estimatedStockoutDate =
    forecast.kind === 'point_estimate'
      ? dateKeyToDate(forecast.projectedStockoutDateKey)
      : forecast.kind === 'range_estimate'
        ? dateKeyToDate(forecast.earliestStockoutDateKey)
        : null;
  const snapshotDisplayId = await allocateDisplayId(
    args.db as Prisma.TransactionClient,
    'MedicationStockSnapshot',
    args.orgId,
  );

  const snapshot = await args.db.medicationStockSnapshot.upsert({
    where: {
      org_id_stock_item_id: {
        org_id: args.orgId,
        stock_item_id: args.stockItem.id,
      },
    },
    create: {
      org_id: args.orgId,
      display_id: snapshotDisplayId,
      stock_item_id: args.stockItem.id,
      patient_id: args.stockItem.patient_id,
      case_id: args.stockItem.case_id,
      current_quantity:
        folded.currentQuantity == null ? null : new Prisma.Decimal(folded.currentQuantity),
      unit: args.stockItem.unit as never,
      last_observed_quantity:
        folded.lastObservedQuantity == null
          ? null
          : new Prisma.Decimal(folded.lastObservedQuantity),
      last_observed_at: folded.lastObservedAt,
      last_event_id: folded.lastEventId ?? args.eventId,
      estimated_daily_usage:
        estimatedDailyUsage == null ? null : new Prisma.Decimal(estimatedDailyUsage),
      usage_confidence: estimatedDailyUsage == null ? 'unknown' : 'medium',
      estimated_stockout_date: estimatedStockoutDate,
      days_until_stockout: daysUntilStockout,
      stock_risk_level: mapForecastRisk(forecast.risk),
      risk_reason_code: forecast.kind === 'not_forecastable' ? `forecast_${forecast.reason}` : null,
      calculation_version: SNAPSHOT_VERSION,
      calculated_at: args.asOf,
    },
    update: {
      current_quantity:
        folded.currentQuantity == null ? null : new Prisma.Decimal(folded.currentQuantity),
      unit: args.stockItem.unit as never,
      last_observed_quantity:
        folded.lastObservedQuantity == null
          ? null
          : new Prisma.Decimal(folded.lastObservedQuantity),
      last_observed_at: folded.lastObservedAt,
      last_event_id: folded.lastEventId ?? args.eventId,
      estimated_daily_usage:
        estimatedDailyUsage == null ? null : new Prisma.Decimal(estimatedDailyUsage),
      usage_confidence: estimatedDailyUsage == null ? 'unknown' : 'medium',
      estimated_stockout_date: estimatedStockoutDate,
      days_until_stockout: daysUntilStockout,
      stock_risk_level: mapForecastRisk(forecast.risk),
      risk_reason_code: forecast.kind === 'not_forecastable' ? `forecast_${forecast.reason}` : null,
      calculation_version: SNAPSHOT_VERSION,
      calculated_at: args.asOf,
    },
    select: {
      current_quantity: true,
      stock_risk_level: true,
      calculated_at: true,
    },
  });

  return {
    current_quantity: decimalToNumber(snapshot.current_quantity),
    stock_risk_level: snapshot.stock_risk_level,
    calculated_at: snapshot.calculated_at.toISOString(),
  };
}
