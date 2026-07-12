import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';

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

const NON_EMPTY_TEXT = (max: number) => z.string().trim().min(1).max(max);

const pharmacySiteAdminSchema = pharmacySiteOptionSchema.extend({
  address: NON_EMPTY_TEXT(2_000),
  phone: z.string().max(100).nullable(),
  fax: z.string().max(100).nullable(),
  is_health_support_pharmacy: z.boolean(),
  is_regional_support: z.boolean(),
  is_specialized_pharmacy: z.boolean(),
  dispensing_fee_category: NON_EMPTY_TEXT(200).nullable(),
});

export const pharmacySiteAdminResponseSchema = z
  .object({ data: z.array(pharmacySiteAdminSchema) })
  .strict()
  .superRefine(({ data }, context) => {
    const siteIds = new Set<string>();
    for (const [index, site] of data.entries()) {
      if (siteIds.has(site.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate pharmacy site identity',
        });
      }
      siteIds.add(site.id);
    }
  });

const insuranceConfigDateSchema = dateKeySchema('Expected a valid insurance config date');
const pharmacySiteInsuranceConfigSchema = z
  .object({
    id: NON_EMPTY_SITE_ID,
    site_id: NON_EMPTY_SITE_ID,
    insurance_type: z.enum(['medical', 'care']),
    revision_code: NON_EMPTY_TEXT(100),
    revision_label: z.string().max(500).nullable(),
    effective_from: insuranceConfigDateSchema,
    effective_to: insuranceConfigDateSchema.nullable(),
    config: z.record(z.string(), z.unknown()),
  })
  .strip()
  .refine((value) => value.effective_to === null || value.effective_from < value.effective_to, {
    path: ['effective_to'],
    message: 'Insurance config end date must be after its start date',
  });

export function buildPharmacySiteInsuranceConfigsResponseSchema(expectedSiteId: string) {
  return z
    .object({ data: z.array(pharmacySiteInsuranceConfigSchema) })
    .strict()
    .superRefine(({ data }, context) => {
      const configIds = new Set<string>();
      const revisions = new Set<string>();
      for (const [index, config] of data.entries()) {
        if (config.site_id !== expectedSiteId) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'site_id'],
            message: 'Insurance config belongs to a different pharmacy site',
          });
        }
        if (configIds.has(config.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate insurance config identity',
          });
        }
        configIds.add(config.id);

        const revisionKey = `${config.insurance_type}:${config.revision_code}`;
        if (revisions.has(revisionKey)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'revision_code'],
            message: 'Duplicate insurance config revision',
          });
        }
        revisions.add(revisionKey);
      }
    });
}

export type PharmacySiteAdmin = z.infer<typeof pharmacySiteAdminSchema>;
export type PharmacySiteAdminResponse = z.infer<typeof pharmacySiteAdminResponseSchema>;
export type PharmacySiteInsuranceConfig = z.infer<typeof pharmacySiteInsuranceConfigSchema>;
export type PharmacySiteInsuranceConfigsResponse = {
  data: PharmacySiteInsuranceConfig[];
};
