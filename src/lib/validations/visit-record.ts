import { z } from 'zod';

export const visitRecordAttachmentRefSchema = z.object({
  file_id: z.string().uuid('file_id の形式が不正です'),
});

const visitGeoPointSchema = z.object({
  captured_at: z.string().datetime('位置情報の記録日時が不正です'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().min(0).nullable(),
});

export const visitGeoLogSchema = z.object({
  enabled: z.boolean(),
  permission: z.enum(['granted', 'prompt', 'denied', 'unsupported', 'unavailable']),
  start: visitGeoPointSchema.nullable(),
  end: visitGeoPointSchema.nullable(),
});

export const visitRecordBaseSchema = z.object({
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
  structured_soap: z.record(z.string(), z.unknown()).optional(),
  receipt_person_name: z.string().optional(),
  receipt_person_relation: z.string().optional(),
  receipt_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, '日時形式が不正です（YYYY-MM-DDTHH:mm）')
    .optional()
    .or(z.literal('')),
  next_visit_suggestion_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional()
    .or(z.literal('')),
  cancellation_reason: z.string().optional(),
  postpone_reason: z.string().optional(),
  revisit_reason: z.string().optional(),
  residual_medications: z
    .array(
      z.object({
        drug_name: z.string().min(1, '薬剤名は必須です'),
        drug_code: z.string().optional(),
        prescribed_quantity: z.number().positive().optional(),
        prescribed_daily_dose: z.number().positive().optional(),
        remaining_quantity: z.number().min(0, '残数は0以上で入力してください'),
        is_prohibited_reduction: z.boolean().default(false),
      })
    )
    .optional(),
  conflict_resolution: z.enum(['overwrite']).optional(),
  existing_record_id: z.string().optional(),
  expected_version: z.number().int().positive().optional(),
  visit_geo_log: visitGeoLogSchema.optional(),
});

export const createVisitRecordSchema = visitRecordBaseSchema.superRefine((data, ctx) => {
  if (data.outcome_status === 'completed') {
    const hasS = Boolean(data.soap_subjective?.trim());
    const hasP = Boolean(data.soap_plan?.trim());
    const hasStructuredSoap = data.structured_soap != null && Object.keys(data.structured_soap).length > 0;
    if (!hasS && !hasP && !hasStructuredSoap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['soap_subjective'],
        message: '完了時はS（主観）またはP（計画）のいずれかの記入が必要です',
      });
    }
  }
});

export const updateVisitRecordSchema = visitRecordBaseSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
    attachments: z
      .array(visitRecordAttachmentRefSchema)
      .max(10, '添付は10件までです')
      .optional(),
  });

export type CreateVisitRecordInput = z.infer<typeof createVisitRecordSchema>;
export type UpdateVisitRecordInput = z.infer<typeof updateVisitRecordSchema>;
export type VisitRecordAttachmentRefInput = z.infer<typeof visitRecordAttachmentRefSchema>;
export type VisitGeoLogInput = z.infer<typeof visitGeoLogSchema>;
