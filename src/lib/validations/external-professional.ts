import { z } from 'zod';

export const contactMethodSchema = z.enum([
  'email',
  'fax',
  'phone',
  'in_person',
  'postal',
  'ses',
]);

export const professionTypeSchema = z.enum([
  'physician',
  'nurse',
  'care_manager',
  'medical_social_worker',
  'physical_therapist',
  'occupational_therapist',
  'speech_therapist',
  'registered_dietitian',
  'dentist',
  'dental_hygienist',
  'home_helper',
  'care_staff',
  'other',
]);

export const createExternalProfessionalSchema = z.object({
  profession_type: professionTypeSchema,
  name: z.string().trim().min(1, '氏名は必須です'),
  facility_id: z.string().trim().optional(),
  organization_name: z.string().trim().optional(),
  department: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')),
  fax: z.string().trim().optional(),
  preferred_contact_method: contactMethodSchema.optional(),
  preferred_contact_time: z.string().trim().optional(),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const updateExternalProfessionalSchema = z.object({
  profession_type: professionTypeSchema.optional(),
  name: z.string().trim().min(1).optional(),
  facility_id: z.string().trim().nullable().optional(),
  organization_name: z.string().trim().nullable().optional(),
  department: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')).nullable(),
  fax: z.string().trim().nullable().optional(),
  preferred_contact_method: contactMethodSchema.nullable().optional(),
  preferred_contact_time: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});
