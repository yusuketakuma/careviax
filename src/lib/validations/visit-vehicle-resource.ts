import { z } from 'zod';

const travelModeSchema = z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);

const optionalTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
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
  notes: optionalTrimmedStringSchema,
});

export const visitVehicleResourceQuerySchema = z.object({
  site_id: z.string().trim().min(1).optional(),
  available: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
