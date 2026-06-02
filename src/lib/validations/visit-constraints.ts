import { z } from 'zod';
import { optionalPhoneNumberSchema } from '@/lib/validations/phone';

const timeStringSchema = z.string().regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）');

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
  preferred_contact_phone: optionalPhoneNumberSchema,
  notes: z.string().optional(),
  residence_lat: z.number().optional(),
  residence_lng: z.number().optional(),
  geocode_status: z.string().optional(),
  geocode_source: z.string().optional(),
  geocode_accuracy: z.string().optional(),
});

export const upsertFacilityVisitDaysSchema = z.object({
  facility_label: z.string().trim().min(1, '施設ラベルは必須です'),
  schedule_ids: z.array(z.string().trim().min(1)).min(1, '対象訪問予定が必要です'),
  preferred_weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferred_time_from: z.union([timeStringSchema, z.null()]).optional(),
  preferred_time_to: z.union([timeStringSchema, z.null()]).optional(),
  facility_time_from: z.union([timeStringSchema, z.null()]).optional(),
  facility_time_to: z.union([timeStringSchema, z.null()]).optional(),
  visit_buffer_minutes: z.number().int().min(0).max(240).nullable().optional(),
  notes: z.string().nullable().optional(),
});
