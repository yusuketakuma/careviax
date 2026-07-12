import { z } from 'zod';

const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});
const INSTITUTION_COUNT = z.number().finite().int().nonnegative();
const INSTITUTION_DATE = z.union([z.string().date(), z.string().datetime({ offset: true })]);

const prescriberInstitutionSchema = z
  .object({
    id: NON_EMPTY_TEXT,
    name: NON_EMPTY_TEXT,
    institution_code: z.string().max(100).nullable(),
    address: z.string().max(2_000).nullable(),
    phone: z.string().max(200).nullable(),
    fax: z.string().max(200).nullable(),
    notes: z.string().max(4_000).nullable(),
    prescription_count: INSTITUTION_COUNT,
    last_prescribed_at: INSTITUTION_DATE.nullable(),
  })
  .strip();

const prescriberInstitutionListSchema = z
  .array(prescriberInstitutionSchema)
  .superRefine((institutions, context) => {
    const institutionIds = new Set<string>();
    for (const [index, institution] of institutions.entries()) {
      if (institutionIds.has(institution.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'Duplicate institution identity',
        });
      }
      institutionIds.add(institution.id);
    }
  });

const unfilteredInstitutionsResponseSchema = z
  .object({
    data: prescriberInstitutionListSchema,
  })
  .strict();

const filteredInstitutionsResponseSchema = z
  .object({
    data: prescriberInstitutionListSchema,
    meta: z
      .object({
        limit: z.number().finite().int().min(1).max(500),
        has_more: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Institution data exceeds the requested limit',
      });
    }

    if (meta.has_more && data.length !== meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'has_more'],
        message: 'A truncated institution page must be full',
      });
    }
  });

export type PrescriberInstitution = z.infer<typeof prescriberInstitutionSchema>;
export type PrescriberInstitutionsResponse =
  | z.infer<typeof unfilteredInstitutionsResponseSchema>
  | z.infer<typeof filteredInstitutionsResponseSchema>;

export function buildPrescriberInstitutionsResponseSchema({ hasQuery }: { hasQuery: boolean }) {
  return hasQuery ? filteredInstitutionsResponseSchema : unfilteredInstitutionsResponseSchema;
}
