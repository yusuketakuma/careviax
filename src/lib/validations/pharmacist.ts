import { z } from 'zod';
import { MANAGEABLE_MEMBER_ROLES, roleRequiresSite } from '@/lib/auth/member-roles';

const siteIdField = z.string().trim().optional().transform((value) => value || undefined);

const baseMemberFields = {
  name: z.string().min(1, '氏名は必須です'),
  name_kana: z.string().min(1, 'フリガナは必須です'),
  phone: z.string().optional(),
  site_id: siteIdField,
  role: z.enum(MANAGEABLE_MEMBER_ROLES),
  max_daily_visits: z.number().int().min(1).max(20).optional(),
  max_weekly_visits: z.number().int().min(1).max(100).optional(),
  max_travel_minutes: z.number().int().min(0).max(480).optional(),
  can_accept_emergency: z.boolean().default(true),
  visit_specialties: z.array(z.string()).default([]),
  coverage_area: z.array(z.string()).default([]),
} as const;

const permissionOverrideFields = {
  can_dispense: z.boolean().optional(),
  can_audit_dispense: z.boolean().optional(),
  can_set: z.boolean().optional(),
  can_audit_set: z.boolean().optional(),
} as const;

export const createPharmacistSchema = z
  .object({
    ...baseMemberFields,
    email: z.string().email('メールアドレス形式が不正です'),
    role: z.enum(MANAGEABLE_MEMBER_ROLES).default('pharmacist'),
  })
  .superRefine((data, ctx) => {
    if (roleRequiresSite(data.role) && !data.site_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['site_id'],
        message: '所属店舗は必須です',
      });
    }
  });

const updateMemberSchema = z
  .object({
    action: z.literal('update'),
    ...baseMemberFields,
    ...permissionOverrideFields,
  })
  .superRefine((data, ctx) => {
    if (roleRequiresSite(data.role) && !data.site_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['site_id'],
        message: '所属店舗は必須です',
      });
    }
  });

export const updatePharmacistSchema = z.discriminatedUnion('action', [
  updateMemberSchema,
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
