import { z } from 'zod';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { MEDICATION_CYCLE_STATUS_ROLE } from '@/lib/constants/status-labels';
import { STATUS_TOKENS } from '@/lib/constants/status-tokens';

// ---------------------------------------------------------------------------
// Cycle status config — 6 軸セマンティック（MEDICATION_CYCLE_STATUS_ROLE）が正本。
// 線形工程=info(青) / 完了=done(緑) / 保留・疑義=confirm(橙) / 取消=blocked(赤)。
// 旧 CLAUDE.md「待ち=青/進行中=緑/差戻し=赤/完了=灰」は不採用（docs/state-color-migration-map.md）。
// ---------------------------------------------------------------------------

type CycleStatusConfig = {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  className?: string;
};

const apiDateSchema = z.union([z.string().date(), z.string().datetime()]);

export const prescriptionLineResponseSchema = z.object({
  id: z.string().min(1),
  line_number: z.number().int().positive(),
  drug_name: z.string().min(1),
  drug_code: z.string().nullable(),
  dosage_form: z.string().nullable(),
  dose: z.string().min(1),
  frequency: z.string().min(1),
  days: z.number().int().positive(),
  route: z.string().nullable(),
  dispensing_method: z.string().nullable(),
  is_generic: z.boolean(),
  is_generic_name_prescription: z.boolean().nullable(),
  packaging_instructions: z.string().nullable(),
  notes: z.string().nullable(),
});

export type PrescriptionLine = z.infer<typeof prescriptionLineResponseSchema>;

export const inquiryRecordResponseSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  inquiry_to_physician: z.string().min(1),
  inquiry_content: z.string().min(1),
  result: z.string().nullable(),
  proposal_origin: z.enum(['post_inquiry', 'pre_issuance']).nullable(),
  residual_adjustment: z.boolean().nullable(),
  change_detail: z.string().nullable(),
  inquired_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
});

export type InquiryRecord = z.infer<typeof inquiryRecordResponseSchema>;

const jahisSupplementalRecordResponseSchema = z.object({
  id: z.string().min(1),
  record_type: z.string().min(1),
  record_label: z.string().min(1),
  line_number: z.number().int().nonnegative(),
  summary: z.string().nullable(),
  payload: z.unknown().optional(),
  raw_line: z.string().optional(),
});

const prescriptionIntakeDetailSchema = z.object({
  id: z.string().min(1),
  display_id: z.string().nullable(),
  cycle_id: z.string().min(1),
  source_type: z.string().min(1),
  prescribed_date: apiDateSchema,
  prescriber_name: z.string().nullable(),
  prescriber_institution: z.string().nullable(),
  prescriber_institution_ref: z
    .object({
      institution_code: z.string().nullable(),
      phone: z.string().nullable(),
      fax: z.string().nullable(),
    })
    .nullable(),
  prescription_expiry_date: apiDateSchema.nullable(),
  refill_remaining_count: z.number().int().nonnegative().nullable(),
  refill_next_dispense_date: apiDateSchema.nullable(),
  split_dispense_total: z.number().int().nonnegative().nullable(),
  split_dispense_current: z.number().int().nonnegative().nullable(),
  split_next_dispense_date: apiDateSchema.nullable(),
  created_at: z.string().datetime(),
  jahis_supplemental_records: z.array(jahisSupplementalRecordResponseSchema),
  lines: z.array(prescriptionLineResponseSchema),
  cycle: z.object({
    id: z.string().min(1),
    display_id: z.string().nullable(),
    overall_status: z.string().min(1),
    patient_id: z.string().min(1),
    case_: z.object({
      patient: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        name_kana: z.string(),
        birth_date: apiDateSchema.nullable(),
        gender: z.enum(['male', 'female', 'other']).nullable(),
      }),
    }),
    inquiries: z.array(inquiryRecordResponseSchema),
  }),
});

export const prescriptionIntakeDetailResponseSchema = z
  .object({ data: prescriptionIntakeDetailSchema })
  .strict()
  .superRefine((payload, context) => {
    if (payload.data.cycle_id !== payload.data.cycle.id) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'cycle_id'],
        message: 'Prescription intake cycle must match nested cycle',
      });
    }
    if (payload.data.cycle.patient_id !== payload.data.cycle.case_.patient.id) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'cycle', 'patient_id'],
        message: 'Prescription cycle patient must match nested patient',
      });
    }
  });

export type PrescriptionIntakeDetail = z.infer<typeof prescriptionIntakeDetailSchema>;

export const CYCLE_STATUS_CONFIG: Record<string, CycleStatusConfig> = Object.fromEntries(
  Object.entries(MEDICATION_CYCLE_STATUS_ROLE).map(([status, role]) => {
    const label = CYCLE_STATUS_LABELS[status] ?? status;
    if (role === 'neutral') {
      return [status, { label, variant: 'secondary' as const }];
    }
    return [
      status,
      { label, variant: 'outline' as const, className: STATUS_TOKENS[role].badgeClassName },
    ];
  }),
);
