import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(500).nullable();
const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(32);

const genericPriceComparisonSchema = z
  .object({
    standard_name: optionalText.optional(),
    dosage_form: optionalText.optional(),
    specification: optionalText.optional(),
    lowest_price: decimalString.nullable().optional(),
    add_on_scope: optionalText.optional(),
  })
  .strip();

const genericCandidateSchema = z
  .object({
    id: nonEmptyText,
    yj_code: nonEmptyText,
    drug_name: nonEmptyText,
    generic_name: optionalText,
    dosage_form: optionalText,
    drug_price: z.number().finite().nonnegative().nullable(),
    unit: optionalText,
    is_generic: z.literal(true),
    generic_price_comparison: genericPriceComparisonSchema.nullable(),
  })
  .strip();

export const genericCandidatesResponseSchema = z
  .object({
    data: z.array(genericCandidateSchema).max(5),
    meta: z
      .object({
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (meta.has_more !== (meta.next_cursor != null)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'Generic candidate cursor and has_more must agree',
      });
    }

    const ids = new Set<string>();
    const yjCodes = new Set<string>();
    for (const [index, candidate] of data.entries()) {
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Generic candidate identities must be unique',
        });
      }
      if (yjCodes.has(candidate.yj_code)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'yj_code'],
          message: 'Generic candidate YJ codes must be unique',
        });
      }
      ids.add(candidate.id);
      yjCodes.add(candidate.yj_code);
    }
  });

export type GenericCandidatesResponse = z.infer<typeof genericCandidatesResponseSchema>;
export type GenericCandidate = GenericCandidatesResponse['data'][number];
