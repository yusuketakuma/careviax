import { z } from 'zod';
import { pharmacySiteOptionSchema } from '@/lib/pharmacy-sites/response-schema';

function nonEmptyText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Expected non-empty text',
    });
}

const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const SERVICE_AREA_ID = nonEmptyText(200);

const serviceAreaGeoDataSchema = z.record(z.string(), z.unknown());

export const serviceAreaSchema = z
  .object({
    id: SERVICE_AREA_ID,
    site_id: SERVICE_AREA_ID,
    name: nonEmptyText(500),
    area_type: z.enum(['radius', 'polygon']),
    geo_data: serviceAreaGeoDataSchema,
    notes: z.string().max(4_000).nullable(),
    site: pharmacySiteOptionSchema,
  })
  .strip()
  .superRefine((serviceArea, context) => {
    if (serviceArea.site.id !== serviceArea.site_id) {
      context.addIssue({
        code: 'custom',
        path: ['site', 'id'],
        message: 'Service-area site identity must match site_id',
      });
    }
  });

const serviceAreaFiltersSchema = z
  .object({
    site_id: SERVICE_AREA_ID.nullable(),
  })
  .strict();

const serviceAreaMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.literal('service_areas'),
    filters_applied: serviceAreaFiltersSchema,
    limit: z.number().finite().int().min(1).max(200),
  })
  .strict();

export const serviceAreasResponseSchema = z
  .object({
    data: z.array(serviceAreaSchema).max(200),
    meta: serviceAreaMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const serviceAreaIds = new Set<string>();
    for (const [index, serviceArea] of data.entries()) {
      if (serviceAreaIds.has(serviceArea.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate service-area identity',
        });
      }
      serviceAreaIds.add(serviceArea.id);

      const filteredSiteId = meta.filters_applied.site_id;
      if (filteredSiteId !== null && serviceArea.site_id !== filteredSiteId) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'site_id'],
          message: 'Service-area site identity must match the applied site filter',
        });
      }
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Service-area data exceeds the requested limit',
      });
    }
    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal returned service-area data length',
      });
    }
    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible service areas',
      });
    }
    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden service-area count',
      });
    }
  });

export type ServiceArea = z.infer<typeof serviceAreaSchema>;
export type ServiceAreasResponse = z.infer<typeof serviceAreasResponseSchema>;
