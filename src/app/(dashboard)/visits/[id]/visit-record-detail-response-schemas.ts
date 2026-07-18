import { z } from 'zod';
import { structuredSoapInputSchema } from '@/lib/validations/structured-soap';
import { visitGeoLogSchema } from '@/lib/validations/visit-record';
import type { StructuredSoap } from '@/types/structured-soap';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const countSchema = z.number().int().nonnegative();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const nullableDateSchema = dateSchema.nullable();

const baselineContextSchema = z
  .object({
    care_level: nullableTextSchema,
    adl_level: nullableTextSchema,
    dementia_level: nullableTextSchema,
    medication_support_methods: z.array(textSchema),
    special_medical_procedures: z.array(textSchema),
    family_key_person: nullableTextSchema,
    money_management: nullableTextSchema,
    visit_before_contact_required: z.boolean().nullable(),
    narcotics_base: z.boolean().nullable(),
    narcotics_rescue: z.boolean().nullable(),
    infection_isolation: nullableTextSchema,
  })
  .strict()
  .nullable();

const attachmentSchema = z
  .object({
    file_id: idSchema,
    file_name: z.string().trim().min(1).max(1_000),
    mime_type: z.string().trim().min(1).max(255),
    size_bytes: z.number().int().nonnegative(),
    uploaded_at: nullableDateSchema,
    kind: z.enum(['photo', 'attachment']),
  })
  .strict();

export function buildVisitRecordDetailResponseSchema(expectedRecordId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedRecordId),
          org_id: idSchema,
          display_id: nullableTextSchema,
          schedule_id: idSchema,
          patient_id: idSchema,
          pharmacist_id: idSchema,
          visit_date: dateSchema,
          visit_started_at: nullableDateSchema,
          visit_ended_at: nullableDateSchema,
          outcome_status: idSchema,
          soap_subjective: nullableTextSchema,
          soap_objective: nullableTextSchema,
          soap_assessment: nullableTextSchema,
          soap_plan: nullableTextSchema,
          structured_soap: structuredSoapInputSchema.nullable(),
          receipt_person_name: nullableTextSchema,
          receipt_person_relation: nullableTextSchema,
          receipt_at: nullableDateSchema,
          next_visit_suggestion_date: nullableDateSchema,
          cancellation_reason: nullableTextSchema,
          postpone_reason: nullableTextSchema,
          revisit_reason: nullableTextSchema,
          attachments: z.array(attachmentSchema).max(10),
          visit_geo_log: visitGeoLogSchema.nullable().optional(),
          version: z.number().int().positive(),
          created_at: dateSchema,
          updated_at: dateSchema,
          schedule: z
            .object({
              id: idSchema,
              case_id: idSchema,
              site_id: idSchema.nullable(),
              pharmacist_id: idSchema,
              visit_type: idSchema,
              scheduled_date: dateSchema,
              recurrence_rule: nullableTextSchema,
              time_window_start: nullableTextSchema,
              time_window_end: nullableTextSchema,
              case_: z
                .object({
                  primary_pharmacist_id: idSchema.nullable(),
                  backup_pharmacist_id: idSchema.nullable(),
                })
                .strict(),
            })
            .strict()
            .nullable(),
          pharmacist_name: nullableTextSchema,
          last_modified_by_id: idSchema.nullable(),
          last_modified_by_name: nullableTextSchema,
          baseline_context: baselineContextSchema,
        })
        .strict()
        .superRefine((data, context) => {
          if (data.schedule && data.schedule.id !== data.schedule_id) {
            context.addIssue({
              code: 'custom',
              path: ['schedule', 'id'],
              message: 'visit schedule relation mismatch',
            });
          }
        })
        .transform((data) => ({
          id: data.id,
          schedule_id: data.schedule_id,
          patient_id: data.patient_id,
          pharmacist_id: data.pharmacist_id,
          visit_date: data.visit_date,
          visit_started_at: data.visit_started_at,
          visit_ended_at: data.visit_ended_at,
          outcome_status: data.outcome_status,
          soap_subjective: data.soap_subjective,
          soap_objective: data.soap_objective,
          soap_assessment: data.soap_assessment,
          soap_plan: data.soap_plan,
          structured_soap: data.structured_soap as Partial<StructuredSoap> | null,
          receipt_person_name: data.receipt_person_name,
          receipt_person_relation: data.receipt_person_relation,
          receipt_at: data.receipt_at,
          next_visit_suggestion_date: data.next_visit_suggestion_date,
          cancellation_reason: data.cancellation_reason,
          postpone_reason: data.postpone_reason,
          revisit_reason: data.revisit_reason,
          version: data.version,
          created_at: data.created_at,
          updated_at: data.updated_at,
          pharmacist_name: data.pharmacist_name,
          last_modified_by_id: data.last_modified_by_id,
          last_modified_by_name: data.last_modified_by_name,
          attachments: data.attachments,
          visit_geo_log: data.visit_geo_log,
          schedule: data.schedule
            ? {
                id: data.schedule.id,
                case_id: data.schedule.case_id,
                site_id: data.schedule.site_id,
                pharmacist_id: data.schedule.pharmacist_id,
                visit_type: data.schedule.visit_type,
                scheduled_date: data.schedule.scheduled_date,
                recurrence_rule: data.schedule.recurrence_rule,
                time_window_start: data.schedule.time_window_start,
                time_window_end: data.schedule.time_window_end,
              }
            : null,
        })),
    })
    .strict();
}

export const visitScheduleCreateResponseSchema = z
  .object({
    data: z
      .object({
        id: idSchema,
        assignment_mode: z.enum(['primary', 'backup', 'explicit']),
      })
      .strict(),
  })
  .strict()
  .transform(({ data }) => ({ data: { id: data.id } }));

export function buildVisitBillingCandidatesResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z.array(
        z
          .object({
            id: idSchema,
            patient_id: z.literal(expectedPatientId),
            status: idSchema,
          })
          .strip(),
      ),
      meta: z
        .object({
          limit: z.number().int().min(1).max(100),
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
          summary: z
            .object({
              total: countSchema,
              pending_review: countSchema,
              confirmed: countSchema,
              excluded: countSchema,
              exported: countSchema,
              unresolved: countSchema,
              ready_to_close: countSchema,
              blocked_from_close: countSchema,
              blocker_reasons: z.array(
                z.object({ reason: textSchema, count: countSchema }).strict(),
              ),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if ((meta.has_more && !meta.next_cursor) || data.length > meta.limit) {
        context.addIssue({ code: 'custom', path: ['meta'], message: 'billing cursor mismatch' });
      }
    })
    .transform(({ data }) => ({ data }));
}

export function buildVisitResidualMedicationsResponseSchema(expectedRecordId: string) {
  return z
    .object({
      data: z.array(
        z
          .object({
            id: idSchema,
            visit_record_id: z.literal(expectedRecordId),
            drug_name: z.string().trim().min(1).max(1_000),
            drug_code: nullableTextSchema,
            prescribed_quantity: z.number().finite().positive().nullable(),
            remaining_quantity: z.number().finite().nonnegative(),
            remaining_days: z.number().int().nonnegative().nullable(),
            excess_days: z.number().int().nonnegative().nullable(),
            is_prohibited_reduction: z.boolean(),
            is_reduction_target: z.boolean(),
            created_at: dateSchema,
          })
          .strict(),
      ),
    })
    .strict()
    .transform(({ data }) => ({
      data: data.map((item) => ({
        id: item.id,
        drug_name: item.drug_name,
        drug_code: item.drug_code,
        prescribed_quantity: item.prescribed_quantity,
        remaining_quantity: item.remaining_quantity,
        excess_days: item.excess_days,
        is_prohibited_reduction: item.is_prohibited_reduction,
        is_reduction_target: item.is_reduction_target,
      })),
    }));
}

const visitConferenceContextSchema = z
  .object({
    id: idSchema,
    note_type: z.enum(['pre_discharge', 'service_manager']),
    title: textSchema,
    conference_date: dateSchema,
    participants: z.array(
      z.object({ name: nullableTextSchema, role: nullableTextSchema }).strict(),
    ),
    highlights: z.array(textSchema),
    action_items: z.array(textSchema),
    sync_summary: z
      .object({
        billing_candidate_id: idSchema.nullable().optional(),
        visit_proposal_id: idSchema.nullable().optional(),
        report_draft_ids: z.array(idSchema).optional(),
        tasks_created: countSchema.optional(),
        medication_issues_created: countSchema.optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export function buildVisitPreparationDetailResponseSchema(expectedScheduleId: string) {
  return z
    .object({
      data: z
        .object({
          pack: z
            .object({
              care_team: z.array(
                z
                  .object({
                    id: idSchema,
                    role: textSchema,
                    name: textSchema,
                    organization_name: nullableTextSchema,
                    phone: nullableTextSchema,
                  })
                  .strict(),
              ),
              billing_blockers: z.array(
                z
                  .object({
                    key: idSchema,
                    reason: textSchema,
                    severity: z.enum(['urgent', 'high', 'normal']).optional(),
                  })
                  .strict(),
              ),
              conference_context: z.array(visitConferenceContextSchema).optional(),
              intake_context: z
                .object({
                  initial_transition_management_expected: z.boolean().nullable().optional(),
                })
                .strip()
                .optional(),
              facility_parallel_context: z
                .object({ current_schedule_id: z.literal(expectedScheduleId) })
                .strip()
                .nullable()
                .optional(),
            })
            .strip()
            .transform((pack) => ({
              care_team: pack.care_team,
              billing_blockers: pack.billing_blockers,
              conference_context: pack.conference_context,
              intake_context: pack.intake_context,
            })),
        })
        .strict(),
    })
    .strict();
}
