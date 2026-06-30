import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { updateEscalationRuleSchema } from '@/lib/validations/escalation-rule';

function serializeCondition(value: Prisma.JsonValue) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('エスカレーションルールIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateEscalationRuleSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updateResult = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.escalationRule.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!existing) return { kind: 'not_found' as const };

      const updated = await tx.escalationRule.update({
        where: { id },
        data: {
          ...(parsed.data.trigger_type !== undefined
            ? { trigger_type: parsed.data.trigger_type }
            : {}),
          ...(parsed.data.condition !== undefined
            ? { condition: toPrismaJsonInput(parsed.data.condition) }
            : {}),
          ...(parsed.data.action !== undefined ? { action: parsed.data.action } : {}),
          ...(parsed.data.notify_role !== undefined
            ? { notify_role: parsed.data.notify_role }
            : {}),
          ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'escalation_rule_updated',
        targetType: 'EscalationRule',
        targetId: updated.id,
        changes: {
          previous: {
            trigger_type: existing.trigger_type,
            condition: serializeCondition(existing.condition),
            action: existing.action,
            notify_role: existing.notify_role,
            is_active: existing.is_active,
          },
          current: {
            trigger_type: updated.trigger_type,
            condition: serializeCondition(updated.condition),
            action: updated.action,
            notify_role: updated.notify_role,
            is_active: updated.is_active,
          },
        },
      });

      return { kind: 'updated' as const, rule: updated };
    });
    if (updateResult.kind === 'not_found') {
      return notFound('エスカレーションルールが見つかりません');
    }
    const updated = updateResult.rule;

    return success({
      data: {
        id: updated.id,
        trigger_type: updated.trigger_type,
        condition: serializeCondition(updated.condition),
        action: updated.action,
        notify_role: updated.notify_role,
        is_active: updated.is_active,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at.toISOString(),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'エスカレーションルールの更新権限がありません',
  },
);

const authenticatedDELETE = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('エスカレーションルールIDが不正です');

    const deleteResult = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.escalationRule.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!existing) return { kind: 'not_found' as const };

      await tx.escalationRule.delete({
        where: { id },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'escalation_rule_deleted',
        targetType: 'EscalationRule',
        targetId: existing.id,
        changes: {
          trigger_type: existing.trigger_type,
          condition: serializeCondition(existing.condition),
          action: existing.action,
          notify_role: existing.notify_role,
          is_active: existing.is_active,
        },
      });

      return { kind: 'deleted' as const };
    });
    if (deleteResult.kind === 'not_found') {
      return notFound('エスカレーションルールが見つかりません');
    }

    return success({ message: 'エスカレーションルールを削除しました' });
  },
  {
    permission: 'canAdmin',
    message: 'エスカレーションルールの更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const DELETE: typeof authenticatedDELETE = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
