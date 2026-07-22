import { format, parseISO } from 'date-fns';
import { z } from 'zod';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { formatYen } from '@/lib/ui/currency-format';
import { visitRecordBaseSchema } from '@/lib/validations/visit-record';
import {
  getVisitAttachmentConstraints,
  getVisitReceiptReadiness,
} from './visit-record-form.shared';
import { visitRecordCdsAlertsResponseSchema } from './visit-record-form-response-schemas';
import type { CdsAlert } from '@/components/features/cds/alert-panel';
import type { VisitPreviousStructuredReuse } from '@/components/features/visits/visit-medication-management-section';
import type { VisitMedicationStockObservationRequest } from '@/types/medication-stock';
import type { StructuredSoap } from '@/types/structured-soap';
import type { VisitGeoLog } from '@/lib/visit-location';
import type { PendingPatientReflection } from './visit-patient-reflection';

export type ScheduleDetail = {
  id: string;
  patient_id: string;
  case_id: string;
  case_version: number;
  cycle_id: string | null;
  scheduled_date: string;
  schedule_status?: string;
  visit_type: string;
  carry_items_status: string | null;
  recurrence_rule?: string | null;
  time_window_start?: string | null;
  case_?: {
    patient?: {
      id: string;
      name: string;
    } | null;
  } | null;
};

export const VISIT_RECORD_ALERT_TYPES = new Set(['renal_dose', 'pim_elderly', 'high_risk']);
export const VISIT_DRAFT_AUTOSAVE_DELAY_MS = 5_000;
export const VISIT_SYNC_COUNT_POLL_MS = 5_000;

export async function fetchVisitRecordCdsAlerts(
  cycleId: string,
  orgId: string,
): Promise<{ alerts: CdsAlert[] }> {
  const res = await fetch('/api/cds/check', {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({ cycleId }),
  });
  return readApiJson(res, {
    schema: visitRecordCdsAlertsResponseSchema,
    fallbackMessage: '訪問時の処方安全アラート取得に失敗しました',
  });
}

export const outcomeOptions = [
  { value: 'completed', label: '完了' },
  { value: 'revisit_needed', label: '再訪必要' },
  { value: 'postponed', label: '延期' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'delivery_only', label: '投薬のみ' },
  { value: 'completed_with_issue', label: '完了（課題あり）' },
];

export const relationOptions = [
  { value: 'self', label: '本人' },
  { value: 'spouse', label: '配偶者' },
  { value: 'child', label: '子' },
  { value: 'parent', label: '親' },
  { value: 'sibling', label: '兄弟姉妹' },
  { value: 'other_family', label: 'その他家族' },
  { value: 'caregiver', label: '介護者' },
  { value: 'facility_staff', label: '施設職員' },
  { value: 'other', label: 'その他' },
];

// ⑤ 反映導線: 服薬管理者の選択肢(patientIntakeSchema.medication_manager と一致させる)
export const medicationManagerOptions = [
  { value: 'self', label: '本人' },
  { value: 'family', label: '家族' },
  { value: 'visiting_nurse', label: '訪問看護師' },
  { value: 'facility', label: '施設職員' },
  { value: 'pharmacist', label: '薬剤師' },
  { value: 'unknown', label: '不明' },
];

export const formSchema = visitRecordBaseSchema
  .extend({
    carry_item_warning_acknowledged: z.boolean().optional(),
    residual_medications: z
      .array(
        z.object({
          drug_name: z.string().min(1, '薬剤名は必須です'),
          drug_code: z.string().optional(),
          prescribed_quantity: z.number().optional(),
          prescribed_daily_dose: z.number().optional(),
          remaining_quantity: z.number().min(0),
          is_prohibited_reduction: z.boolean(),
        }),
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.visit_ended_at && !data.visit_started_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visit_ended_at'],
        message: '訪問終了時刻を記録するには訪問開始時刻が必要です',
      });
    }
    if (
      data.visit_started_at &&
      data.visit_ended_at &&
      new Date(data.visit_ended_at).getTime() < new Date(data.visit_started_at).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visit_ended_at'],
        message: '訪問終了時刻は訪問開始時刻以降にしてください',
      });
    }

    const readiness = getVisitReceiptReadiness(data);
    if (!readiness.hasIdentityInput || readiness.hasCompleteIdentity) return;

    if (!data.receipt_person_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_person_name'],
        message: '受領者名を入力してください',
      });
    }
    if (!data.receipt_person_relation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_person_relation'],
        message: '受領者の続柄を選択してください',
      });
    }
    if (!data.receipt_at?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receipt_at'],
        message: '受領日時を入力してください',
      });
    }
  });

export type FormValues = z.infer<typeof formSchema>;

export type UploadedVisitAttachment = {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  kind: 'photo' | 'attachment';
};

export type SavedVisitRecord = {
  id: string;
  version: number;
  patient_id: string;
};

export type VisitRecordMutationInput = {
  values: FormValues;
  medicationStockRequest: VisitMedicationStockObservationRequest | null;
  medicationStockIdempotencyKey: string | null;
};

export type PendingMedicationStockSubmission = {
  record: SavedVisitRecord;
  attachmentWarning: string | null;
  request: VisitMedicationStockObservationRequest;
  idempotencyKey: string;
};

export type PendingPatientReflectionSubmission = {
  reflection: PendingPatientReflection;
  record: SavedVisitRecord;
  attachmentWarning: string | null;
  status: 'stale' | 'failed' | 'ready';
  reconfirmed: boolean;
};

export const nullableStringSchema = z.string().nullable();

export const visitPreviousStructuredReuseSchema = z.object({
  source_visit_record_id: z.string(),
  source_visit_record_version: z.number().int().nullable(),
  source_visit_record_updated_at: nullableStringSchema,
  subjective: z.array(z.string()),
  objective: z.array(z.string()),
  assessment: z.array(z.string()),
  plan: z.array(z.string()),
  handoff: z.object({
    next_check_items: z.array(z.string()),
    ongoing_monitoring: z.array(z.string()),
    decision_rationale: nullableStringSchema,
  }),
  carry_forward_items: z.array(z.string()),
});

export const visitPreparationSnapshotSchema = z.object({
  data: z.object({
    pack: z
      .object({
        care_team: z.array(
          z.object({
            id: z.string(),
            role: z.string(),
            name: z.string(),
            organization_name: nullableStringSchema,
            phone: nullableStringSchema,
          }),
        ),
        billing_blockers: z.array(
          z.object({
            key: z.string(),
            reason: z.string(),
            severity: z.enum(['urgent', 'high', 'normal']).optional(),
          }),
        ),
        conference_context: z.array(
          z.object({
            id: z.string(),
            note_type: z.enum(['pre_discharge', 'service_manager']),
            title: z.string(),
            conference_date: z.string(),
            participants: z.array(
              z.object({
                name: nullableStringSchema,
                role: nullableStringSchema,
              }),
            ),
            highlights: z.array(z.string()),
            action_items: z.array(z.string()),
            sync_summary: z
              .object({
                billing_candidate_id: nullableStringSchema.optional(),
                visit_proposal_id: nullableStringSchema.optional(),
                report_draft_ids: z.array(z.string()).optional(),
                tasks_created: z.number().optional(),
                medication_issues_created: z.number().optional(),
              })
              .nullable()
              .optional(),
          }),
        ),
        medication_period: z
          .object({
            schedule_start_date: nullableStringSchema,
            schedule_end_date: nullableStringSchema,
            prescription_start_date: nullableStringSchema,
            prescription_end_date: nullableStringSchema,
          })
          .nullable()
          .optional(),
        prescription_changes: z
          .object({
            current_prescribed_date: z.string(),
            previous_prescribed_date: nullableStringSchema,
            source_type: z.string(),
            added: z.array(z.string()),
            changed: z.array(
              z.object({
                drug_name: z.string(),
                reasons: z.array(z.string()),
              }),
            ),
            removed: z.array(z.string()),
          })
          .nullable()
          .optional(),
        outside_meds: z
          .array(
            z.object({
              line_id: z.string(),
              drug_name: z.string(),
              outside_med_kind: z.string(),
              outside_med_label: z.string(),
            }),
          )
          .nullable()
          .optional(),
        previous_visit: z
          .object({
            summary: nullableStringSchema.optional(),
            structured_reuse: visitPreviousStructuredReuseSchema.nullable().optional(),
          })
          .nullable()
          .optional(),
        facility_parallel_context: z
          .object({
            batch_id: nullableStringSchema,
            label: nullableStringSchema,
            place_kind: z.enum(['facility', 'home_group', 'address']).nullable(),
            site_name: nullableStringSchema,
            common_notes: nullableStringSchema,
            current_schedule_id: z.string(),
            patients: z.array(
              z.object({
                schedule_id: z.string(),
                patient_id: z.string(),
                patient_name: z.string(),
                patient_name_kana: nullableStringSchema,
                patient_birth_date: nullableStringSchema,
                patient_gender: nullableStringSchema,
                unit_name: nullableStringSchema,
                route_order: z.number().int().nullable(),
                schedule_status: z.string(),
                medication_start_date: nullableStringSchema,
                medication_end_date: nullableStringSchema,
                preparation_blockers_count: z.number().int().nonnegative(),
                visit_record_id: nullableStringSchema,
                visit_outcome_status: nullableStringSchema,
              }),
            ),
          })
          .nullable()
          .optional(),
        intake_context: z
          .object({
            initial_transition_management_expected: z.boolean().nullable().optional(),
          })
          .passthrough()
          .optional(),
        billing_collection_context: z
          .object({
            candidate_id: nullableStringSchema,
            billing_month: nullableStringSchema,
            billing_name: nullableStringSchema,
            candidate_status: nullableStringSchema,
            current_billed_amount: z.number().nullable(),
            current_collection_amount: z.number().nullable(),
            previous_unpaid_amount: z.number().nullable(),
            total_collection_amount: z.number().nullable(),
            collected_amount: z.number().nullable(),
            payer_name: nullableStringSchema,
            payer_relation: nullableStringSchema,
            collection_method: nullableStringSchema,
            collection_method_label: nullableStringSchema,
            collection_timing: nullableStringSchema,
            collection_timing_label: nullableStringSchema,
            scheduled_collection_at: nullableStringSchema,
            collected_at: nullableStringSchema,
            receipt_issue: nullableStringSchema,
            receipt_issue_label: nullableStringSchema,
            receipt_issue_status: nullableStringSchema,
            receipt_issue_status_label: nullableStringSchema,
            receipt_number: nullableStringSchema,
            collector_user_id: nullableStringSchema,
          })
          .nullable()
          .optional(),
      })
      .passthrough(),
  }),
});

export type VisitPreparationSnapshot = z.infer<typeof visitPreparationSnapshotSchema>;

export class VisitPreparationNonRetryableError extends Error {
  constructor() {
    super('訪問準備情報を表示できません');
    this.name = 'VisitPreparationNonRetryableError';
  }
}

export const { maxAttachments: MAX_VISIT_ATTACHMENTS } = getVisitAttachmentConstraints();

export function buildPreviousVisitReuseSource(
  reuse: VisitPreviousStructuredReuse | null | undefined,
): StructuredSoap['previous_visit_reuse'] | undefined {
  if (!reuse) return undefined;
  return {
    source_visit_record_id: reuse.source_visit_record_id,
    source_visit_record_version: reuse.source_visit_record_version,
    source_visit_record_updated_at: reuse.source_visit_record_updated_at,
    carry_forward_items: reuse.carry_forward_items,
  };
}

export function buildStructuredSoap(
  values: FormValues,
  previousVisitStructuredReuse?: VisitPreviousStructuredReuse | null,
): StructuredSoap {
  const wizard = values.structured_soap as Partial<StructuredSoap> | undefined;
  const previousVisitReuseSource =
    buildPreviousVisitReuseSource(previousVisitStructuredReuse) ?? wizard?.previous_visit_reuse;
  return {
    subjective: {
      symptom_checks: wizard?.subjective?.symptom_checks ?? [],
      free_text: values.soap_subjective || wizard?.subjective?.free_text || undefined,
    },
    objective: {
      medication_status: wizard?.objective?.medication_status ?? 'free_text_only',
      adherence_score: wizard?.objective?.adherence_score ?? 3,
      side_effect_checks: wizard?.objective?.side_effect_checks ?? [],
      free_text: values.soap_objective || wizard?.objective?.free_text || undefined,
      ...(wizard?.objective?.vitals ? { vitals: wizard.objective.vitals } : {}),
      ...(wizard?.objective?.lab_values ? { lab_values: wizard.objective.lab_values } : {}),
      ...(wizard?.objective?.self_management_ability != null
        ? { self_management_ability: wizard.objective.self_management_ability }
        : {}),
      ...(wizard?.objective?.medication_calendar_used != null
        ? { medication_calendar_used: wizard.objective.medication_calendar_used }
        : {}),
      ...(wizard?.objective?.functional_assessment
        ? { functional_assessment: wizard.objective.functional_assessment }
        : {}),
      ...(wizard?.objective?.adverse_events
        ? { adverse_events: wizard.objective.adverse_events }
        : {}),
    },
    assessment: {
      problem_checks: wizard?.assessment?.problem_checks ?? [],
      free_text: values.soap_assessment || wizard?.assessment?.free_text || undefined,
      ...(wizard?.assessment?.severity ? { severity: wizard.assessment.severity } : {}),
      ...(wizard?.assessment?.drug_related_problems
        ? { drug_related_problems: wizard.assessment.drug_related_problems }
        : {}),
    },
    plan: {
      intervention_checks: wizard?.plan?.intervention_checks ?? [],
      next_visit_date:
        values.next_visit_suggestion_date || wizard?.plan?.next_visit_date || undefined,
      free_text: values.soap_plan || wizard?.plan?.free_text || undefined,
      ...(wizard?.plan?.prescription_proposal
        ? { prescription_proposal: wizard.plan.prescription_proposal }
        : {}),
      ...(wizard?.plan?.physician_report_items
        ? { physician_report_items: wizard.plan.physician_report_items }
        : {}),
      ...(wizard?.plan?.care_manager_report_items
        ? { care_manager_report_items: wizard.plan.care_manager_report_items }
        : {}),
      ...(wizard?.plan?.care_service_coordination
        ? { care_service_coordination: wizard.plan.care_service_coordination }
        : {}),
    },
    ...(wizard?.residual_medications ? { residual_medications: wizard.residual_medications } : {}),
    ...(wizard?.home_visit_2026 ? { home_visit_2026: wizard.home_visit_2026 } : {}),
    ...(previousVisitReuseSource ? { previous_visit_reuse: previousVisitReuseSource } : {}),
  };
}

export function buildDraftMetadata(values: FormValues, visitGeoLog: VisitGeoLog | null) {
  return {
    visitDate: values.visit_date,
    visitStartedAt: values.visit_started_at,
    visitEndedAt: values.visit_ended_at,
    outcomeStatus: values.outcome_status,
    receiptPersonName: values.receipt_person_name,
    receiptPersonRelation: values.receipt_person_relation,
    receiptAt: values.receipt_at,
    nextVisitSuggestionDate: values.next_visit_suggestion_date,
    cancellationReason: values.cancellation_reason,
    postponeReason: values.postpone_reason,
    revisitReason: values.revisit_reason,
    residualMedications: values.residual_medications ?? [],
    visitGeoLog,
  };
}

export function hasMeaningfulVisitDraft(values: FormValues, visitGeoLog: VisitGeoLog | null) {
  return Boolean(
    values.visit_started_at ||
    values.visit_ended_at ||
    values.soap_subjective?.trim() ||
    values.soap_objective?.trim() ||
    values.soap_assessment?.trim() ||
    values.soap_plan?.trim() ||
    values.receipt_person_name?.trim() ||
    values.receipt_person_relation?.trim() ||
    values.next_visit_suggestion_date?.trim() ||
    values.cancellation_reason?.trim() ||
    values.postpone_reason?.trim() ||
    values.revisit_reason?.trim() ||
    (values.residual_medications?.length ?? 0) > 0 ||
    visitGeoLog?.start ||
    visitGeoLog?.end,
  );
}

export function formatVisitBillingAmount(value: number | null | undefined) {
  return formatYen(value, '未記録');
}

export function formatVisitBillingDateTime(value: string | null | undefined) {
  if (!value) return '未記録';
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return '未記録';
  return format(parsed, 'yyyy/MM/dd HH:mm');
}

export function formatVisitExecutionTimestamp(value: string | null | undefined) {
  if (!value) return '未記録';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '未記録';
  return format(parsed, 'yyyy/MM/dd HH:mm');
}
