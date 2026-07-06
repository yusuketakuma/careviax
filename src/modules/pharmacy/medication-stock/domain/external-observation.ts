import type { MedicationMatchInput } from './medication-equivalence';
import type { DateKey, StockQuantity } from './stockout-forecast';

export type ExternalStockObservationSourceType =
  | 'mcs'
  | 'communication_event'
  | 'partner_visit_record'
  | 'pharmacist_visit_record'
  | 'manual_pharmacist_review'
  | 'unknown';

export type ObserverProfessionalRole =
  | 'pharmacist'
  | 'physician'
  | 'nurse'
  | 'care_manager'
  | 'care_worker'
  | 'patient_or_family'
  | 'partner_staff'
  | 'unknown';

export type StockObservationKind =
  | 'remaining_quantity'
  | 'patient_held_stock'
  | 'prn_usage_report'
  | 'topical_remaining_report'
  | 'no_stock_observed'
  | 'unknown';

export type ExternalObservationSourceRef = {
  readonly sourceType: ExternalStockObservationSourceType;
  readonly sourceRecordId?: string;
  readonly occurredAtDateKey?: DateKey;
  readonly observedByRole?: ObserverProfessionalRole;
};

export type ExternalStockObservationInput = {
  readonly source: ExternalObservationSourceRef;
  readonly observationKind: StockObservationKind;
  readonly medication?: MedicationMatchInput | null;
  readonly observedQuantity?: StockQuantity | null;
};

export type ObservationSourceClassification = {
  readonly sourceGroup:
    | 'pharmacy_owned'
    | 'external_multi_professional'
    | 'patient_or_family_reported'
    | 'unknown';
  readonly requiresPharmacistReview: boolean;
  readonly directLedgerWriteAllowed: boolean;
};

export type PublicExternalStockObservationSummary = {
  readonly sourceType: ExternalStockObservationSourceType;
  readonly observedByRole?: ObserverProfessionalRole;
  readonly observationKind: StockObservationKind;
  readonly hasMedicationIdentity: boolean;
  readonly hasObservedQuantity: boolean;
  readonly occurredAtDateKey?: DateKey;
};

export type StagedExternalStockObservationDecision = {
  readonly action:
    | 'stage_for_pharmacist_review'
    | 'ignore_non_stock_observation'
    | 'reject_unsafe_payload';
  readonly sourceClassification: ObservationSourceClassification;
  readonly ledgerWritePolicy:
    | 'never_direct_from_external'
    | 'allowed_only_after_pharmacist_review'
    | 'not_applicable';
  readonly reviewPriority: 'low' | 'medium' | 'high';
  readonly publicSummary: PublicExternalStockObservationSummary;
  readonly warnings: readonly string[];
};

const DISALLOWED_PUBLIC_OBSERVATION_KEYS = new Set([
  'patientid',
  'patientname',
  'caseid',
  'rawtext',
  'messagebody',
  'freetext',
  'rawpayload',
  'content',
  'subject',
  'body',
  'note',
]);

function normalizeObjectKey(key: string) {
  return key
    .normalize('NFKC')
    .replace(/[_\-\s]+/g, '')
    .toLocaleLowerCase('en-US');
}

export function hasDisallowedRawPhiKeys(value: Record<string, unknown>): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, nestedValue] of Object.entries(current)) {
      if (DISALLOWED_PUBLIC_OBSERVATION_KEYS.has(normalizeObjectKey(key))) return true;
      if (nestedValue && typeof nestedValue === 'object') stack.push(nestedValue);
    }
  }
  return false;
}

export function classifyExternalObservationSource(
  source: ExternalObservationSourceRef,
): ObservationSourceClassification {
  switch (source.sourceType) {
    case 'mcs':
    case 'communication_event':
    case 'partner_visit_record':
      return {
        sourceGroup: 'external_multi_professional',
        requiresPharmacistReview: true,
        directLedgerWriteAllowed: false,
      };
    case 'pharmacist_visit_record':
    case 'manual_pharmacist_review':
      return {
        sourceGroup: 'pharmacy_owned',
        requiresPharmacistReview: true,
        directLedgerWriteAllowed: false,
      };
    case 'unknown':
      return {
        sourceGroup: 'unknown',
        requiresPharmacistReview: true,
        directLedgerWriteAllowed: false,
      };
  }
}

function hasMedicationIdentity(input: ExternalStockObservationInput) {
  const clinical = input.medication?.clinical;
  const medicationPackage = input.medication?.package;
  return Boolean(
    clinical?.drugMasterId ||
    clinical?.yjCode ||
    clinical?.hotCode ||
    clinical?.ingredientKey ||
    clinical?.genericNameKey ||
    clinical?.medicationNameKey ||
    medicationPackage?.gtin ||
    medicationPackage?.janCode,
  );
}

export function toPublicExternalStockObservationSummary(
  input: ExternalStockObservationInput,
): PublicExternalStockObservationSummary {
  return {
    sourceType: input.source.sourceType,
    observedByRole: input.source.observedByRole,
    observationKind: input.observationKind,
    hasMedicationIdentity: hasMedicationIdentity(input),
    hasObservedQuantity: input.observedQuantity != null,
    occurredAtDateKey: input.source.occurredAtDateKey,
  };
}

function resolveLedgerWritePolicy(
  classification: ObservationSourceClassification,
): StagedExternalStockObservationDecision['ledgerWritePolicy'] {
  if (classification.sourceGroup === 'external_multi_professional') {
    return 'never_direct_from_external';
  }
  if (classification.sourceGroup === 'pharmacy_owned') {
    return 'allowed_only_after_pharmacist_review';
  }
  return 'not_applicable';
}

function resolveReviewPriority(input: ExternalStockObservationInput) {
  if (input.observationKind === 'no_stock_observed') return 'high';
  if (input.observedQuantity?.value === 0) return 'high';
  if (input.observedQuantity || hasMedicationIdentity(input)) return 'medium';
  return 'low';
}

export function stageExternalStockObservationForReview(
  input: ExternalStockObservationInput,
): StagedExternalStockObservationDecision {
  const classification = classifyExternalObservationSource(input.source);
  const publicSummary = toPublicExternalStockObservationSummary(input);
  const warnings: string[] = [];

  if (hasDisallowedRawPhiKeys(input as unknown as Record<string, unknown>)) {
    return {
      action: 'reject_unsafe_payload',
      sourceClassification: classification,
      ledgerWritePolicy: 'not_applicable',
      reviewPriority: 'low',
      publicSummary,
      warnings: ['raw_phi_key_present'],
    };
  }

  if (
    input.observationKind === 'unknown' &&
    !publicSummary.hasMedicationIdentity &&
    !publicSummary.hasObservedQuantity
  ) {
    return {
      action: 'ignore_non_stock_observation',
      sourceClassification: classification,
      ledgerWritePolicy: 'not_applicable',
      reviewPriority: 'low',
      publicSummary,
      warnings: ['no_stock_signal'],
    };
  }

  if (classification.sourceGroup === 'unknown') warnings.push('unknown_source');

  return {
    action: 'stage_for_pharmacist_review',
    sourceClassification: classification,
    ledgerWritePolicy: resolveLedgerWritePolicy(classification),
    reviewPriority: resolveReviewPriority(input),
    publicSummary,
    warnings,
  };
}
