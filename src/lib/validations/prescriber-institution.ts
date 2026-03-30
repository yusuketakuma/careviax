import { z } from 'zod';

export const createPrescriberInstitutionSchema = z.object({
  name: z.string().trim().min(1, '医療機関名は必須です'),
  institution_code: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  fax: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const updatePrescriberInstitutionSchema = z.object({
  name: z.string().trim().min(1).optional(),
  institution_code: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  fax: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});
