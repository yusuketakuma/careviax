import { addUtcDays } from '@/lib/utils/date-boundary';
import { deriveOutsideMedEvidenceKind } from '@/lib/dispensing/outside-med-classification';

export type MedicationDeadlineLine = {
  drug_name?: string | null;
  end_date?: Date | null;
  start_date?: Date | null;
  days?: number | null;
  dosage_form?: string | null;
  frequency?: string | null;
  route?: string | null;
  packaging_instruction_tags?: string[] | null;
  packaging_instructions?: string | null;
  notes?: string | null;
  unit?: string | null;
};

export type MedicationDeadlineIntake = {
  refill_next_dispense_date?: Date | null;
  split_next_dispense_date?: Date | null;
  lines: MedicationDeadlineLine[];
};

export type MedicationDeadlineOptions = {
  nextVisitSuggestionDate?: Date | null;
};

export type MedicationDeadlineSummary = {
  medicationEndDate: Date | null;
  nextDispenseDate: Date | null;
  nextVisitSuggestionDate: Date | null;
  visitDeadlineDate: Date | null;
};

const PRN_TEXT_PATTERN =
  /頓服|頓用|屯服|必要時|疼痛時|発熱時|不眠時|嘔気時|便秘時|発作時|頭痛時|症状時|PRN|prn|as needed|as-needed/i;

export function resolvePrescriptionLineMedicationEndDate(
  line: MedicationDeadlineLine,
): Date | null {
  if (line.end_date) return line.end_date;
  if (!line.start_date || line.days == null || line.days <= 0) return null;
  return addUtcDays(line.start_date, line.days - 1);
}

function earliestDate(values: Date[]): Date | null {
  return values.length > 0 ? new Date(Math.min(...values.map((value) => value.getTime()))) : null;
}

export function isPrescriptionLineAsNeeded(line: MedicationDeadlineLine): boolean {
  const classifiableLine = {
    drug_name: line.drug_name ?? '',
    dosage_form: line.dosage_form ?? null,
    frequency: line.frequency ?? '',
    route: line.route ?? null,
    packaging_instruction_tags: line.packaging_instruction_tags ?? [],
    packaging_instructions: line.packaging_instructions ?? null,
    notes: line.notes ?? null,
    unit: line.unit ?? null,
  };
  if (deriveOutsideMedEvidenceKind(classifiableLine) === 'prn') return true;

  const text = [
    classifiableLine.frequency,
    classifiableLine.packaging_instructions ?? '',
    classifiableLine.notes ?? '',
  ].join(' ');
  return PRN_TEXT_PATTERN.test(text);
}

export function collectMedicationEndDateCandidates(intakes: MedicationDeadlineIntake[]): Date[] {
  return intakes.flatMap((intake) =>
    intake.lines
      .filter((line) => !isPrescriptionLineAsNeeded(line))
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

export function resolveEarliestMedicationEndDate(
  intakes: MedicationDeadlineIntake[] | null | undefined,
): Date | null {
  const candidates = collectMedicationEndDateCandidates(intakes ?? []);
  return earliestDate(candidates);
}

export function resolveNextDispenseDate(
  intakes: MedicationDeadlineIntake[] | null | undefined,
): Date | null {
  const candidates = collectNextDispenseDateCandidates(intakes ?? []);
  return earliestDate(candidates);
}

export function resolveMedicationDeadlineSummary(
  intakes: MedicationDeadlineIntake[] | null | undefined,
  options: MedicationDeadlineOptions = {},
): MedicationDeadlineSummary {
  const medicationEndDate = resolveEarliestMedicationEndDate(intakes);
  const nextDispenseDate = resolveNextDispenseDate(intakes);
  const nextVisitSuggestionDate = options.nextVisitSuggestionDate ?? null;
  const deadlineCandidates = [
    ...(medicationEndDate ? [medicationEndDate] : []),
    ...(nextDispenseDate ? [nextDispenseDate] : []),
    ...(nextVisitSuggestionDate ? [nextVisitSuggestionDate] : []),
  ];
  return {
    medicationEndDate,
    nextDispenseDate,
    nextVisitSuggestionDate,
    visitDeadlineDate: earliestDate(deadlineCandidates),
  };
}
