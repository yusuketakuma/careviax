import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { z } from 'zod';

const UI_PREFERENCES_KEY = 'ui_preferences';

const preferencesSchema = z.object({
  work_mode: z.enum(['pharmacist', 'clerk_support', 'management']).optional(),
  care_mode: z.enum(['home_visit', 'outpatient']).optional(),
  start_page: z.string().optional(),
});

export const GET = withAuthContext(async (_req, ctx) => {
  const setting = await prisma.setting.findUnique({
    where: {
      scope_scope_id_key: {
        scope: 'user',
        scope_id: ctx.userId,
        key: UI_PREFERENCES_KEY,
      },
    },
    select: { value: true },
  });

  const value = setting?.value ?? { work_mode: 'pharmacist', care_mode: 'home_visit' };

  return success({ data: value });
});

export const PATCH = withAuthContext(async (req, ctx) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const parsed = preferencesSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const updates = parsed.data;

  // Merge with existing value
  const existing = await prisma.setting.findUnique({
    where: {
      scope_scope_id_key: {
        scope: 'user',
        scope_id: ctx.userId,
        key: UI_PREFERENCES_KEY,
      },
    },
    select: { value: true },
  });

  const existingValue =
    existing?.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
      ? (existing.value as Record<string, unknown>)
      : {};

  const newValue = { ...existingValue, ...updates };

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.setting.upsert({
      where: {
        scope_scope_id_key: {
          scope: 'user',
          scope_id: ctx.userId,
          key: UI_PREFERENCES_KEY,
        },
      },
      create: {
        scope: 'user',
        scope_id: ctx.userId,
        key: UI_PREFERENCES_KEY,
        value: newValue,
      },
      update: {
        value: newValue,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'user_preferences_updated',
        target_type: 'Setting',
        target_id: ctx.userId,
        changes: updates,
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });
  });

  return success({ data: newValue });
});
