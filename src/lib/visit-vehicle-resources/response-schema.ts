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
const VEHICLE_ID = nonEmptyText(200);
const VEHICLE_DATE = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const TRAVEL_MODE = z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);

const vehicleSiteSummarySchema = z
  .object({
    id: VEHICLE_ID,
    name: nonEmptyText(500),
  })
  .strip();

const visitVehicleResourceSchema = z
  .object({
    id: VEHICLE_ID,
    site_id: VEHICLE_ID,
    label: nonEmptyText(500),
    vehicle_code: z.string().max(200).nullable(),
    travel_mode: TRAVEL_MODE,
    max_stops: z.number().finite().int().min(1).max(50),
    max_route_duration_minutes: z.number().finite().int().min(1).max(1_440).nullable(),
    available: z.boolean(),
    next_inspection_date: VEHICLE_DATE.nullable(),
    notes: z.string().max(4_000).nullable(),
    site: vehicleSiteSummarySchema.nullable(),
  })
  .strip();

const vehicleResourceFiltersSchema = z
  .object({
    site_id: VEHICLE_ID.optional(),
    available: z.boolean().optional(),
  })
  .strict();

const vehicleResourceMetaSchema = z
  .object({
    total_count: NON_NEGATIVE_COUNT,
    visible_count: NON_NEGATIVE_COUNT,
    hidden_count: NON_NEGATIVE_COUNT,
    truncated: z.boolean(),
    count_basis: z.literal('visit_vehicle_resources'),
    filters_applied: vehicleResourceFiltersSchema,
    limit: z.number().finite().int().min(1).max(200),
  })
  .strict();

export const visitVehicleResourcesResponseSchema = z
  .object({
    data: z.array(visitVehicleResourceSchema).max(200),
    meta: vehicleResourceMetaSchema,
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const vehicleIds = new Set<string>();
    for (const [index, vehicle] of data.entries()) {
      if (vehicleIds.has(vehicle.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate vehicle resource identity',
        });
      }
      vehicleIds.add(vehicle.id);

      if (vehicle.site && vehicle.site.id !== vehicle.site_id) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'site', 'id'],
          message: 'Vehicle site identity must match site_id',
        });
      }
    }

    if (data.length > meta.limit) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'limit'],
        message: 'Vehicle resource data exceeds the requested limit',
      });
    }
    if (meta.visible_count !== data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'visible_count'],
        message: 'Visible count must equal returned vehicle data length',
      });
    }
    if (meta.hidden_count !== meta.total_count - meta.visible_count) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'hidden_count'],
        message: 'Hidden count must equal total minus visible vehicle count',
      });
    }
    if (meta.truncated !== meta.hidden_count > 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'truncated'],
        message: 'Truncated flag must match hidden vehicle count',
      });
    }
  });

const pharmacySiteOptionSchema = z
  .object({
    id: VEHICLE_ID,
    name: nonEmptyText(500),
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

export type VisitVehicleResourcesResponse = z.infer<typeof visitVehicleResourcesResponseSchema>;
export type PharmacySiteOption = z.infer<typeof pharmacySiteOptionSchema>;
export type PharmacySiteOptionsResponse = z.infer<typeof pharmacySiteOptionsResponseSchema>;
