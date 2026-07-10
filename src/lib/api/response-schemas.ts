import { z, type ZodType } from 'zod';

export function apiDataSchema<TData>(
  dataSchema: ZodType<TData>,
): ZodType<{ data: TData; meta?: Record<string, unknown> }> {
  return z
    .object({
      data: dataSchema,
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();
}

export const apiAcknowledgementSchema = apiDataSchema(z.unknown()).transform(() => undefined);
export const apiUnknownDataEnvelopeSchema = apiDataSchema(z.unknown());

export type CursorPaginatedPage<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
};

type ApiCursorPageSchemaOptions = {
  allowAdditionalMeta?: boolean;
};

export function apiCursorPageSchema<TItem>(
  itemSchema: ZodType<TItem>,
  options: ApiCursorPageSchemaOptions = {},
): ZodType<CursorPaginatedPage<TItem>> {
  const metaBaseSchema = z.object({
    has_more: z.boolean(),
    next_cursor: z.string().trim().min(1).nullable(),
  });
  const metaSchema = options.allowAdditionalMeta
    ? metaBaseSchema.passthrough()
    : metaBaseSchema.strict();

  return z
    .object({
      data: z.array(itemSchema),
      meta: metaSchema,
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
    }));
}
