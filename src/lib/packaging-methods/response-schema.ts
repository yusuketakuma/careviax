import { z } from 'zod';

const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});
const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();

const packagingMethodSchema = z
  .object({
    id: NON_EMPTY_TEXT,
    name: NON_EMPTY_TEXT,
    description: z.string().max(4_000).nullable(),
    icon_key: z.string().max(200).nullable(),
    sort_order: NON_NEGATIVE_COUNT,
    is_active: z.boolean(),
  })
  .strip();

const packagingMethodsMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.literal('packaging_methods'),
    filters_applied: z.object({}).strict(),
    limit: z.number().finite().int().min(1).max(200),
  })
  .strict();

export const packagingMethodsResponseSchema = z
  .object({
    data: z.array(packagingMethodSchema).max(200),
    meta: packagingMethodsMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const methodIds = new Set<string>();
    for (const [index, method] of data.entries()) {
      if (methodIds.has(method.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate packaging method identity',
        });
      }
      methodIds.add(method.id);
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Packaging method data exceeds the requested limit',
      });
    }

    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal the returned data length',
      });
    }

    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible count',
      });
    }

    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden count',
      });
    }
  });

export type PackagingMethod = z.infer<typeof packagingMethodSchema>;
export type PackagingMethodsResponse = z.infer<typeof packagingMethodsResponseSchema>;
