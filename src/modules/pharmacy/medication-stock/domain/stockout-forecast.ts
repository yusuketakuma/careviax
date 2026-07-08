import type { MatchConfidence } from './medication-equivalence';

export type DateKey = `${number}-${number}-${number}`;

export type StockQuantity = {
  readonly value: number;
  readonly unitKey: string;
};

export type StockHoldingContext =
  | 'patient_held'
  | 'caregiver_held'
  | 'facility_held'
  | 'pharmacy_site'
  | 'unknown';

export type MedicationUsePattern =
  | {
      readonly kind: 'scheduled';
      readonly dailyQuantity: StockQuantity;
    }
  | {
      readonly kind: 'prn';
      readonly typicalDailyQuantity?: StockQuantity;
      readonly maxDailyQuantity?: StockQuantity;
      readonly recentAverageDailyQuantity?: StockQuantity;
    }
  | {
      readonly kind: 'topical';
      readonly estimatedDailyQuantity?: StockQuantity;
      readonly estimationBasis?: 'measured_weight' | 'patient_report' | 'professional_estimate';
    }
  | {
      readonly kind: 'unknown';
    };

export type StockoutRisk =
  | 'already_out'
  | 'before_next_visit'
  | 'before_replenishment_horizon'
  | 'within_buffer'
  | 'sufficient_until_next_visit'
  | 'sufficient_until_replenishment_horizon'
  | 'unknown';

export type StockoutForecast =
  | {
      readonly kind: 'not_forecastable';
      readonly reason:
        | 'missing_quantity'
        | 'missing_usage_rate'
        | 'unit_mismatch'
        | 'invalid_quantity'
        | 'invalid_usage_rate';
      readonly risk: 'unknown';
      readonly requiresReview: true;
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: 'point_estimate';
      readonly daysRemaining: number;
      readonly projectedStockoutDateKey: DateKey;
      readonly risk: StockoutRisk;
      readonly confidence: Exclude<MatchConfidence, 'exact'>;
      readonly requiresReview: boolean;
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: 'range_estimate';
      readonly earliestDaysRemaining: number;
      readonly latestDaysRemaining: number;
      readonly earliestStockoutDateKey: DateKey;
      readonly latestStockoutDateKey: DateKey;
      readonly risk: StockoutRisk;
      readonly confidence: 'low' | 'medium';
      readonly requiresReview: boolean;
      readonly warnings: readonly string[];
    };

type NotForecastableReason = Extract<StockoutForecast, { kind: 'not_forecastable' }>['reason'];

const DAY_MS = 24 * 60 * 60 * 1000;

function sameUnit(left: StockQuantity, right: StockQuantity) {
  return left.unitKey.normalize('NFKC').trim() === right.unitKey.normalize('NFKC').trim();
}

function parseDateKey(dateKey: DateKey) {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, month - 1, day);
}

function addDays(dateKey: DateKey, days: number): DateKey {
  const date = new Date(parseDateKey(dateKey) + days * DAY_MS);
  return date.toISOString().slice(0, 10) as DateKey;
}

function daysBetween(left: DateKey, right: DateKey) {
  return Math.floor((parseDateKey(right) - parseDateKey(left)) / DAY_MS);
}

function notForecastable(
  reason: NotForecastableReason,
  warnings: readonly string[] = [],
): StockoutForecast {
  return {
    kind: 'not_forecastable',
    reason,
    risk: 'unknown',
    requiresReview: true,
    warnings,
  };
}

function calculateDaysRemaining(remainingQuantity: StockQuantity, dailyQuantity: StockQuantity) {
  if (!Number.isFinite(remainingQuantity.value)) return null;
  if (!Number.isFinite(dailyQuantity.value)) return null;
  if (remainingQuantity.value < 0) return null;
  if (dailyQuantity.value <= 0) return null;
  if (!sameUnit(remainingQuantity, dailyQuantity)) return 'unit_mismatch' as const;
  return Math.ceil(remainingQuantity.value / dailyQuantity.value);
}

export function classifyStockoutRisk(input: {
  readonly stockoutDateKey?: DateKey;
  readonly asOfDateKey: DateKey;
  readonly nextVisitDateKey?: DateKey;
  readonly confirmedReplenishmentDateKey?: DateKey;
  readonly bufferDays?: number;
}): StockoutRisk {
  if (!input.stockoutDateKey) return 'unknown';
  if (daysBetween(input.asOfDateKey, input.stockoutDateKey) <= 0) return 'already_out';
  if (
    input.confirmedReplenishmentDateKey &&
    daysBetween(input.asOfDateKey, input.confirmedReplenishmentDateKey) > 0
  ) {
    return input.stockoutDateKey <= input.confirmedReplenishmentDateKey
      ? 'before_replenishment_horizon'
      : 'sufficient_until_replenishment_horizon';
  }
  if (input.nextVisitDateKey && input.stockoutDateKey <= input.nextVisitDateKey) {
    return 'before_next_visit';
  }
  if (
    input.bufferDays != null &&
    daysBetween(input.asOfDateKey, input.stockoutDateKey) <= input.bufferDays
  ) {
    return 'within_buffer';
  }
  return 'sufficient_until_next_visit';
}

function buildPointEstimate(input: {
  readonly asOfDateKey: DateKey;
  readonly remainingQuantity: StockQuantity;
  readonly dailyQuantity: StockQuantity;
  readonly nextVisitDateKey?: DateKey;
  readonly confirmedReplenishmentDateKey?: DateKey;
  readonly bufferDays?: number;
  readonly confidence: Exclude<MatchConfidence, 'exact'>;
  readonly requiresReview: boolean;
  readonly warnings?: readonly string[];
}): StockoutForecast {
  const daysRemaining = calculateDaysRemaining(input.remainingQuantity, input.dailyQuantity);
  if (daysRemaining === 'unit_mismatch') {
    return notForecastable('unit_mismatch', ['unit_mismatch']);
  }
  if (daysRemaining == null) {
    return input.remainingQuantity.value < 0
      ? notForecastable('invalid_quantity')
      : notForecastable('invalid_usage_rate');
  }

  const projectedStockoutDateKey = addDays(input.asOfDateKey, daysRemaining);
  return {
    kind: 'point_estimate',
    daysRemaining,
    projectedStockoutDateKey,
    risk: classifyStockoutRisk({
      stockoutDateKey: projectedStockoutDateKey,
      asOfDateKey: input.asOfDateKey,
      nextVisitDateKey: input.nextVisitDateKey,
      confirmedReplenishmentDateKey: input.confirmedReplenishmentDateKey,
      bufferDays: input.bufferDays,
    }),
    confidence: input.confidence,
    requiresReview: input.requiresReview,
    warnings: input.warnings ?? [],
  };
}

export function forecastMedicationStockout(input: {
  readonly asOfDateKey: DateKey;
  readonly remainingQuantity?: StockQuantity | null;
  readonly usePattern: MedicationUsePattern;
  readonly holdingContext?: StockHoldingContext;
  readonly nextVisitDateKey?: DateKey;
  readonly confirmedReplenishmentDateKey?: DateKey;
  readonly bufferDays?: number;
}): StockoutForecast {
  if (!input.remainingQuantity) return notForecastable('missing_quantity');
  if (input.remainingQuantity.value < 0) return notForecastable('invalid_quantity');
  if (input.remainingQuantity.value === 0) {
    return {
      kind: 'point_estimate',
      daysRemaining: 0,
      projectedStockoutDateKey: input.asOfDateKey,
      risk: 'already_out',
      confidence: 'high',
      requiresReview: false,
      warnings: [],
    };
  }

  switch (input.usePattern.kind) {
    case 'scheduled':
      return buildPointEstimate({
        asOfDateKey: input.asOfDateKey,
        remainingQuantity: input.remainingQuantity,
        dailyQuantity: input.usePattern.dailyQuantity,
        nextVisitDateKey: input.nextVisitDateKey,
        confirmedReplenishmentDateKey: input.confirmedReplenishmentDateKey,
        bufferDays: input.bufferDays,
        confidence: 'high',
        requiresReview: false,
      });
    case 'prn': {
      const lowerUse =
        input.usePattern.typicalDailyQuantity ?? input.usePattern.recentAverageDailyQuantity;
      const higherUse =
        input.usePattern.maxDailyQuantity ?? input.usePattern.recentAverageDailyQuantity;
      if (!lowerUse && !higherUse) return notForecastable('missing_usage_rate');
      if (!lowerUse || !higherUse) {
        const singleUse = lowerUse ?? higherUse;
        if (!singleUse) return notForecastable('missing_usage_rate');
        return buildPointEstimate({
          asOfDateKey: input.asOfDateKey,
          remainingQuantity: input.remainingQuantity,
          dailyQuantity: singleUse,
          nextVisitDateKey: input.nextVisitDateKey,
          confirmedReplenishmentDateKey: input.confirmedReplenishmentDateKey,
          bufferDays: input.bufferDays,
          confidence: 'low',
          requiresReview: true,
          warnings: ['prn_single_usage_estimate'],
        });
      }

      const earliest = calculateDaysRemaining(input.remainingQuantity, higherUse);
      const latest = calculateDaysRemaining(input.remainingQuantity, lowerUse);
      if (earliest === 'unit_mismatch' || latest === 'unit_mismatch') {
        return notForecastable('unit_mismatch', ['unit_mismatch']);
      }
      if (earliest == null || latest == null) return notForecastable('invalid_usage_rate');
      const earliestStockoutDateKey = addDays(input.asOfDateKey, earliest);
      const latestStockoutDateKey = addDays(input.asOfDateKey, latest);
      return {
        kind: 'range_estimate',
        earliestDaysRemaining: earliest,
        latestDaysRemaining: latest,
        earliestStockoutDateKey,
        latestStockoutDateKey,
        risk: classifyStockoutRisk({
          stockoutDateKey: earliestStockoutDateKey,
          asOfDateKey: input.asOfDateKey,
          nextVisitDateKey: input.nextVisitDateKey,
          confirmedReplenishmentDateKey: input.confirmedReplenishmentDateKey,
          bufferDays: input.bufferDays,
        }),
        confidence: 'low',
        requiresReview: true,
        warnings: [],
      };
    }
    case 'topical':
      if (!input.usePattern.estimatedDailyQuantity) return notForecastable('missing_usage_rate');
      return buildPointEstimate({
        asOfDateKey: input.asOfDateKey,
        remainingQuantity: input.remainingQuantity,
        dailyQuantity: input.usePattern.estimatedDailyQuantity,
        nextVisitDateKey: input.nextVisitDateKey,
        confirmedReplenishmentDateKey: input.confirmedReplenishmentDateKey,
        bufferDays: input.bufferDays,
        confidence: input.usePattern.estimationBasis === 'measured_weight' ? 'medium' : 'low',
        requiresReview: true,
        warnings: ['topical_usage_estimate'],
      });
    case 'unknown':
      return notForecastable('missing_usage_rate');
  }
}
