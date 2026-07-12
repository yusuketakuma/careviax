import { z } from 'zod';

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}

const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const PHARMACIST_ID = nonEmptyText(200);

const pharmacistMentionSchema = z
  .object({
    id: PHARMACIST_ID,
    name: nonEmptyText(500),
  })
  .strip();

const pharmacistListFiltersSchema = z
  .object({
    site_id: PHARMACIST_ID.nullable(),
    include_collaborators: z.boolean(),
  })
  .strict();

const pharmacistListMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.enum(['memberships', 'unique_users']),
    filters_applied: pharmacistListFiltersSchema,
    limit: z.number().finite().int().min(1).max(500),
  })
  .strict();

export const pharmacistMentionResponseSchema = z
  .object({
    data: z.array(pharmacistMentionSchema).max(500),
    meta: pharmacistListMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const namesById = new Map<string, string>();
    for (const [index, pharmacist] of data.entries()) {
      const existingName = namesById.get(pharmacist.id);
      if (existingName !== undefined && existingName !== pharmacist.name) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'name'],
          message: 'Repeated pharmacist identity must keep the same display name',
        });
      }
      namesById.set(pharmacist.id, pharmacist.name);
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Pharmacist data exceeds the requested limit',
      });
    }
    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal returned pharmacist data length',
      });
    }
    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible pharmacists',
      });
    }
    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden pharmacist count',
      });
    }
  });

export type PharmacistMentionResponse = z.infer<typeof pharmacistMentionResponseSchema>;

const pharmacistAdminOptionSchema = pharmacistMentionSchema.extend({
  site_name: z.string().max(500).nullable(),
  role: z.enum(['owner', 'admin', 'pharmacist', 'pharmacist_trainee']),
});

export const pharmacistAdminOptionsResponseSchema = z
  .object({
    data: z.array(pharmacistAdminOptionSchema).max(500),
    meta: pharmacistListMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (
      meta.filters_applied.site_id !== null ||
      meta.filters_applied.include_collaborators ||
      meta.count_basis !== 'memberships' ||
      meta.visible_count !== data.length ||
      meta.hidden_count !== meta.total_count - meta.visible_count ||
      meta.truncated !== meta.hidden_count > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['meta'],
        message: 'Pharmacist option metadata does not match the unfiltered staff request',
      });
    }
  });

export type PharmacistAdminOption = z.infer<typeof pharmacistAdminOptionSchema>;
export type PharmacistAdminOptionsResponse = z.infer<typeof pharmacistAdminOptionsResponseSchema>;
