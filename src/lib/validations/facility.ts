import { z } from 'zod';
import {
  optionalFaxNumberSchema,
  optionalNullableFaxNumberSchema,
  optionalNullablePhoneNumberSchema,
  optionalPhoneNumberSchema,
} from '@/lib/validations/phone';

const timeStringSchema = z.string().regex(/^\d{2}:\d{2}$/, '時刻形式が不正です（HH:mm）');

export const facilityContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, '担当者名は必須です'),
  role: z.string().trim().optional(),
  phone: optionalPhoneNumberSchema,
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')),
  fax: optionalFaxNumberSchema,
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
  phone: optionalPhoneNumberSchema,
  fax: optionalFaxNumberSchema,
  acceptance_time_from: timeStringSchema.optional(),
  acceptance_time_to: timeStringSchema.optional(),
  regular_visit_weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  notes: z.string().trim().optional(),
  contacts: z.array(facilityContactSchema).default([]),
});

export const createFacilityUnitSchema = z.object({
  name: z.string().trim().min(1, 'ユニット名は必須です'),
  floor: z.string().trim().optional(),
  unit_type: z.enum(['floor', 'wing', 'unit']).default('unit'),
  capacity: z.number().int().min(0).optional(),
  notes: z.string().trim().optional(),
  display_order: z.number().int().min(0).default(0),
});

export const updateFacilityUnitSchema = z.object({
  name: z.string().trim().min(1).optional(),
  floor: z.string().trim().nullable().optional(),
  unit_type: z.enum(['floor', 'wing', 'unit']).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  display_order: z.number().int().min(0).optional(),
});

export const updateFacilitySchema = z.object({
  name: z.string().trim().min(1).optional(),
  facility_type: facilityTypeSchema.optional(),
  address: z.string().trim().nullable().optional(),
  phone: optionalNullablePhoneNumberSchema,
  fax: optionalNullableFaxNumberSchema,
  acceptance_time_from: z.union([timeStringSchema, z.null()]).optional(),
  acceptance_time_to: z.union([timeStringSchema, z.null()]).optional(),
  regular_visit_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  notes: z.string().trim().nullable().optional(),
  contacts: z.array(facilityContactSchema).optional(),
});
