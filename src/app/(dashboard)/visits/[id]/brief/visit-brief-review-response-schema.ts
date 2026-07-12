import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const summaryFields = {
  generation_id: nonEmptyText(255),
  headline: z.string().max(10_000),
  bullets: z.array(z.string().max(10_000)).max(100),
} as const;

const ruleSummarySchema = z
  .object({
    ...summaryFields,
    source_refs: z.array(z.string().max(1_000)).max(100),
    generated_at: z.string().datetime({ offset: true }),
  })
  .strip();
const aiSummarySchema = z
  .object({
    ...summaryFields,
    provider: z.enum(['rule', 'openai']),
    requested_provider: nonEmptyText(255),
    is_fallback: z.boolean(),
    model: nonEmptyText(255).nullable(),
  })
  .strip()
  .superRefine((summary, context) => {
    if (summary.provider === 'openai' && !summary.is_fallback && summary.model === null) {
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'A non-fallback OpenAI summary must identify its model',
      });
    }
  });

export const visitBriefReviewResponseSchema = z
  .object({
    data: z
      .object({
        patient: z
          .object({
            id: nonEmptyText(255),
            name: nonEmptyText(500),
          })
          .strip(),
        context: z.enum(['patient', 'schedule']),
        generated_at: z.string().datetime({ offset: true }),
        rule_summary: ruleSummarySchema,
        ai_summary: aiSummarySchema,
      })
      .strip(),
  })
  .strict();

export type VisitBriefReviewSnapshot = z.infer<typeof visitBriefReviewResponseSchema>['data'];
