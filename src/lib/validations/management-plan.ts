import { z } from 'zod';

export const managementPlanContentSchema = z
  .object({
    goals: z.array(z.string()).optional(), // 薬学的ケア目標
    problems: z.array(z.string()).optional(), // 薬学的課題
    interventions: z.array(z.string()).optional(), // 介入計画
    monitoring: z.array(z.string()).optional(), // モニタリング項目
    collaboration: z.array(z.string()).optional(), // 多職種連携事項
    patient_education: z.array(z.string()).optional(), // 患者教育・指導
    notes: z.string().optional(), // 特記事項
  })
  .catchall(z.unknown());

export type ManagementPlanContent = z.infer<typeof managementPlanContentSchema>;

const SECTION_ORDER: string[] = [
  'goals',
  'problems',
  'interventions',
  'monitoring',
  'collaboration',
  'patient_education',
  'notes',
];

export const SECTION_LABELS: Record<string, string> = {
  goals: '薬学的ケア目標',
  problems: '薬学的課題',
  interventions: '介入計画',
  monitoring: 'モニタリング項目',
  collaboration: '多職種連携事項',
  patient_education: '患者教育・指導',
  notes: '特記事項',
};

export function sortedManagementPlanSections(
  content: Record<string, unknown>,
): Array<{ key: string; label: string; value: unknown }> {
  const ordered = SECTION_ORDER.filter((k) => k in content).map((k) => ({
    key: k,
    label: SECTION_LABELS[k] ?? k,
    value: content[k],
  }));
  const extra = Object.keys(content)
    .filter((k) => !SECTION_ORDER.includes(k))
    .map((k) => ({ key: k, label: k, value: content[k] }));
  return [...ordered, ...extra];
}

const contentSchema = z.record(z.string(), z.unknown()).default({});

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable().optional());

function isValidDateString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const optionalDateStringSchema = (fieldName: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${fieldName} の形式が不正です（YYYY-MM-DD）`)
      .refine(isValidDateString, `${fieldName} の日付が不正です`)
      .nullable()
      .optional(),
  );

function addDateRangeIssue(
  data: { effective_from?: string | null; next_review_date?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!data.effective_from || !data.next_review_date) return;
  if (data.next_review_date >= data.effective_from) return;

  ctx.addIssue({
    code: 'custom',
    path: ['next_review_date'],
    message: 'next_review_date は effective_from 以降の日付を指定してください',
  });
}

export function isManagementPlanDateRangeValid(args: {
  effectiveFrom?: string | null;
  nextReviewDate?: string | null;
}) {
  if (!args.effectiveFrom || !args.nextReviewDate) return true;
  return args.nextReviewDate >= args.effectiveFrom;
}

export const createManagementPlanSchema = z
  .object({
    case_id: requiredTrimmedStringSchema('ケースIDは必須です'),
    title: requiredTrimmedStringSchema('タイトルは必須です').default('訪問薬剤管理指導計画書'),
    summary: optionalTrimmedStringSchema,
    content: contentSchema,
    effective_from: optionalDateStringSchema('effective_from'),
    next_review_date: optionalDateStringSchema('next_review_date'),
    source_plan_id: optionalTrimmedStringSchema,
  })
  .superRefine(addDateRangeIssue);

export const updateManagementPlanSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('update'),
      title: requiredTrimmedStringSchema('タイトルは必須です').optional(),
      summary: optionalTrimmedStringSchema,
      content: contentSchema.optional(),
      effective_from: optionalDateStringSchema('effective_from'),
      next_review_date: optionalDateStringSchema('next_review_date'),
    })
    .superRefine(addDateRangeIssue),
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('archive'),
  }),
]);
