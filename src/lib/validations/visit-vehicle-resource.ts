import { z } from 'zod';

const travelModeSchema = z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);

const optionalTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .optional();

/**
 * Optional date-only field for VisitVehicleResource.next_inspection_date (@db.Date).
 * Empty strings intentionally clear the value.
 */
export const visitVehicleResourceInspectionDateSchema = z
  .preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().date().nullable(),
  )
  .optional();

export const createVisitVehicleResourceSchema = z.object({
  site_id: z.string().trim().min(1, '店舗IDは必須です'),
  label: z.string().trim().min(1, '車両名は必須です'),
  vehicle_code: optionalTrimmedStringSchema,
  travel_mode: travelModeSchema.default('DRIVE'),
  max_stops: z.number().int().min(1).max(50).default(8),
  max_route_duration_minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullable()
    .optional(),
  available: z.boolean().default(true),
  next_inspection_date: visitVehicleResourceInspectionDateSchema,
  notes: optionalTrimmedStringSchema,
});

/** PATCH /api/visit-vehicle-resources/:id 用。指定されたフィールドのみ更新する。 */
export const updateVisitVehicleResourceSchema = z
  .object({
    label: z.string().trim().min(1, '車両名は必須です').optional(),
    vehicle_code: optionalTrimmedStringSchema,
    travel_mode: travelModeSchema.optional(),
    max_stops: z.number().int().min(1).max(50).optional(),
    max_route_duration_minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .nullable()
      .optional(),
    available: z.boolean().optional(),
    next_inspection_date: visitVehicleResourceInspectionDateSchema,
    notes: optionalTrimmedStringSchema,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: '更新する項目を指定してください',
  });

export const visitVehicleResourceQuerySchema = z.object({
  site_id: z.string().trim().min(1).optional(),
  available: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
