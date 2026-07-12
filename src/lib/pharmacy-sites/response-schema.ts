import { z } from 'zod';

const NON_EMPTY_SITE_ID = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, { message: 'Expected non-empty site id' });
const NON_EMPTY_SITE_NAME = z
  .string()
  .max(500)
  .refine((value) => value.trim().length > 0, { message: 'Expected non-empty site name' });

export const pharmacySiteOptionSchema = z
  .object({
    id: NON_EMPTY_SITE_ID,
    name: NON_EMPTY_SITE_NAME,
  })
  .strip();

export const pharmacySiteOptionsResponseSchema = z
  .object({
    data: z.array(pharmacySiteOptionSchema),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const siteIds = new Set<string>();
    for (const [index, site] of data.entries()) {
      if (siteIds.has(site.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate pharmacy site option identity',
        });
      }
      siteIds.add(site.id);
    }
  });

export type PharmacySiteOption = z.infer<typeof pharmacySiteOptionSchema>;
export type PharmacySiteOptionsResponse = z.infer<typeof pharmacySiteOptionsResponseSchema>;
