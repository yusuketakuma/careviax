// ─── CareReport 投影ビルダー (billing_context / source_provenance) ─────────────
// CareReport.content 直下へ埋め込む請求根拠(billing_context)と来歴(source_provenance)
// の構築ロジックを一本化する。report-generator と care-reports API がここを利用する。
// 出力の値・キー・順序は従来の各構築箇所と 1 対 1 対応（JSON 形状を変えない）。

import type { Prisma } from '@prisma/client';
import { readJsonObjectNumber, readJsonObjectString } from '@/lib/db/json';
import type {
  CareReportBillingContext,
  CareReportManualSourceProvenance,
  CareReportVisitRecordSourceProvenance,
} from '@/types/care-report-content';

function toIsoStringOrNull(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

// billingEvidence.findFirst の select 結果に対応する構造的入力型。
// Json 列 (applied_rule_keys / recommended_rule_keys / calculation_context) は
// 不透明な JSON として扱う。
export type CareReportBillingEvidenceInput = {
  id: string;
  cycle_id: string | null;
  patient_id: string | null;
  claimable: boolean;
  exclusion_reason: string | null;
  report_delivery_ref: string | null;
  updated_at: Date;
  payer_basis: string;
  applied_rule_keys: unknown;
  recommended_rule_keys: unknown;
  validation_notes: string | null;
  calculation_context: unknown;
};

// billingEvidence を content.billing_context へ射影する。
// billingEvidence が無い場合は null（従来通り content.billing_context = null）。
export function buildCareReportBillingContext(
  billingEvidence: CareReportBillingEvidenceInput | null,
): CareReportBillingContext | null {
  if (!billingEvidence) return null;
  return {
    billing_evidence_id: billingEvidence.id,
    payer_basis: billingEvidence.payer_basis,
    claimable: billingEvidence.claimable,
    exclusion_reason: billingEvidence.exclusion_reason,
    report_delivery_ref: billingEvidence.report_delivery_ref,
    applied_rule_keys: billingEvidence.applied_rule_keys ?? [],
    recommended_rule_keys: billingEvidence.recommended_rule_keys ?? [],
    validation_notes: billingEvidence.validation_notes ?? null,
    updated_at: toIsoStringOrNull(billingEvidence.updated_at),
    effective_revision_code: readJsonObjectString(
      billingEvidence.calculation_context,
      'effective_revision_code',
    ),
    site_config_status: readJsonObjectString(
      billingEvidence.calculation_context,
      'site_config_status',
    ),
    site_config_revision_code: readJsonObjectString(
      billingEvidence.calculation_context,
      'site_config_revision_code',
    ),
    jahis_supplemental_record_count: readJsonObjectNumber(
      billingEvidence.calculation_context,
      'jahis_supplemental_record_count',
    ),
    jahis_residual_confirmation_count: readJsonObjectNumber(
      billingEvidence.calculation_context,
      'jahis_residual_confirmation_count',
    ),
  };
}

// report-generator の完全版 source_provenance を構築するための入力。
export type CareReportVisitSourceProvenanceInput = {
  visitRecord: {
    id: string;
    patient_id: string;
    schedule_id: string;
    version: number | null;
    updated_at: Date;
  };
  caseId: string;
  medicationCycle: { id: string } | null;
  prescriptionLines: Array<{
    id: string;
    intake_id: string;
    drug_code: string | null;
    drug_name: string;
    quantity: number | null;
    unit: string | null;
    intake: { prescribed_date: Date };
  }>;
  billingEvidence: CareReportBillingEvidenceInput | null;
  latestReportLabs: Array<{
    id: string;
    analyte_code: string;
    measured_at: Date;
    abnormal_flag: string | null;
  }>;
};

// 訪問記録からの完全生成経路（report-generator）の source_provenance。
export function buildCareReportVisitSourceProvenance(
  input: CareReportVisitSourceProvenanceInput,
): CareReportVisitRecordSourceProvenance {
  const {
    visitRecord,
    caseId,
    medicationCycle,
    prescriptionLines,
    billingEvidence,
    latestReportLabs,
  } = input;
  return {
    schema_version: 1,
    visit_record_id: visitRecord.id,
    visit_record_version: visitRecord.version ?? null,
    visit_record_updated_at: toIsoStringOrNull(visitRecord.updated_at),
    schedule_id: visitRecord.schedule_id,
    patient_id: visitRecord.patient_id,
    case_id: caseId,
    medication_cycle_id: medicationCycle?.id ?? null,
    prescription_intake_ids: Array.from(new Set(prescriptionLines.map((line) => line.intake_id))),
    prescription_line_ids: prescriptionLines.map((line) => line.id),
    prescription_lines: prescriptionLines.map((line) => ({
      prescription_line_id: line.id,
      prescription_intake_id: line.intake_id,
      prescribed_date: line.intake.prescribed_date.toISOString(),
      drug_code: line.drug_code,
      drug_name: line.drug_name,
      quantity: line.quantity,
      unit: line.unit,
    })),
    billing_evidence_id: billingEvidence?.id ?? null,
    billing_evidence_updated_at: toIsoStringOrNull(billingEvidence?.updated_at),
    latest_lab_observations: latestReportLabs.map((lab) => ({
      id: lab.id,
      analyte_code: lab.analyte_code,
      measured_at: lab.measured_at.toISOString(),
      abnormal_flag: lab.abnormal_flag,
    })),
    patient_insurance_basis: billingEvidence
      ? {
          payer_basis: billingEvidence.payer_basis,
          patient_id: billingEvidence.patient_id,
          cycle_id: billingEvidence.cycle_id,
          claimable: billingEvidence.claimable,
          exclusion_reason: billingEvidence.exclusion_reason,
        }
      : null,
    generated_at: new Date().toISOString(),
  };
}

// care-reports API の手動作成経路が埋める簡易版 source_provenance。
// visitRecord が指定されない/取得できない/version・updated_at が不正な場合は null。
export async function buildManualCareReportSourceProvenance(
  db: Pick<Prisma.TransactionClient, 'visitRecord'>,
  args: { orgId: string; visitRecordId?: string },
): Promise<CareReportManualSourceProvenance | null> {
  if (!args.visitRecordId) return null;
  const visitRecord = await db.visitRecord.findFirst({
    where: { id: args.visitRecordId, org_id: args.orgId },
    select: { id: true, version: true, updated_at: true },
  });
  if (!visitRecord) return null;
  if (typeof visitRecord.version !== 'number' || !(visitRecord.updated_at instanceof Date)) {
    return null;
  }
  return {
    schema_version: 1,
    visit_record_id: visitRecord.id,
    visit_record_version: visitRecord.version,
    visit_record_updated_at: visitRecord.updated_at.toISOString(),
    generated_at: new Date().toISOString(),
    source: 'manual_care_report_create',
  };
}
