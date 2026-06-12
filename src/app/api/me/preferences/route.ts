import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { SAVED_VIEW_CONDITION_FIELDS } from '@/lib/views/saved-filter-views';
import { z } from 'zod';

const UI_PREFERENCES_KEY = 'ui_preferences';

/** p1_01「よく使う絞り込み」(/views)で保存する絞り込み条件 1 件。 */
const savedViewConditionSchema = z.object({
  field: z.enum(SAVED_VIEW_CONDITION_FIELDS),
  value: z.string().min(1).max(100),
});

const preferencesSchema = z.object({
  work_mode: z.enum(['pharmacist', 'clerk_support', 'management']).optional(),
  care_mode: z.enum(['home_visit', 'outpatient']).optional(),
  start_page: z.string().optional(),
  saved_view: z
    .object({
      conditions: z.array(savedViewConditionSchema).min(1).max(20),
      saved_at: z.string().datetime().optional(),
    })
    .optional(),
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

    await createAuditLogEntry(tx, ctx, {
      action: 'user_preferences_updated',
      targetType: 'Setting',
      targetId: ctx.userId,
      changes: updates,
    });
  });

  return success({ data: newValue });
});
