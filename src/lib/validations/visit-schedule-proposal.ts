import { z } from 'zod';
import {
  visitPriorityValues,
  visitTypeValues,
} from './visit-schedule';

export const proposalStatusValues = [
  'proposed',
  'patient_contact_pending',
  'confirmed',
  'rejected',
  'superseded',
  'expired',
  'reschedule_pending',
] as const;

export const patientContactStatusValues = [
  'pending',
  'attempted',
  'confirmed',
  'declined',
  'change_requested',
  'unreachable',
] as const;

export const generateVisitScheduleProposalSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  visit_type: z.enum(visitTypeValues).default('regular'),
  priority: z.enum(visitPriorityValues).default('normal'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  locked_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  candidate_count: z.number().int().min(1).max(5).default(3),
  preferred_time_from: z.string().optional(),
  preferred_time_to: z.string().optional(),
  preferred_pharmacist_id: z.string().optional(),
  reschedule_source_schedule_id: z.string().optional(),
  special_cap_eligible: z.boolean().optional(),
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
  }),
  z.object({
    action: z.literal('contact_attempt'),
    outcome: z.enum(['attempted', 'unreachable', 'declined', 'change_requested', 'confirmed']),
    contact_method: z.enum(['phone', 'fax', 'email']).default('phone'),
    contact_name: z.string().optional(),
    contact_phone: z.string().optional(),
    note: z.string().optional(),
    callback_due_at: z
      .string()
      .datetime('callback_due_at の日時形式が不正です')
      .optional(),
  }),
]);

export type GenerateVisitScheduleProposalInput = z.infer<
  typeof generateVisitScheduleProposalSchema
>;

export type UpdateVisitScheduleProposalInput = z.infer<
  typeof updateVisitScheduleProposalSchema
>;
