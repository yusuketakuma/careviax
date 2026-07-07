import { addUtcDays, japanDateKey } from '@/lib/utils/date-boundary';
import { isPrescriptionLineAsNeededByClinicalText } from '@/lib/clinical/prescription-line-classification';
import {
  addOperatingDays,
  nearestOperatingDay,
  shiftDateKey,
  type OperatingCalendar,
} from '@/lib/calendar/operating-day';

export type MedicationDeadlineLine = {
  id?: string | null;
  drug_master_id?: string | null;
  drug_code?: string | null;
  source_drug_code?: string | null;
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
  id?: string | null;
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

export type VisitDeadlineCandidateSourceKind =
  | 'regular_medication_end'
  | 'next_dispense'
  | 'next_visit_suggestion'
  | 'stockout_estimate'
  | 'manual_locked_date';

export type VisitDeadlineCandidateConfidence = 'high' | 'medium' | 'low';

export type VisitDeadlineCandidate = {
  source_kind: VisitDeadlineCandidateSourceKind;
  prescription_intake_id: string | null;
  prescription_line_id: string | null;
  drug_master_id: string | null;
  drug_code: string | null;
  source_drug_code: string | null;
  raw_date_key: string;
  adjusted_date_key: string;
  confidence: VisitDeadlineCandidateConfidence;
  requires_pharmacist_review: boolean;
  reason_code: string;
  audit_ref: string;
};

export type VisitDeadlineReviewReason = {
  code:
    | 'as_needed_excluded_from_regular_deadline'
    | 'drug_identity_unresolved'
    | 'external_route_review_required'
    | 'stockout_estimate_review_required'
    | 'manual_locked_date_review_required';
  source_kind: VisitDeadlineCandidateSourceKind | 'as_needed';
  audit_ref: string;
  severity: 'info' | 'review_required';
};

export type VisitDeadlineDiagnostic = {
  code:
    | 'deadline_raw'
    | 'deadline_adjusted_to_operating_day'
    | 'deadline_buffer_applied'
    | 'deadline_overdue_asap'
    | 'deadline_visitability_policy_missing'
    | 'deadline_buffer_scan_exhausted'
    | 'deadline_no_candidates';
  date_key?: string;
  from_date_key?: string;
  to_date_key?: string;
  value?: string | number | boolean;
};

export type VisitDeadlinePolicyInputCandidate = {
  date_key: string;
  source_kind: Extract<
    VisitDeadlineCandidateSourceKind,
    'stockout_estimate' | 'manual_locked_date'
  >;
  prescription_intake_id?: string | null;
  prescription_line_id?: string | null;
  drug_master_id?: string | null;
  drug_code?: string | null;
  source_drug_code?: string | null;
  confidence?: VisitDeadlineCandidateConfidence;
  reason_code?: string;
};

export type VisitDeadlinePolicyOptions = MedicationDeadlineOptions & {
  planningStartDateKey: string;
  operatingCalendar?: OperatingCalendar;
  isVisitableDate?: (dateKey: string) => boolean;
  safetyBufferOperatingDays?: number;
  stockoutCandidates?: VisitDeadlinePolicyInputCandidate[];
  manualLockedDateKey?: string | null;
  maxScanDays?: number;
};

export type VisitDeadlinePolicy = {
  rawDeadlineDateKey: string | null;
  latestVisitableDateKey: string | null;
  recommendedDeadlineDateKey: string | null;
  deadlineCandidates: VisitDeadlineCandidate[];
  diagnostics: VisitDeadlineDiagnostic[];
  reviewReasons: VisitDeadlineReviewReason[];
};

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
  return isPrescriptionLineAsNeededByClinicalText({
    drug_name: line.drug_name ?? '',
    dosage_form: line.dosage_form ?? null,
    frequency: line.frequency ?? '',
    route: line.route ?? null,
    packaging_instruction_tags: line.packaging_instruction_tags ?? [],
    packaging_instructions: line.packaging_instructions ?? null,
    notes: line.notes ?? null,
    unit: line.unit ?? null,
  });
}

function isExternalOrTopicalLine(line: MedicationDeadlineLine): boolean {
  const route = line.route?.toLowerCase() ?? '';
  const dosage = line.dosage_form ?? '';
  return (
    route === 'external' ||
    route === 'topical' ||
    /外用|貼付|軟膏|クリーム|点眼|点鼻|坐剤/.test(dosage)
  );
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

function buildAuditRef(
  sourceKind: VisitDeadlineCandidateSourceKind | 'as_needed',
  intakeId: string | null,
  lineId: string | null,
  dateKey?: string,
) {
  return [sourceKind, intakeId ?? 'intake_unknown', lineId ?? 'line_unknown', dateKey ?? 'no_date']
    .join(':')
    .replace(/\s+/g, '_');
}

function compareCandidateDate(left: VisitDeadlineCandidate, right: VisitDeadlineCandidate) {
  return left.raw_date_key.localeCompare(right.raw_date_key);
}

function hasMedicationIdentity(line: MedicationDeadlineLine) {
  return Boolean(line.drug_master_id || line.drug_code || line.source_drug_code);
}

function applyVisitablePolicy(args: {
  dateKey: string;
  operatingCalendar?: OperatingCalendar;
  isVisitableDate?: (dateKey: string) => boolean;
  direction: 'backward' | 'forward';
  maxScanDays: number;
}) {
  if (args.operatingCalendar) {
    return nearestOperatingDay(
      args.operatingCalendar,
      args.dateKey,
      args.direction,
      args.maxScanDays,
    );
  }
  if (!args.isVisitableDate) return args.dateKey;

  const step = args.direction === 'forward' ? 1 : -1;
  let cursor = args.dateKey;
  for (let scanned = 0; scanned <= args.maxScanDays; scanned += 1) {
    if (args.isVisitableDate(cursor)) return cursor;
    cursor = shiftDateKey(cursor, step);
  }
  return args.dateKey;
}

function addVisitableDays(args: {
  dateKey: string;
  days: number;
  operatingCalendar?: OperatingCalendar;
  isVisitableDate?: (dateKey: string) => boolean;
  maxScanDays: number;
}) {
  if (args.days === 0) return args.dateKey;
  if (args.operatingCalendar) {
    return addOperatingDays(args.operatingCalendar, args.dateKey, args.days, args.maxScanDays);
  }
  if (!args.isVisitableDate) return null;

  const step = args.days > 0 ? 1 : -1;
  let remaining = Math.abs(args.days);
  let cursor = args.dateKey;
  for (let scanned = 0; scanned < args.maxScanDays; scanned += 1) {
    cursor = shiftDateKey(cursor, step);
    if (args.isVisitableDate(cursor)) {
      remaining -= 1;
      if (remaining === 0) return cursor;
    }
  }
  return null;
}

function collectDeadlinePolicyMedicationCandidates(
  intakes: MedicationDeadlineIntake[],
  reviewReasons: VisitDeadlineReviewReason[],
) {
  const candidates: VisitDeadlineCandidate[] = [];
  for (const intake of intakes) {
    for (const line of intake.lines) {
      const intakeId = intake.id ?? null;
      const lineId = line.id ?? null;
      if (isPrescriptionLineAsNeeded(line)) {
        reviewReasons.push({
          code: 'as_needed_excluded_from_regular_deadline',
          source_kind: 'as_needed',
          audit_ref: buildAuditRef('as_needed', intakeId, lineId),
          severity: 'info',
        });
        continue;
      }

      const endDate = resolvePrescriptionLineMedicationEndDate(line);
      if (!endDate) continue;

      const rawDateKey = japanDateKey(endDate);
      const unresolvedIdentity = !hasMedicationIdentity(line);
      const externalOrTopical = isExternalOrTopicalLine(line);
      const requiresReview = unresolvedIdentity || externalOrTopical;
      const reasonCode = externalOrTopical
        ? 'external_route_review_required'
        : unresolvedIdentity
          ? 'drug_identity_unresolved'
          : 'regular_medication_end';
      const auditRef = buildAuditRef('regular_medication_end', intakeId, lineId, rawDateKey);

      if (unresolvedIdentity) {
        reviewReasons.push({
          code: 'drug_identity_unresolved',
          source_kind: 'regular_medication_end',
          audit_ref: auditRef,
          severity: 'review_required',
        });
      }
      if (externalOrTopical) {
        reviewReasons.push({
          code: 'external_route_review_required',
          source_kind: 'regular_medication_end',
          audit_ref: auditRef,
          severity: 'review_required',
        });
      }

      candidates.push({
        source_kind: 'regular_medication_end',
        prescription_intake_id: intakeId,
        prescription_line_id: lineId,
        drug_master_id: line.drug_master_id ?? null,
        drug_code: line.drug_code ?? null,
        source_drug_code: line.source_drug_code ?? null,
        raw_date_key: rawDateKey,
        adjusted_date_key: rawDateKey,
        confidence: requiresReview ? 'low' : 'high',
        requires_pharmacist_review: requiresReview,
        reason_code: reasonCode,
        audit_ref: auditRef,
      });
    }
  }
  return candidates;
}

function collectDeadlinePolicyDispenseCandidates(intakes: MedicationDeadlineIntake[]) {
  const candidates: VisitDeadlineCandidate[] = [];
  for (const intake of intakes) {
    for (const date of [intake.refill_next_dispense_date, intake.split_next_dispense_date]) {
      if (!date) continue;
      const rawDateKey = japanDateKey(date);
      candidates.push({
        source_kind: 'next_dispense',
        prescription_intake_id: intake.id ?? null,
        prescription_line_id: null,
        drug_master_id: null,
        drug_code: null,
        source_drug_code: null,
        raw_date_key: rawDateKey,
        adjusted_date_key: rawDateKey,
        confidence: 'medium',
        requires_pharmacist_review: false,
        reason_code: 'next_dispense',
        audit_ref: buildAuditRef('next_dispense', intake.id ?? null, null, rawDateKey),
      });
    }
  }
  return candidates;
}

function buildInputPolicyCandidate(
  input: VisitDeadlinePolicyInputCandidate,
  reviewReasons: VisitDeadlineReviewReason[],
): VisitDeadlineCandidate {
  const requiresReview = true;
  const reasonCode =
    input.reason_code ??
    (input.source_kind === 'stockout_estimate'
      ? 'stockout_estimate_review_required'
      : 'manual_locked_date_review_required');
  const auditRef = buildAuditRef(
    input.source_kind,
    input.prescription_intake_id ?? null,
    input.prescription_line_id ?? null,
    input.date_key,
  );
  reviewReasons.push({
    code:
      input.source_kind === 'stockout_estimate'
        ? 'stockout_estimate_review_required'
        : 'manual_locked_date_review_required',
    source_kind: input.source_kind,
    audit_ref: auditRef,
    severity: 'review_required',
  });
  return {
    source_kind: input.source_kind,
    prescription_intake_id: input.prescription_intake_id ?? null,
    prescription_line_id: input.prescription_line_id ?? null,
    drug_master_id: input.drug_master_id ?? null,
    drug_code: input.drug_code ?? null,
    source_drug_code: input.source_drug_code ?? null,
    raw_date_key: input.date_key,
    adjusted_date_key: input.date_key,
    confidence: input.confidence ?? 'low',
    requires_pharmacist_review: requiresReview,
    reason_code: reasonCode,
    audit_ref: auditRef,
  };
}

export function resolveVisitDeadlinePolicy(
  intakes: MedicationDeadlineIntake[] | null | undefined,
  options: VisitDeadlinePolicyOptions,
): VisitDeadlinePolicy {
  // Validate the caller-provided dateKey at the boundary.
  shiftDateKey(options.planningStartDateKey, 0);

  const diagnostics: VisitDeadlineDiagnostic[] = [];
  const reviewReasons: VisitDeadlineReviewReason[] = [];
  const sourceIntakes = intakes ?? [];
  const candidates = [
    ...collectDeadlinePolicyMedicationCandidates(sourceIntakes, reviewReasons),
    ...collectDeadlinePolicyDispenseCandidates(sourceIntakes),
  ];

  if (options.nextVisitSuggestionDate) {
    const rawDateKey = japanDateKey(options.nextVisitSuggestionDate);
    candidates.push({
      source_kind: 'next_visit_suggestion',
      prescription_intake_id: null,
      prescription_line_id: null,
      drug_master_id: null,
      drug_code: null,
      source_drug_code: null,
      raw_date_key: rawDateKey,
      adjusted_date_key: rawDateKey,
      confidence: 'medium',
      requires_pharmacist_review: false,
      reason_code: 'next_visit_suggestion',
      audit_ref: buildAuditRef('next_visit_suggestion', null, null, rawDateKey),
    });
  }

  for (const input of options.stockoutCandidates ?? []) {
    candidates.push(buildInputPolicyCandidate(input, reviewReasons));
  }
  if (options.manualLockedDateKey) {
    candidates.push(
      buildInputPolicyCandidate(
        {
          date_key: options.manualLockedDateKey,
          source_kind: 'manual_locked_date',
          reason_code: 'manual_locked_date_review_required',
        },
        reviewReasons,
      ),
    );
  }

  if (candidates.length === 0) {
    diagnostics.push({ code: 'deadline_no_candidates' });
    return {
      rawDeadlineDateKey: null,
      latestVisitableDateKey: null,
      recommendedDeadlineDateKey: null,
      deadlineCandidates: [],
      diagnostics,
      reviewReasons,
    };
  }

  const rawDeadlineDateKey = [...candidates].sort(compareCandidateDate)[0]!.raw_date_key;
  diagnostics.push({ code: 'deadline_raw', date_key: rawDeadlineDateKey });

  const hasVisitabilityPolicy = Boolean(options.operatingCalendar || options.isVisitableDate);
  if (!hasVisitabilityPolicy) {
    diagnostics.push({
      code: 'deadline_visitability_policy_missing',
      date_key: rawDeadlineDateKey,
    });
  }

  const maxScanDays = options.maxScanDays ?? 366 * 2;
  const latestVisitableDateKey = hasVisitabilityPolicy
    ? applyVisitablePolicy({
        dateKey: rawDeadlineDateKey,
        operatingCalendar: options.operatingCalendar,
        isVisitableDate: options.isVisitableDate,
        direction: 'backward',
        maxScanDays,
      })
    : rawDeadlineDateKey;

  if (latestVisitableDateKey !== rawDeadlineDateKey) {
    diagnostics.push({
      code: 'deadline_adjusted_to_operating_day',
      from_date_key: rawDeadlineDateKey,
      to_date_key: latestVisitableDateKey,
    });
  }

  const safetyBufferOperatingDays = Math.max(0, options.safetyBufferOperatingDays ?? 0);
  let recommendedDeadlineDateKey = latestVisitableDateKey;
  if (safetyBufferOperatingDays > 0) {
    const buffered = hasVisitabilityPolicy
      ? addVisitableDays({
          dateKey: latestVisitableDateKey,
          days: -safetyBufferOperatingDays,
          operatingCalendar: options.operatingCalendar,
          isVisitableDate: options.isVisitableDate,
          maxScanDays,
        })
      : null;
    if (buffered) {
      recommendedDeadlineDateKey = buffered;
      diagnostics.push({
        code: 'deadline_buffer_applied',
        from_date_key: latestVisitableDateKey,
        to_date_key: recommendedDeadlineDateKey,
        value: safetyBufferOperatingDays,
      });
    } else {
      diagnostics.push({
        code: 'deadline_buffer_scan_exhausted',
        date_key: latestVisitableDateKey,
        value: safetyBufferOperatingDays,
      });
    }
  }

  if (recommendedDeadlineDateKey < options.planningStartDateKey) {
    diagnostics.push({
      code: 'deadline_overdue_asap',
      from_date_key: recommendedDeadlineDateKey,
      to_date_key: options.planningStartDateKey,
    });
    recommendedDeadlineDateKey = options.planningStartDateKey;
  }

  return {
    rawDeadlineDateKey,
    latestVisitableDateKey,
    recommendedDeadlineDateKey,
    deadlineCandidates: candidates.map((candidate) => ({
      ...candidate,
      adjusted_date_key:
        candidate.raw_date_key === rawDeadlineDateKey
          ? latestVisitableDateKey
          : candidate.raw_date_key,
    })),
    diagnostics,
    reviewReasons,
  };
}
