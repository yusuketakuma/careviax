import { SET_METHOD_LABELS } from '@/lib/dispensing/set-methods';
import {
  deriveOutsideMedEvidenceKind,
  OUTSIDE_MED_EVIDENCE_KIND_LABELS,
} from '@/lib/dispensing/outside-med-classification';
import { detectMedicationChanges as detectChangesShared } from '@/lib/prescription/medication-diff';
import { readJahisSupplementalDetails } from '@/lib/pharmacy/jahis-supplemental-records-view';
import { formatDateKey } from '@/lib/date-key';
import type {
  VisitBriefChangeType,
  VisitBriefDispensingItem,
  VisitBriefJahisSupplementalRecord,
  VisitBriefMedicationChange,
} from '@/types/visit-brief';

type PharmacyVisitBriefPrescriptionLine = {
  drug_name: string;
  drug_code: string | null;
  drug_master_id?: string | null;
  dose: string;
  frequency: string;
  days?: number | null;
  dispensing_method: string | null;
  packaging_instructions: string | null;
  packaging_instruction_tags?: string[] | null;
  start_date?: Date | null;
  end_date?: Date | null;
};

type PharmacyVisitBriefSetPlan = {
  set_method?: string | null;
  target_period_start?: Date | null;
  target_period_end?: Date | null;
  notes?: string | null;
  audits?: Array<{ result: string }>;
} | null;

type JahisSupplementalRecordForBrief = {
  id: string;
  record_type: string;
  record_label: string;
  summary: string | null;
  payload: unknown;
  raw_line: string;
  created_at: Date;
};

const DISPENSING_METHOD_LABELS: Record<string, string> = {
  standard: '通常',
  unit_dose: '一包化',
  crushed: '粉砕',
  other: 'その他',
};

const SET_AUDIT_LABELS: Record<string, string> = {
  approved: '承認',
  partial_approved: '部分承認',
  rejected: '差戻し',
};

export function normalizePharmacyJahisSupplementalRecordsForVisitBrief(
  records: JahisSupplementalRecordForBrief[],
): VisitBriefJahisSupplementalRecord[] {
  return records.map((record) => ({
    id: record.id,
    record_type: record.record_type,
    record_label: record.record_label,
    summary: record.summary,
    details: readJahisSupplementalDetails(record.payload),
    raw_line: record.raw_line,
    created_at: record.created_at.toISOString(),
  }));
}

export function detectPharmacyVisitBriefMedicationChanges(
  currentLines: PharmacyVisitBriefPrescriptionLine[],
  previousLines: PharmacyVisitBriefPrescriptionLine[],
  prescribedDate: string | null,
  prescriberName: string | null,
): VisitBriefMedicationChange[] {
  const rawChanges = detectChangesShared(currentLines, previousLines);
  return rawChanges.map((c) => ({
    drug_name: c.drug_name,
    drug_code: c.drug_code,
    change_type: c.change_type as VisitBriefChangeType,
    previous: c.previous,
    current: c.current ?? '中止',
    prescribed_date: prescribedDate,
    prescriber_name: prescriberName,
  }));
}

export function buildPharmacyVisitBriefDispensingItems(args: {
  currentLines: PharmacyVisitBriefPrescriptionLine[];
  latestSetPlan: PharmacyVisitBriefSetPlan;
}): VisitBriefDispensingItem[] {
  const latestAuditResult = args.latestSetPlan?.audits?.[0]?.result;
  const auditStatus = latestAuditResult
    ? (SET_AUDIT_LABELS[latestAuditResult] ?? latestAuditResult)
    : null;
  const setMethod = args.latestSetPlan?.set_method
    ? (SET_METHOD_LABELS[args.latestSetPlan.set_method as keyof typeof SET_METHOD_LABELS] ??
      args.latestSetPlan.set_method)
    : null;
  const setPeriodLabel =
    args.latestSetPlan?.target_period_start && args.latestSetPlan?.target_period_end
      ? `${formatDateKey(args.latestSetPlan.target_period_start)} - ${formatDateKey(args.latestSetPlan.target_period_end)}`
      : null;

  const items = args.currentLines.flatMap((line) => {
    const outsideMedKind = deriveOutsideMedEvidenceKind(line);
    if (!line.dispensing_method && !line.packaging_instructions && !setMethod && !outsideMedKind) {
      return [];
    }

    const methodLabel = line.dispensing_method
      ? (DISPENSING_METHOD_LABELS[line.dispensing_method] ?? line.dispensing_method)
      : null;
    const noteParts = [
      methodLabel ? `方法: ${methodLabel}` : null,
      line.packaging_instructions ? `包装: ${line.packaging_instructions}` : null,
      setMethod ? `セット: ${setMethod}` : null,
      auditStatus ? `鑑査: ${auditStatus}` : null,
      args.latestSetPlan?.notes ? `備考: ${args.latestSetPlan.notes}` : null,
    ].filter((value): value is string => Boolean(value));

    return [
      {
        drug_name: line.drug_name,
        dispensing_method: methodLabel,
        packaging_instructions: line.packaging_instructions,
        set_method: setMethod,
        set_period_label: setPeriodLabel,
        audit_status: auditStatus,
        outside_med_kind: outsideMedKind,
        outside_med_label: outsideMedKind ? OUTSIDE_MED_EVIDENCE_KIND_LABELS[outsideMedKind] : null,
        note: noteParts.join(' / '),
      },
    ];
  });

  return items.slice(0, 8);
}
