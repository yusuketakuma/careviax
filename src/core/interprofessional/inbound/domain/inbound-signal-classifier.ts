import type { InboundCommunicationInput } from './inbound-communication';
import { classifyInboundSource, hasRawPhiPayloadKeys } from './inbound-communication';

export type InboundSignalDomain =
  | 'medication_stock'
  | 'medication_safety'
  | 'adherence'
  | 'symptom'
  | 'schedule'
  | 'report'
  | 'care_coordination'
  | 'urgent'
  | 'other';

export type InboundSignalType =
  | 'observed_quantity'
  | 'usage_delta'
  | 'usage_frequency'
  | 'low_stock_text'
  | 'out_of_stock_text'
  | 'refill_request'
  | 'side_effect_suspected'
  | 'medication_not_taken'
  | 'medication_overuse'
  | 'medication_lost'
  | 'storage_issue'
  | 'schedule_change_request'
  | 'visit_request'
  | 'urgent_review_required'
  | 'unknown';

export type SourceConfidence =
  | 'structured_exact'
  | 'structured_partial'
  | 'text_parsed_high'
  | 'text_parsed_low'
  | 'manual'
  | 'unknown';

export type InboundSignalCandidate = {
  readonly signalDomain: InboundSignalDomain;
  readonly signalType: InboundSignalType;
  readonly extractedQuantity?: number;
  readonly extractedUnit?: string;
  readonly quantityEffect?: 'observed_absolute' | 'decrease' | 'unknown';
  readonly sourceConfidence: SourceConfidence;
  readonly reviewStatus: 'needs_review';
  readonly actionStatus: 'not_linked';
  readonly evidenceCode:
    | 'remaining_quantity_expression'
    | 'usage_delta_expression'
    | 'low_stock_expression'
    | 'out_of_stock_expression'
    | 'refill_request_expression'
    | 'side_effect_expression'
    | 'schedule_expression'
    | 'visit_request_expression'
    | 'urgent_expression'
    | 'no_signal';
  readonly requiresPharmacistReview: true;
};

export type InboundSignalExtraction = {
  readonly action: 'signals_extracted' | 'no_signal' | 'reject_unsafe_payload';
  readonly signals: readonly InboundSignalCandidate[];
  readonly warnings: readonly string[];
};

export type InboundSignalReviewDecision = {
  readonly action: 'auto_apply' | 'proposed' | 'record_only' | 'reject';
  readonly reason:
    | 'auto_apply_conditions_met'
    | 'auto_apply_disabled'
    | 'quantity_or_unit_missing'
    | 'patient_or_case_not_linked'
    | 'unstructured_text_only'
    | 'unsafe_payload'
    | 'no_signal';
};

const OBSERVED_QUANTITY_PATTERN =
  /(?:残り|あと)\s*(\d+(?:\.\d+)?)\s*(枚|錠|包|本|個|回|mL|ml|ＭＬ|ｇ|g|日分)/iu;
const USAGE_DELTA_PATTERN =
  /(\d+(?:\.\d+)?)\s*(枚|錠|包|本|個|回|mL|ml|ＭＬ|ｇ|g)\s*(?:使|使用|貼|塗|飲)/iu;
const LOW_STOCK_PATTERN = /(少な|足りな|不足|補充|処方してほしい|処方希望)/u;
const REFILL_REQUEST_PATTERN = /(補充|処方してほしい|処方希望|追加でほしい|追加希望)/u;
const OUT_OF_STOCK_PATTERN =
  /(なくなりました|無くなりました|残っていません|在庫なし|ゼロ|0\s*(?:枚|錠|包|本|個|回))/u;
const SIDE_EFFECT_PATTERN = /(副作用|ふらつき|眠気|発疹|吐き気|気分不良|かゆみ|痒み)/u;
const SCHEDULE_PATTERN = /(日程|予定変更|都合|キャンセル|延期|前倒し)/u;
const VISIT_REQUEST_PATTERN = /(訪問して|来てほしい|来てください|早めに来|確認に来)/u;
const URGENT_PATTERN = /(至急|緊急|すぐ|今すぐ|急ぎ)/u;

function normalizeText(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function parseQuantity(match: RegExpMatchArray | null) {
  if (!match) return null;

  const quantity = Number.parseFloat(match[1] ?? '');
  const unit = match[2]?.normalize('NFKC');
  if (!Number.isFinite(quantity) || !unit) return null;

  return { quantity, unit };
}

function signal(
  input: Omit<InboundSignalCandidate, 'reviewStatus' | 'actionStatus' | 'requiresPharmacistReview'>,
) {
  return {
    ...input,
    reviewStatus: 'needs_review',
    actionStatus: 'not_linked',
    requiresPharmacistReview: true,
  } satisfies InboundSignalCandidate;
}

export function extractInboundCommunicationSignals(input: {
  readonly communication: InboundCommunicationInput;
  readonly unsafePayloadProbe?: Record<string, unknown>;
}): InboundSignalExtraction {
  if (input.unsafePayloadProbe && hasRawPhiPayloadKeys(input.unsafePayloadProbe)) {
    return {
      action: 'reject_unsafe_payload',
      signals: [],
      warnings: ['raw_phi_key_present'],
    };
  }

  const text = normalizeText(
    input.communication.rawText ?? input.communication.normalizedSummary ?? '',
  );
  const warnings: string[] = [];
  const signals: InboundSignalCandidate[] = [];
  const source = classifyInboundSource(input.communication);

  if (!input.communication.patientLinked) warnings.push('patient_not_linked');
  if (source.sourceGroup === 'unknown') warnings.push('unknown_source');

  const observedQuantity = parseQuantity(text.match(OBSERVED_QUANTITY_PATTERN));
  if (observedQuantity) {
    signals.push(
      signal({
        signalDomain: 'medication_stock',
        signalType: 'observed_quantity',
        extractedQuantity: observedQuantity.quantity,
        extractedUnit: observedQuantity.unit,
        quantityEffect: 'observed_absolute',
        sourceConfidence: 'text_parsed_high',
        evidenceCode: 'remaining_quantity_expression',
      }),
    );
  }

  const usageDelta = parseQuantity(text.match(USAGE_DELTA_PATTERN));
  if (usageDelta) {
    signals.push(
      signal({
        signalDomain: 'medication_stock',
        signalType: 'usage_delta',
        extractedQuantity: usageDelta.quantity,
        extractedUnit: usageDelta.unit,
        quantityEffect: 'decrease',
        sourceConfidence: 'text_parsed_high',
        evidenceCode: 'usage_delta_expression',
      }),
    );
  }

  if (OUT_OF_STOCK_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'medication_stock',
        signalType: 'out_of_stock_text',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'out_of_stock_expression',
      }),
    );
  } else if (LOW_STOCK_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'medication_stock',
        signalType: 'low_stock_text',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'low_stock_expression',
      }),
    );
  }

  if (REFILL_REQUEST_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'medication_stock',
        signalType: 'refill_request',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'refill_request_expression',
      }),
    );
  }

  if (SIDE_EFFECT_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'medication_safety',
        signalType: 'side_effect_suspected',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'side_effect_expression',
      }),
    );
  }

  if (SCHEDULE_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'schedule',
        signalType: 'schedule_change_request',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'schedule_expression',
      }),
    );
  }

  if (VISIT_REQUEST_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'schedule',
        signalType: 'visit_request',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'visit_request_expression',
      }),
    );
  }

  if (URGENT_PATTERN.test(text)) {
    signals.push(
      signal({
        signalDomain: 'urgent',
        signalType: 'urgent_review_required',
        sourceConfidence: 'text_parsed_low',
        evidenceCode: 'urgent_expression',
      }),
    );
  }

  if (signals.length === 0) {
    return {
      action: 'no_signal',
      signals: [],
      warnings: warnings.length > 0 ? warnings : ['no_signal'],
    };
  }

  return {
    action: 'signals_extracted',
    signals,
    warnings,
  };
}

export function decideInboundSignalReviewAction(input: {
  readonly signal?: InboundSignalCandidate | null;
  readonly patientLinked: boolean;
  readonly caseLinked?: boolean;
  readonly stockItemLinked?: boolean;
  readonly sourceTrusted?: boolean;
  readonly allowAutoApply?: boolean;
  readonly unsafePayload?: boolean;
}): InboundSignalReviewDecision {
  if (input.unsafePayload) return { action: 'reject', reason: 'unsafe_payload' };
  if (!input.signal) return { action: 'record_only', reason: 'no_signal' };
  if (!input.patientLinked || input.caseLinked === false) {
    return { action: 'proposed', reason: 'patient_or_case_not_linked' };
  }

  const isStructuredStockSignal =
    input.signal.signalDomain === 'medication_stock' &&
    (input.signal.signalType === 'observed_quantity' ||
      input.signal.signalType === 'usage_delta') &&
    input.signal.extractedQuantity != null &&
    input.signal.extractedUnit != null;

  if (!isStructuredStockSignal) return { action: 'record_only', reason: 'unstructured_text_only' };
  if (!input.stockItemLinked) return { action: 'proposed', reason: 'quantity_or_unit_missing' };
  if (!input.allowAutoApply || !input.sourceTrusted) {
    return { action: 'proposed', reason: 'auto_apply_disabled' };
  }

  return { action: 'auto_apply', reason: 'auto_apply_conditions_met' };
}

export function toPublicInboundSignalSummary(signal: InboundSignalCandidate) {
  return {
    signalDomain: signal.signalDomain,
    signalType: signal.signalType,
    hasQuantity: signal.extractedQuantity != null,
    unit: signal.extractedUnit,
    quantityEffect: signal.quantityEffect,
    sourceConfidence: signal.sourceConfidence,
    reviewStatus: signal.reviewStatus,
    actionStatus: signal.actionStatus,
    evidenceCode: signal.evidenceCode,
    requiresPharmacistReview: signal.requiresPharmacistReview,
  } as const;
}
