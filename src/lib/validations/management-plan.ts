import { z } from 'zod';

export const managementPlanContentSchema = z.object({
  goals: z.array(z.string()).optional(),                    // 薬学的ケア目標
  problems: z.array(z.string()).optional(),                 // 薬学的課題
  interventions: z.array(z.string()).optional(),            // 介入計画
  monitoring: z.array(z.string()).optional(),               // モニタリング項目
  collaboration: z.array(z.string()).optional(),            // 多職種連携事項
  patient_education: z.array(z.string()).optional(),        // 患者教育・指導
  notes: z.string().optional(),                             // 特記事項
}).catchall(z.unknown());

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
  content: Record<string, unknown>
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

export const createManagementPlanSchema = z.object({
  case_id: z.string().min(1, 'ケースIDは必須です'),
  title: z.string().min(1, 'タイトルは必須です').default('訪問薬剤管理指導計画書'),
  summary: z.string().optional(),
  content: contentSchema,
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from の形式が不正です（YYYY-MM-DD）')
    .optional(),
  next_review_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'next_review_date の形式が不正です（YYYY-MM-DD）')
    .optional(),
  source_plan_id: z.string().optional(),
});

export const updateManagementPlanSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    title: z.string().min(1, 'タイトルは必須です').optional(),
    summary: z.string().optional(),
    content: contentSchema.optional(),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from の形式が不正です（YYYY-MM-DD）')
      .optional(),
    next_review_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'next_review_date の形式が不正です（YYYY-MM-DD）')
      .optional(),
  }),
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('archive'),
  }),
]);
