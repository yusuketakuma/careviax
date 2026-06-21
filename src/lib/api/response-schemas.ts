import { z, type ZodType } from 'zod';
import { readJsonObject } from '@/lib/db/json';

export function apiDataSchema<TData>(dataSchema: ZodType<TData>): ZodType<{ data: TData }> {
  return z.object({
    data: dataSchema,
  });
}

export type CursorPaginatedPage<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
};

export function cursorPaginatedPageSchema<TItem>(
  itemSchema: ZodType<TItem>,
): ZodType<CursorPaginatedPage<TItem>> {
  return z
    .object({
      data: z.array(itemSchema),
      hasMore: z.boolean(),
      nextCursor: z.string().trim().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.hasMore && !value.nextCursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextCursor'],
          message: 'nextCursor is required when hasMore is true',
        });
      }
    })
    .transform(({ data, hasMore, nextCursor }) => ({
      data,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    }));
}

export function normalizeCursorPaginatedPagePayload<TItem>(
  payload: unknown,
  itemSchema?: ZodType<TItem>,
): { page: CursorPaginatedPage<TItem>; metadata: Record<string, unknown> } | null {
  const object = readJsonObject(payload);
  if (!object) return null;

  const { data, hasMore, nextCursor, ...metadata } = object;
  const pageEnvelope = cursorPaginatedPageSchema(z.unknown()).safeParse({
    data,
    hasMore,
    nextCursor,
  });
  if (!pageEnvelope.success) return null;

  const parsedData: TItem[] = [];
  for (const item of pageEnvelope.data.data) {
    if (!itemSchema) {
      parsedData.push(item as TItem);
      continue;
    }
    const parsedItem = itemSchema.safeParse(item);
    if (!parsedItem.success) return null;
    parsedData.push(parsedItem.data);
  }

  return {
    page: {
      data: parsedData,
      hasMore: pageEnvelope.data.hasMore,
      ...(pageEnvelope.data.nextCursor !== undefined
        ? { nextCursor: pageEnvelope.data.nextCursor }
        : {}),
    },
    metadata,
  };
}
