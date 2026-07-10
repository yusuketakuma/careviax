import { z, type ZodType } from 'zod';

const careReportListMetaSchema = z
  .object({
    has_more: z.boolean(),
    next_cursor: z.string().trim().min(1).nullable(),
    delivery_summary: z.unknown().optional(),
    search: z.unknown().optional(),
  })
  .strict();

export function careReportListResponseSchema<TItem>(itemSchema: ZodType<TItem>) {
  return z
    .object({
      data: z.array(itemSchema),
      meta: careReportListMetaSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.meta?.has_more && !value.meta.next_cursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['meta', 'next_cursor'],
          message: 'next_cursor is required when has_more is true',
        });
      }
      if (value.meta && !value.meta.has_more && value.meta.next_cursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['meta', 'next_cursor'],
          message: 'next_cursor must be null when has_more is false',
        });
      }
    })
    .transform(({ data }) => ({ data }));
}
