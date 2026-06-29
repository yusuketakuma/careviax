import { addUtcDays } from '@/lib/utils/date-boundary';

export type MedicationDeadlineLine = {
  end_date?: Date | null;
  start_date?: Date | null;
  days?: number | null;
};

export type MedicationDeadlineIntake = {
  refill_next_dispense_date?: Date | null;
  split_next_dispense_date?: Date | null;
  lines: MedicationDeadlineLine[];
};

export type MedicationDeadlineSummary = {
  medicationEndDate: Date | null;
  nextDispenseDate: Date | null;
  visitDeadlineDate: Date | null;
};

export function resolvePrescriptionLineMedicationEndDate(
  line: MedicationDeadlineLine,
): Date | null {
  if (line.end_date) return line.end_date;
  if (!line.start_date || line.days == null || line.days <= 0) return null;
  return addUtcDays(line.start_date, line.days - 1);
}

function latestDate(values: Date[]): Date | null {
  return values.length > 0 ? new Date(Math.max(...values.map((value) => value.getTime()))) : null;
}

function earliestDate(values: Date[]): Date | null {
  return values.length > 0 ? new Date(Math.min(...values.map((value) => value.getTime()))) : null;
}

export function collectMedicationEndDateCandidates(intakes: MedicationDeadlineIntake[]): Date[] {
  return intakes.flatMap((intake) =>
    intake.lines
      .map(resolvePrescriptionLineMedicationEndDate)
      .filter((value): value is Date => value != null),
  );
}

export function collectNextDispenseDateCandidates(intakes: MedicationDeadlineIntake[]): Date[] {
  return intakes.flatMap((intake) => [
    ...(intake.refill_next_dispense_date ? [intake.refill_next_dispense_date] : []),
    ...(intake.split_next_dispense_date ? [intake.split_next_dispense_date] : []),
  ]);
}

export function resolveLatestMedicationEndDate(
  intakes: MedicationDeadlineIntake[] | null | undefined,
): Date | null {
  const candidates = collectMedicationEndDateCandidates(intakes ?? []);
  return latestDate(candidates);
}

export function resolveNextDispenseDate(
  intakes: MedicationDeadlineIntake[] | null | undefined,
): Date | null {
  const candidates = collectNextDispenseDateCandidates(intakes ?? []);
  return earliestDate(candidates);
}

export function resolveMedicationDeadlineSummary(
  intakes: MedicationDeadlineIntake[] | null | undefined,
): MedicationDeadlineSummary {
  const medicationEndDate = resolveLatestMedicationEndDate(intakes);
  const nextDispenseDate = resolveNextDispenseDate(intakes);
  const deadlineCandidates = [
    ...(medicationEndDate ? [addUtcDays(medicationEndDate, -1)] : []),
    ...(nextDispenseDate ? [addUtcDays(nextDispenseDate, -1)] : []),
  ];
  return {
    medicationEndDate,
    nextDispenseDate,
    visitDeadlineDate: earliestDate(deadlineCandidates),
  };
}
