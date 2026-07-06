import type { InboundCommunicationInput } from '@/core/interprofessional/inbound/domain/inbound-communication';
import type { InboundSignalCandidate } from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';

import type {
  ExternalObservationSourceRef,
  ExternalStockObservationInput,
  ExternalStockObservationSourceType,
  ObserverProfessionalRole,
  StagedExternalStockObservationDecision,
  StockObservationKind,
} from '../domain/external-observation';
import {
  hasDisallowedRawPhiKeys,
  stageExternalStockObservationForReview,
} from '../domain/external-observation';
import type { MedicationMatchInput } from '../domain/medication-equivalence';

export type InboundMedicationStockSignalAdapterInput = {
  readonly communication: Pick<
    InboundCommunicationInput,
    'sourceChannel' | 'senderRole' | 'occurredAtDateKey'
  >;
  readonly signal: InboundSignalCandidate;
  readonly sourceRecordId?: string;
  readonly medication?: MedicationMatchInput | null;
  readonly unsafePayloadProbe?: Record<string, unknown>;
};

export type InboundMedicationStockSignalStagingResult =
  | {
      readonly action: 'stage_for_pharmacist_review';
      readonly observation: ExternalStockObservationInput;
      readonly decision: StagedExternalStockObservationDecision;
      readonly warnings: readonly string[];
    }
  | {
      readonly action: 'ignore_non_stock_signal';
      readonly reason: 'not_medication_stock' | 'unsupported_stock_signal';
      readonly warnings: readonly string[];
    }
  | {
      readonly action: 'reject_unsafe_payload';
      readonly reason: 'raw_phi_key_present';
      readonly warnings: readonly string[];
    };

const INBOUND_ROLE_TO_OBSERVER_ROLE: Partial<
  Record<NonNullable<InboundCommunicationInput['senderRole']>, ObserverProfessionalRole>
> = {
  nurse: 'nurse',
  care_manager: 'care_manager',
  physician: 'physician',
  facility_staff: 'care_worker',
  family: 'patient_or_family',
  patient: 'patient_or_family',
  pharmacist: 'pharmacist',
};

export function mapInboundCommunicationToExternalStockSource(
  input: Pick<InboundCommunicationInput, 'sourceChannel' | 'senderRole' | 'occurredAtDateKey'> & {
    readonly sourceRecordId?: string;
  },
): ExternalObservationSourceRef {
  return {
    sourceType: mapInboundSourceChannel(input.sourceChannel, input.senderRole),
    sourceRecordId: input.sourceRecordId,
    occurredAtDateKey: input.occurredAtDateKey,
    observedByRole: input.senderRole
      ? (INBOUND_ROLE_TO_OBSERVER_ROLE[input.senderRole] ?? 'unknown')
      : undefined,
  };
}

function mapInboundSourceChannel(
  sourceChannel: InboundCommunicationInput['sourceChannel'],
  senderRole: InboundCommunicationInput['senderRole'],
): ExternalStockObservationSourceType {
  if (sourceChannel === 'patient_family' || senderRole === 'family' || senderRole === 'patient') {
    return 'patient_or_family_report';
  }
  if (sourceChannel === 'mcs') return 'mcs';
  if (sourceChannel === 'manual' || senderRole === 'pharmacist') return 'manual_pharmacist_review';
  if (sourceChannel === 'unknown') return 'unknown';
  return 'communication_event';
}

function mapSignalToObservationKind(signal: InboundSignalCandidate): StockObservationKind | null {
  if (signal.signalDomain !== 'medication_stock') return null;

  switch (signal.signalType) {
    case 'observed_quantity':
      return 'remaining_quantity';
    case 'usage_delta':
      return 'prn_usage_report';
    case 'low_stock_text':
    case 'refill_request':
      return 'patient_held_stock';
    case 'out_of_stock_text':
      return 'no_stock_observed';
    default:
      return null;
  }
}

function buildObservedQuantity(signal: InboundSignalCandidate) {
  if (signal.quantityEffect !== 'observed_absolute') return null;
  if (signal.extractedQuantity == null || !signal.extractedUnit) return null;
  if (!Number.isFinite(signal.extractedQuantity)) return null;

  return {
    value: signal.extractedQuantity,
    unitKey: signal.extractedUnit.normalize('NFKC').trim(),
  };
}

function buildUsageQuantity(signal: InboundSignalCandidate) {
  if (signal.quantityEffect !== 'decrease') return null;
  if (signal.extractedQuantity == null || !signal.extractedUnit) return null;
  if (!Number.isFinite(signal.extractedQuantity)) return null;

  return {
    value: signal.extractedQuantity,
    unitKey: signal.extractedUnit.normalize('NFKC').trim(),
  };
}

function normalizeKeyPart(value: string | number | null | undefined) {
  const normalized = String(value ?? 'none')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9._:-]+/g, '_');
  return normalized || 'none';
}

export function buildInboundMedicationStockSignalStagingKey(
  input: Pick<
    InboundMedicationStockSignalAdapterInput,
    'communication' | 'signal' | 'sourceRecordId'
  >,
) {
  const source = mapInboundCommunicationToExternalStockSource({
    ...input.communication,
    sourceRecordId: input.sourceRecordId,
  });
  const observationKind = mapSignalToObservationKind(input.signal) ?? 'ignored';
  const quantity = buildObservedQuantity(input.signal) ?? buildUsageQuantity(input.signal);

  return [
    'inbound-medication-stock-signal',
    normalizeKeyPart(source.sourceType),
    normalizeKeyPart(source.sourceRecordId),
    normalizeKeyPart(source.occurredAtDateKey),
    normalizeKeyPart(input.signal.signalDomain),
    normalizeKeyPart(input.signal.signalType),
    normalizeKeyPart(observationKind),
    normalizeKeyPart(quantity?.value),
    normalizeKeyPart(quantity?.unitKey),
  ].join(':');
}

function buildMedicationIdentityWarnings(medication: MedicationMatchInput | null | undefined) {
  const warnings: string[] = [];
  if (!medication) return ['medication_identity_missing'];

  const clinical = medication.clinical;
  const hasExactClinicalCode = Boolean(clinical.drugMasterId || clinical.yjCode);
  const hasHighClinicalCode = hasExactClinicalCode || Boolean(clinical.hotCode);
  const hasOnlyName =
    !hasHighClinicalCode &&
    Boolean(clinical.medicationNameKey || clinical.genericNameKey || clinical.ingredientKey);
  const hasPackageIdentity = Boolean(medication.package?.gtin || medication.package?.janCode);

  if (!hasExactClinicalCode) warnings.push('medication_equivalence_review_required');
  if (hasOnlyName) warnings.push('medication_name_only_identity');
  if (hasPackageIdentity && !hasHighClinicalCode)
    warnings.push('package_identity_without_clinical_code');

  return warnings;
}

export function stageInboundMedicationStockSignalForReview(
  input: InboundMedicationStockSignalAdapterInput,
): InboundMedicationStockSignalStagingResult {
  if (input.unsafePayloadProbe && hasDisallowedRawPhiKeys(input.unsafePayloadProbe)) {
    return {
      action: 'reject_unsafe_payload',
      reason: 'raw_phi_key_present',
      warnings: ['raw_phi_key_present'],
    };
  }

  const observationKind = mapSignalToObservationKind(input.signal);
  if (!observationKind) {
    return {
      action: 'ignore_non_stock_signal',
      reason:
        input.signal.signalDomain === 'medication_stock'
          ? 'unsupported_stock_signal'
          : 'not_medication_stock',
      warnings: [`ignored_signal:${input.signal.signalDomain}:${input.signal.signalType}`],
    };
  }

  const observation: ExternalStockObservationInput = {
    source: mapInboundCommunicationToExternalStockSource({
      ...input.communication,
      sourceRecordId: input.sourceRecordId,
    }),
    observationKind,
    medication: input.medication ?? null,
    observedQuantity: buildObservedQuantity(input.signal),
    usageQuantity: buildUsageQuantity(input.signal),
  };
  const decision = stageExternalStockObservationForReview(observation);
  if (decision.action === 'reject_unsafe_payload') {
    return {
      action: 'reject_unsafe_payload',
      reason: 'raw_phi_key_present',
      warnings: decision.warnings,
    };
  }
  const warnings = [...decision.warnings, ...buildMedicationIdentityWarnings(input.medication)];

  return {
    action: 'stage_for_pharmacist_review',
    observation,
    decision,
    warnings,
  };
}
