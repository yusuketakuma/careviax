import { z } from 'zod';
import { dateKeyPattern, isValidDateKey } from '@/lib/validations/date-key';

const boundedSectionArraySchema = z.array(z.string().max(1_000)).max(100);

export const managementPlanContentSchema = z
  .object({
    goals: boundedSectionArraySchema.optional(), // 薬学的ケア目標
    problems: boundedSectionArraySchema.optional(), // 薬学的課題
    interventions: boundedSectionArraySchema.optional(), // 介入計画
    monitoring: boundedSectionArraySchema.optional(), // モニタリング項目
    collaboration: boundedSectionArraySchema.optional(), // 多職種連携事項
    patient_education: boundedSectionArraySchema.optional(), // 患者教育・指導
    notes: z.string().max(10_000).optional(), // 特記事項
  })
  .strict();

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

const requiredTrimmedStringSchema = (message: string, max: number) =>
  z.string().trim().min(1, message).max(max);

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().max(4_000).nullable().optional());

const optionalDateStringSchema = (fieldName: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z
      .string()
      .regex(dateKeyPattern, `${fieldName} の形式が不正です（YYYY-MM-DD）`)
      .refine(isValidDateKey, `${fieldName} の日付が不正です`)
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
    case_id: requiredTrimmedStringSchema('ケースIDは必須です', 200),
    title: requiredTrimmedStringSchema('タイトルは必須です', 200).default('訪問薬剤管理指導計画書'),
    summary: optionalTrimmedStringSchema,
    content: managementPlanContentSchema.default({}),
    effective_from: optionalDateStringSchema('effective_from'),
    next_review_date: optionalDateStringSchema('next_review_date'),
    source_plan_id: z.string().trim().min(1).max(200).nullable().optional(),
    expected_latest_version: z.number().int().min(0).max(2_147_483_647),
  })
  .strict()
  .superRefine(addDateRangeIssue);

export const updateManagementPlanSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('update'),
      title: requiredTrimmedStringSchema('タイトルは必須です', 200).optional(),
      summary: optionalTrimmedStringSchema,
      content: managementPlanContentSchema.optional(),
      effective_from: optionalDateStringSchema('effective_from'),
      next_review_date: optionalDateStringSchema('next_review_date'),
      expected_updated_at: z.string().datetime({ offset: true }),
    })
    .strict()
    .superRefine((data, ctx) => {
      addDateRangeIssue(data, ctx);
      if (
        data.title === undefined &&
        data.summary === undefined &&
        data.content === undefined &&
        data.effective_from === undefined &&
        data.next_review_date === undefined
      ) {
        ctx.addIssue({ code: 'custom', message: '更新項目を1つ以上指定してください' });
      }
    }),
  z
    .object({
      action: z.literal('archive'),
      expected_updated_at: z.string().datetime({ offset: true }),
    })
    .strict(),
]);
