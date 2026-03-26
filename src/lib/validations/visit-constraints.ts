import { z } from 'zod';

const timeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）');

export const upsertVisitConstraintsSchema = z.object({
  preferred_weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferred_time_from: timeStringSchema.optional(),
  preferred_time_to: timeStringSchema.optional(),
  phone_contact_from: timeStringSchema.optional(),
  phone_contact_to: timeStringSchema.optional(),
  facility_time_from: timeStringSchema.optional(),
  facility_time_to: timeStringSchema.optional(),
  family_presence_required: z.boolean().default(false),
  visit_buffer_minutes: z.number().int().min(0).max(240).optional(),
  preferred_contact_name: z.string().optional(),
  preferred_contact_phone: z.string().optional(),
  notes: z.string().optional(),
  residence_lat: z.number().optional(),
  residence_lng: z.number().optional(),
  geocode_status: z.string().optional(),
  geocode_source: z.string().optional(),
  geocode_accuracy: z.string().optional(),
});
