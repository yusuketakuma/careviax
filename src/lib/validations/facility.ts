import { z } from 'zod';

const timeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）');

export const facilityContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, '担当者名は必須です'),
  role: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')),
  fax: z.string().trim().optional(),
  is_primary: z.boolean().default(false),
  notes: z.string().trim().optional(),
});

export const facilityTypeSchema = z.enum([
  'nursing_home',
  'group_home',
  'assisted_living',
  'clinic',
  'hospital',
  'day_service',
  'home',
  'other',
]);

export const createFacilitySchema = z.object({
  name: z.string().trim().min(1, '施設名は必須です'),
  facility_type: facilityTypeSchema,
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  fax: z.string().trim().optional(),
  acceptance_time_from: timeStringSchema.optional(),
  acceptance_time_to: timeStringSchema.optional(),
  regular_visit_weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  notes: z.string().trim().optional(),
  contacts: z.array(facilityContactSchema).default([]),
});

export const updateFacilitySchema = z.object({
  name: z.string().trim().min(1).optional(),
  facility_type: facilityTypeSchema.optional(),
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  fax: z.string().trim().nullable().optional(),
  acceptance_time_from: z.union([timeStringSchema, z.null()]).optional(),
  acceptance_time_to: z.union([timeStringSchema, z.null()]).optional(),
  regular_visit_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  notes: z.string().trim().nullable().optional(),
  contacts: z.array(facilityContactSchema).optional(),
});
