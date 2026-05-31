import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { createEscalationRuleSchema } from '@/lib/validations/escalation-rule';

function serializeCondition(value: Prisma.JsonValue) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const rules = await prisma.escalationRule.findMany({
    where: { org_id: req.orgId },
    orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
  });

  return success({
    data: rules.map((rule) => ({
      id: rule.id,
      trigger_type: rule.trigger_type,
      condition: serializeCondition(rule.condition),
      action: rule.action,
      notify_role: rule.notify_role,
      is_active: rule.is_active,
      created_at: rule.created_at.toISOString(),
      updated_at: rule.updated_at.toISOString(),
    })),
  });
}, {
  permission: 'canAdmin',
  message: 'エスカレーションルールの閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createEscalationRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const created = await prisma.escalationRule.create({
    data: {
      org_id: req.orgId,
      trigger_type: parsed.data.trigger_type,
      condition: toPrismaJsonInput(parsed.data.condition),
      action: parsed.data.action,
      notify_role: parsed.data.notify_role ?? null,
      is_active: parsed.data.is_active,
    },
  });

  return success({
    data: {
      id: created.id,
      trigger_type: created.trigger_type,
      condition: serializeCondition(created.condition),
      action: created.action,
      notify_role: created.notify_role,
      is_active: created.is_active,
      created_at: created.created_at.toISOString(),
      updated_at: created.updated_at.toISOString(),
    },
  }, 201);
}, {
  permission: 'canAdmin',
  message: 'エスカレーションルールの更新権限がありません',
});
