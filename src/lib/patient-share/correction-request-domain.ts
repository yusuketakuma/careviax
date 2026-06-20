import { z } from 'zod';
import { cursorPaginatedPageSchema } from '@/lib/api/response-schemas';

export const PATIENT_SHARE_CORRECTION_TARGET_TYPES = [
  'patient_profile',
  'care_case',
  'management_plan',
  'visit_request',
  'partner_visit_record',
  'claim_note',
  'billing_candidate',
] as const;

export type PatientShareCorrectionTargetType =
  (typeof PATIENT_SHARE_CORRECTION_TARGET_TYPES)[number];

export const correctionTargetTypeSchema = z.enum(PATIENT_SHARE_CORRECTION_TARGET_TYPES);

export const correctionRequestTypeSchema = z.enum(['correction', 'addition']);

export type PatientShareCorrectionRequestType = z.infer<typeof correctionRequestTypeSchema>;

export const patientShareCorrectionRequestRowSchema = z.object({
  id: z.string(),
  share_case_id: z.string(),
  target_owner: z.string(),
  target_type: correctionTargetTypeSchema,
  target_id: z.string().nullable(),
  field_path: z.string().nullable(),
  request_type: correctionRequestTypeSchema,
  status: z.string(),
  requested_by: z.string(),
  responded_by: z.string().nullable(),
  resolved_by: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const patientShareCorrectionRequestPageSchema = cursorPaginatedPageSchema(
  patientShareCorrectionRequestRowSchema,
);

export type PatientShareCorrectionRequestRow = z.infer<
  typeof patientShareCorrectionRequestRowSchema
>;

export type PatientShareCorrectionRequestRowInput = {
  id: string;
  share_case_id: string;
  target_owner: string;
  target_type: string;
  target_id: string | null;
  field_path: string | null;
  request_type: string;
  status: string;
  requested_by: string;
  responded_by: string | null;
  resolved_by: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function serializeDate(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNullableDate(value: string | Date | null) {
  return value === null ? null : serializeDate(value);
}

export function toPatientShareCorrectionRequestRow(
  row: PatientShareCorrectionRequestRowInput,
): PatientShareCorrectionRequestRow {
  return patientShareCorrectionRequestRowSchema.parse({
    id: row.id,
    share_case_id: row.share_case_id,
    target_owner: row.target_owner,
    target_type: row.target_type,
    target_id: row.target_id,
    field_path: row.field_path,
    request_type: row.request_type,
    status: row.status,
    requested_by: row.requested_by,
    responded_by: row.responded_by,
    resolved_by: row.resolved_by,
    resolved_at: serializeNullableDate(row.resolved_at),
    created_at: serializeDate(row.created_at),
    updated_at: serializeDate(row.updated_at),
  });
}

export const correctionRequestFieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.[\]-]+$/, '項目パスが不正です');

export const PATIENT_SHARE_CORRECTION_FIELD_PATHS_BY_TARGET_TYPE = {
  patient_profile: [
    'name',
    'name_kana',
    'birth_date',
    'gender',
    'phone',
    'allergy_info',
    'notes',
    'primary_residence.address',
    'primary_residence.unit_name',
  ],
  care_case: [
    'referral_source',
    'referral_date',
    'start_date',
    'end_date',
    'primary_pharmacist_id',
    'required_visit_support',
    'notes',
  ],
  management_plan: ['content', 'goals', 'monitoring_items', 'review_schedule'],
  visit_request: [
    'request_reason',
    'desired_start_at',
    'desired_end_at',
    'physician_instruction',
    'carry_items',
    'patient_home_notes',
  ],
  partner_visit_record: [
    'visit_at',
    'pharmacist_id',
    'pharmacist_name',
    'record_content',
    'attachments',
  ],
  claim_note: [
    'prescription_received_by',
    'dispensing_pharmacy_name',
    'claim_status',
    'claim_note_text',
  ],
  billing_candidate: ['billing_status', 'exclusion_reason', 'amount_snapshot'],
} as const satisfies Record<PatientShareCorrectionTargetType, readonly string[]>;

export function patientShareCorrectionFieldPaths(targetType: PatientShareCorrectionTargetType) {
  return PATIENT_SHARE_CORRECTION_FIELD_PATHS_BY_TARGET_TYPE[targetType];
}

export function isPatientShareCorrectionFieldPath(
  targetType: PatientShareCorrectionTargetType,
  fieldPath: string,
) {
  return (
    PATIENT_SHARE_CORRECTION_FIELD_PATHS_BY_TARGET_TYPE[targetType] as readonly string[]
  ).includes(fieldPath);
}
