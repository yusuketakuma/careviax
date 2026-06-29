import { z } from 'zod';
import { visitPriorityValues, visitScheduleDateKeySchema, visitTypeValues } from './visit-schedule';
import { optionalPhoneNumberSchema } from '@/lib/validations/phone';

export const proposalStatusValues = [
  'proposed',
  'patient_contact_pending',
  'confirmed',
  'rejected',
  'superseded',
  'expired',
  'reschedule_pending',
] as const;
export const proposalStatusSchema = z.enum(proposalStatusValues);

export const patientContactStatusValues = [
  'pending',
  'attempted',
  'confirmed',
  'declined',
  'change_requested',
  'unreachable',
] as const;

const proposalTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻形式が不正です（HH:mm）');

const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, 'idempotency_key が不正です')
  .min(1, 'idempotency_key は必須です');

export const generateVisitScheduleProposalSchema = z
  .object({
    case_id: z.string().min(1, 'ケースIDは必須です'),
    visit_type: z.enum(visitTypeValues).default('regular'),
    priority: z.enum(visitPriorityValues).default('normal'),
    start_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
    locked_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
    candidate_count: z.number().int().min(1).max(5).default(3),
    travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).default('DRIVE'),
    preferred_time_from: proposalTimeSchema.optional(),
    preferred_time_to: proposalTimeSchema.optional(),
    preferred_pharmacist_id: z.string().optional(),
    vehicle_resource_id: z.string().trim().min(1).optional(),
    operating_day_override_reason: z
      .string()
      .trim()
      .min(1, '休業日上書き理由は必須です')
      .max(500, '休業日上書き理由は500文字以内で入力してください')
      .optional(),
    reschedule_source_schedule_id: z.string().optional(),
    reproposal_source_proposal_id: z
      .string()
      .trim()
      .min(1, '再提案元の訪問候補IDは必須です')
      .optional(),
    special_cap_eligible: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema,
  })
  .superRefine((data, ctx) => {
    if (data.preferred_time_from && data.preferred_time_to) {
      const [fromHour, fromMinute] = data.preferred_time_from
        .split(':')
        .map((part) => Number.parseInt(part, 10));
      const [toHour, toMinute] = data.preferred_time_to
        .split(':')
        .map((part) => Number.parseInt(part, 10));
      if (toHour * 60 + toMinute <= fromHour * 60 + fromMinute) {
        ctx.addIssue({
          code: 'custom',
          path: ['preferred_time_to'],
          message: '希望終了時刻は希望開始時刻より後にしてください',
        });
      }
    }
  });

export const updateVisitScheduleProposalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('confirm'),
  }),
  z.object({
    action: z.literal('reject'),
    reject_reason: z.string().trim().min(1, '却下理由は必須です').max(300).optional(),
  }),
  z
    .object({
      action: z.literal('contact_attempt'),
      outcome: z.enum(['attempted', 'unreachable', 'declined', 'change_requested', 'confirmed']),
      idempotency_key: idempotencyKeySchema,
      contact_method: z.enum(['phone', 'fax', 'email']).default('phone'),
      contact_name: z.string().optional(),
      contact_phone: optionalPhoneNumberSchema,
      note: z.string().optional(),
      callback_due_at: z.string().datetime('callback_due_at の日時形式が不正です').optional(),
    })
    .superRefine((data, ctx) => {
      if (
        (data.outcome === 'attempted' || data.outcome === 'unreachable') &&
        !data.callback_due_at
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['callback_due_at'],
          message: '未接続の場合は折返し予定日時が必須です',
        });
      }
    }),
]);

export type GenerateVisitScheduleProposalInput = z.infer<
  typeof generateVisitScheduleProposalSchema
>;

export type UpdateVisitScheduleProposalInput = z.infer<typeof updateVisitScheduleProposalSchema>;
