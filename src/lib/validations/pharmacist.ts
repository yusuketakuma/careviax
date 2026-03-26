import { z } from 'zod';

export const createPharmacistSchema = z.object({
  name: z.string().min(1, '氏名は必須です'),
  name_kana: z.string().min(1, 'フリガナは必須です'),
  email: z.string().email('メールアドレス形式が不正です'),
  phone: z.string().optional(),
  site_id: z.string().min(1, '所属店舗は必須です'),
  role: z.enum(['pharmacist', 'pharmacist_trainee']).default('pharmacist'),
  max_daily_visits: z.number().int().min(1).max(20).optional(),
  max_weekly_visits: z.number().int().min(1).max(100).optional(),
  max_travel_minutes: z.number().int().min(0).max(480).optional(),
  can_accept_emergency: z.boolean().default(true),
  visit_specialties: z.array(z.string()).default([]),
  coverage_area: z.array(z.string()).default([]),
});

export const updatePharmacistSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    name: z.string().min(1, '氏名は必須です'),
    name_kana: z.string().min(1, 'フリガナは必須です'),
    phone: z.string().optional(),
    site_id: z.string().min(1, '所属店舗は必須です'),
    role: z.enum(['pharmacist', 'pharmacist_trainee', 'admin']),
    max_daily_visits: z.number().int().min(1).max(20).optional(),
    max_weekly_visits: z.number().int().min(1).max(100).optional(),
    max_travel_minutes: z.number().int().min(0).max(480).optional(),
    can_accept_emergency: z.boolean().default(true),
    visit_specialties: z.array(z.string()).default([]),
    coverage_area: z.array(z.string()).default([]),
  }),
  z.object({
    action: z.literal('suspend'),
    reason: z.string().min(1, '停止理由は必須です'),
  }),
  z.object({
    action: z.literal('reactivate'),
  }),
  z.object({
    action: z.literal('resend_invite'),
  }),
  z.object({
    action: z.literal('retire'),
    reason: z.string().min(1, '退職理由は必須です'),
  }),
]);

export type CreatePharmacistInput = z.infer<typeof createPharmacistSchema>;
export type UpdatePharmacistInput = z.infer<typeof updatePharmacistSchema>;
