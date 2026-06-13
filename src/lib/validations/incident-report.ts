import { z } from 'zod';

/** 関係する工程の語彙(取込/入力/判断/調剤/監査/セット/訪問/報告/算定) */
export const incidentRelatedProcessSchema = z.enum([
  'intake',
  'entry',
  'judgment',
  'dispensing',
  'audit',
  'set',
  'visit',
  'report',
  'billing',
]);

export const incidentStatusSchema = z.enum(['open', 'reviewed', 'closed']);

export const incidentSeveritySchema = z.enum(['near_miss', 'level1', 'level2']);

const memoTextSchema = z.string().max(2000, '2000文字以内で入力してください');

export const createIncidentReportSchema = z.object({
  title: z.string().min(1, '表題は必須です').max(200, '表題は200文字以内で入力してください'),
  what_happened: memoTextSchema.nullish(),
  cause: memoTextSchema.nullish(),
  immediate_action: memoTextSchema.nullish(),
  prevention_plan: memoTextSchema.nullish(),
  related_process: incidentRelatedProcessSchema.nullish(),
  severity: incidentSeveritySchema.optional(),
  occurred_at: z.string().datetime({ offset: true, message: '日時形式が不正です' }).nullish(),
});

export const updateIncidentReportSchema = z
  .object({
    title: z
      .string()
      .min(1, '表題は必須です')
      .max(200, '表題は200文字以内で入力してください')
      .optional(),
    what_happened: memoTextSchema.nullish(),
    cause: memoTextSchema.nullish(),
    immediate_action: memoTextSchema.nullish(),
    prevention_plan: memoTextSchema.nullish(),
    related_process: incidentRelatedProcessSchema.nullish(),
    // ステータス変更(確認済み/クローズ)は管理者のみ。ハンドラ側で canAdmin を確認する
    status: incidentStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: '更新する項目がありません',
  });

export type IncidentRelatedProcess = z.infer<typeof incidentRelatedProcessSchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type CreateIncidentReportInput = z.infer<typeof createIncidentReportSchema>;
export type UpdateIncidentReportInput = z.infer<typeof updateIncidentReportSchema>;
