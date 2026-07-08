import { createHash } from 'node:crypto';

import { createRiskFinding, type RiskFinding, type RiskSeverity } from '@/lib/risk/risk-finding';

import type { InboundMedicationStockSignalStagingResult } from './medication-stock-signal-adapter';

export type MedicationStockStagingRiskContext = {
  readonly patientId?: string | null;
  readonly caseId?: string | null;
  readonly dueAt?: string | null;
};

export type MedicationStockSnapshotRiskInput = {
  readonly id: string;
  readonly stock_item_id: string;
  readonly patient_id: string;
  readonly case_id: string | null;
  readonly stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
  readonly estimated_stockout_date: Date | null;
  readonly days_until_stockout: number | null;
  readonly calculated_at: Date;
};

export type MedicationStockSnapshotRiskContext = {
  readonly patientId?: string | null;
  readonly caseId?: string | null;
  readonly patientHref?: string | null;
};

type MedicationStockRiskDescriptor = {
  readonly code:
    | 'medication_stock_external_observation_review_required'
    | 'medication_stock_urgent_shortage'
    | 'medication_stock_usage_report_review_required'
    | 'medication_stock_equivalence_review_required';
  readonly severity: RiskSeverity;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
};

const IDENTITY_WARNING_KEYS = new Set([
  'medication_identity_missing',
  'medication_equivalence_review_required',
  'medication_name_only_identity',
  'package_identity_without_clinical_code',
]);

export function adaptMedicationStockSnapshotToRiskFinding(
  snapshot: MedicationStockSnapshotRiskInput,
  context: MedicationStockSnapshotRiskContext = {},
): RiskFinding | null {
  if (snapshot.stock_risk_level !== 'urgent' && snapshot.stock_risk_level !== 'shortage_expected') {
    return null;
  }

  const patientId = context.patientId ?? snapshot.patient_id;
  const caseId = context.caseId ?? snapshot.case_id;

  return createRiskFinding({
    key: `medication_stock:medication_stock_urgent_shortage:stock_item:${snapshot.stock_item_id}`,
    domain: 'medication',
    severity: snapshot.stock_risk_level === 'urgent' ? 'urgent' : 'warning',
    title: '外用・頓服の不足リスクがあります',
    detail:
      '残数台帳で外用薬・頓服薬の不足または不足見込みが検出されています。薬剤師が確認し、必要なら補充・連絡・次アクションへ反映してください。',
    patient_id: patientId ?? null,
    case_id: caseId ?? null,
    related_entity_type: 'medication_stock_item',
    related_entity_id: snapshot.stock_item_id,
    due_at: snapshot.estimated_stockout_date?.toISOString() ?? null,
    action_href: buildMedicationStockReviewHref({
      patientId,
      patientHref: context.patientHref,
    }),
    action_label: '残数台帳を確認',
    source: 'computed',
  });
}

export function adaptInboundMedicationStockStagingToRiskFindings(
  result: InboundMedicationStockSignalStagingResult,
  context: MedicationStockStagingRiskContext = {},
): RiskFinding[] {
  if (result.action !== 'stage_for_pharmacist_review') return [];

  const descriptors = [buildPrimaryDescriptor(result)];
  if (result.warnings.some((warning) => IDENTITY_WARNING_KEYS.has(warning))) {
    descriptors.push(buildMedicationIdentityDescriptor());
  }

  const suffix = buildRiskKeySuffix(result);
  const actionHref = buildMedicationStockReviewHref(context);

  return descriptors.map((descriptor) =>
    createRiskFinding({
      key: `medication_stock:${descriptor.code}:${suffix}`,
      domain: 'medication',
      severity: descriptor.severity,
      title: descriptor.title,
      detail: descriptor.detail,
      patient_id: context.patientId ?? null,
      case_id: context.caseId ?? null,
      related_entity_type: 'inbound_medication_stock_signal',
      related_entity_id: null,
      due_at: context.dueAt ?? null,
      action_href: actionHref,
      action_label: descriptor.actionLabel,
      source:
        result.decision.sourceClassification.sourceGroup === 'pharmacy_owned'
          ? 'manual'
          : 'external',
    }),
  );
}

function buildPrimaryDescriptor(
  result: Extract<
    InboundMedicationStockSignalStagingResult,
    { action: 'stage_for_pharmacist_review' }
  >,
): MedicationStockRiskDescriptor {
  const observationKind = result.observation.observationKind;
  const sourceLabel = sourceGroupLabel(result.decision.sourceClassification.sourceGroup);

  if (observationKind === 'no_stock_observed') {
    return {
      code: 'medication_stock_urgent_shortage',
      severity: 'urgent',
      title: '外用・頓服の不足報告があります',
      detail: `${sourceLabel}、外用薬・頓服薬の不足に関する報告があります。薬剤師が確認し、必要なら残数台帳と次アクションへ反映してください。`,
      actionLabel: '不足報告を確認',
    };
  }

  if (
    result.decision.reviewPriority === 'high' ||
    result.observation.observedQuantity?.value === 0
  ) {
    return {
      code: 'medication_stock_urgent_shortage',
      severity: 'urgent',
      title: '外用・頓服の不足報告があります',
      detail: `${sourceLabel}、外用薬・頓服薬が不足している可能性の高い報告があります。薬剤師が確認し、必要なら残数台帳と次アクションへ反映してください。`,
      actionLabel: '不足報告を確認',
    };
  }

  if (observationKind === 'prn_usage_report') {
    return {
      code: 'medication_stock_usage_report_review_required',
      severity: 'warning',
      title: '外用・頓服の使用量報告を確認してください',
      detail: `${sourceLabel}、外用薬・頓服薬の使用量に関する報告があります。残量観測とは区別して確認してください。`,
      actionLabel: '使用量報告を確認',
    };
  }

  return {
    code: 'medication_stock_external_observation_review_required',
    severity: 'warning',
    title: '外用・頓服の残数報告を確認してください',
    detail: `${sourceLabel}、外用薬・頓服薬の残数に関する報告があります。薬剤師確認後に残数台帳へ反映してください。`,
    actionLabel: '残数報告を確認',
  };
}

function buildMedicationIdentityDescriptor(): MedicationStockRiskDescriptor {
  return {
    code: 'medication_stock_equivalence_review_required',
    severity: 'warning',
    title: '外用・頓服報告の薬剤名寄せ確認が必要です',
    detail:
      '外用薬・頓服薬の不足・残数・使用量の報告に、薬剤マスタ照合または名寄せ確認が必要な情報が含まれています。薬剤師が正本薬剤を確認してください。',
    actionLabel: '薬剤名寄せを確認',
  };
}

function sourceGroupLabel(
  sourceGroup: Extract<
    InboundMedicationStockSignalStagingResult,
    { action: 'stage_for_pharmacist_review' }
  >['decision']['sourceClassification']['sourceGroup'],
) {
  switch (sourceGroup) {
    case 'external_multi_professional':
      return '他職種から';
    case 'patient_or_family_reported':
      return '患者または家族から';
    case 'pharmacy_owned':
      return '薬局内で';
    case 'unknown':
      return '発信元不明の経路から';
  }
}

function buildMedicationStockReviewHref(
  context: MedicationStockStagingRiskContext & { patientHref?: string | null },
) {
  if ('patientHref' in context && typeof context.patientHref === 'string' && context.patientHref) {
    return `${context.patientHref}#medication-stock-events`;
  }
  if (context.patientId) {
    return `/patients/${encodeURIComponent(context.patientId)}#medication-stock-events`;
  }
  return '/patients';
}

function buildRiskKeySuffix(
  result: Extract<
    InboundMedicationStockSignalStagingResult,
    { action: 'stage_for_pharmacist_review' }
  >,
) {
  const summary = result.decision.publicSummary;
  const seed = [
    summary.sourceType,
    result.observation.source.sourceRecordId ?? 'no-source-record',
    summary.observedByRole ?? 'unknown',
    summary.observationKind,
    summary.occurredAtDateKey ?? 'no-date',
    result.observation.observedQuantity?.value ?? 'no-observed-value',
    result.observation.observedQuantity?.unitKey ?? 'no-observed-unit',
    result.observation.usageQuantity?.value ?? 'no-usage-value',
    result.observation.usageQuantity?.unitKey ?? 'no-usage-unit',
    summary.hasMedicationIdentity ? 'has-medication' : 'no-medication',
    summary.hasObservedQuantity ? 'has-observed' : 'no-observed',
    summary.hasUsageQuantity ? 'has-usage' : 'no-usage',
    result.decision.reviewPriority,
  ].join(':');

  return `h${hashForRiskKey(seed)}`;
}

function hashForRiskKey(value: string) {
  return createHash('sha256').update(value.normalize('NFKC')).digest('hex').slice(0, 16);
}
