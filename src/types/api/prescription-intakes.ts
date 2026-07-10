import { z, type ZodType } from 'zod';

const prescriptionIntakeFacetCountsSchema = z.record(z.string(), z.number().int().nonnegative());

const prescriptionIntakeListMetaSchema = z
  .object({
    has_more: z.boolean(),
    next_cursor: z.string().trim().min(1).nullable(),
    total_count: z.number().int().nonnegative().optional(),
    facets: z
      .object({
        status: prescriptionIntakeFacetCountsSchema,
        source_type: prescriptionIntakeFacetCountsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export function prescriptionIntakeListResponseSchema<TItem>(itemSchema: ZodType<TItem>) {
  return z
    .object({
      data: z.array(itemSchema),
      meta: prescriptionIntakeListMetaSchema,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.meta.has_more && !value.meta.next_cursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['meta', 'next_cursor'],
          message: 'next_cursor is required when has_more is true',
        });
      }
      if (!value.meta.has_more && value.meta.next_cursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['meta', 'next_cursor'],
          message: 'next_cursor must be null when has_more is false',
        });
      }
    })
    .transform(({ data, meta }) => ({
      data,
      hasMore: meta.has_more,
      ...(meta.next_cursor ? { nextCursor: meta.next_cursor } : {}),
      ...(meta.total_count !== undefined ? { totalCount: meta.total_count } : {}),
      ...(meta.facets !== undefined ? { facets: meta.facets } : {}),
    }));
}
