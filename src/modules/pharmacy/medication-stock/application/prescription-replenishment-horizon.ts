import { japanDateKey } from '@/lib/utils/date-boundary';
import type { DateKey } from '../domain/stockout-forecast';

export type PrescriptionReplenishmentHorizonSource =
  | 'prescription_refill_next_dispense'
  | 'prescription_split_next_dispense';

export type ConfirmedPrescriptionReplenishmentHorizon = {
  readonly dateKey: DateKey;
  readonly source: PrescriptionReplenishmentHorizonSource;
  readonly prescription_intake_id: string;
};

export type PrescriptionReplenishmentHorizonIntake = {
  readonly id: string;
  readonly source_type: string;
  readonly refill_next_dispense_date: Date | null;
  readonly split_dispense_total: number | null;
  readonly split_dispense_current: number | null;
  readonly split_next_dispense_date: Date | null;
};

export type PrescriptionReplenishmentHorizonStockItem = {
  readonly source_type: string;
};

function toDateKey(value: Date): DateKey {
  return japanDateKey(value) as DateKey;
}

function isStrictlyFutureDateKey(dateKey: DateKey, asOfDateKey: DateKey) {
  return dateKey > asOfDateKey;
}

function hasActiveSplitDispenseHorizon(intake: PrescriptionReplenishmentHorizonIntake) {
  return (
    intake.split_dispense_total != null &&
    intake.split_dispense_current != null &&
    intake.split_dispense_total > 0 &&
    intake.split_dispense_current >= 0 &&
    intake.split_dispense_current < intake.split_dispense_total
  );
}

export function resolveConfirmedPrescriptionReplenishmentHorizon(args: {
  readonly intake: PrescriptionReplenishmentHorizonIntake;
  readonly stockItem: PrescriptionReplenishmentHorizonStockItem;
  readonly asOf: Date;
}): ConfirmedPrescriptionReplenishmentHorizon | null {
  if (args.stockItem.source_type !== 'prescription') return null;

  const asOfDateKey = toDateKey(args.asOf);
  const candidates: ConfirmedPrescriptionReplenishmentHorizon[] = [];

  if (args.intake.source_type === 'refill' && args.intake.refill_next_dispense_date) {
    const dateKey = toDateKey(args.intake.refill_next_dispense_date);
    if (isStrictlyFutureDateKey(dateKey, asOfDateKey)) {
      candidates.push({
        dateKey,
        source: 'prescription_refill_next_dispense',
        prescription_intake_id: args.intake.id,
      });
    }
  }

  if (hasActiveSplitDispenseHorizon(args.intake) && args.intake.split_next_dispense_date) {
    const dateKey = toDateKey(args.intake.split_next_dispense_date);
    if (isStrictlyFutureDateKey(dateKey, asOfDateKey)) {
      candidates.push({
        dateKey,
        source: 'prescription_split_next_dispense',
        prescription_intake_id: args.intake.id,
      });
    }
  }

  return (
    candidates.sort(
      (left, right) =>
        left.dateKey.localeCompare(right.dateKey) || left.source.localeCompare(right.source),
    )[0] ?? null
  );
}
