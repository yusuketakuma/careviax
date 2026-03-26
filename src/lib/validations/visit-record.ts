import { z } from 'zod';

export const createVisitRecordSchema = z.object({
  schedule_id: z.string().min(1, 'スケジュールIDは必須です'),
  patient_id: z.string().min(1, '患者IDは必須です'),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です（YYYY-MM-DD）'),
  outcome_status: z.enum([
    'completed',
    'revisit_needed',
    'postponed',
    'cancelled',
    'delivery_only',
    'completed_with_issue',
  ]),
  soap_subjective: z.string().optional(),
  soap_objective: z.string().optional(),
  soap_assessment: z.string().optional(),
  soap_plan: z.string().optional(),
  structured_soap: z.record(z.unknown()).optional(),
  receipt_person_name: z.string().optional(),
  receipt_person_relation: z.string().optional(),
  next_visit_suggestion_date: z.string().optional(),
  cancellation_reason: z.string().optional(),
  postpone_reason: z.string().optional(),
  revisit_reason: z.string().optional(),
});

export const updateVisitRecordSchema = createVisitRecordSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
  });

export type CreateVisitRecordInput = z.infer<typeof createVisitRecordSchema>;
export type UpdateVisitRecordInput = z.infer<typeof updateVisitRecordSchema>;
