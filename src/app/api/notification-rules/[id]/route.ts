import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const notificationChannelSchema = z.enum(['in_app', 'email', 'sms', 'line', 'fax', 'mcs']);
const expectedUpdatedAtSchema = z.string().datetime('通知ルールの版情報が不正です');
const recipientIdSchema = z.string().trim().min(1).max(200);

const recipientsSchema = z
  .object({
    roles: z.array(recipientIdSchema).max(200).optional(),
    user_ids: z.array(recipientIdSchema).max(500).optional(),
  })
  .superRefine((recipients, context) => {
    for (const key of ['roles', 'user_ids'] as const) {
      const values = recipients[key] ?? [];
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} に重複があります`,
        });
      }
    }
  });

const updateRuleSchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
  event_type: z.string().trim().min(1).max(200).optional(),
  channel: notificationChannelSchema.optional(),
  recipients: recipientsSchema.optional(),
  enabled: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

const deleteRuleQuerySchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
});

const notificationRuleSelect = {
  id: true,
  event_type: true,
  channel: true,
  recipients: true,
  enabled: true,
  created_at: true,
  updated_at: true,
} as const;

function staleNotificationRuleConflict(expected: string, current: Date | null) {
  return conflict('通知ルールが更新されています。再読み込みしてください', {
    conflict_type: 'stale_notification_rule',
    expected_updated_at: expected,
    current_updated_at: current?.toISOString() ?? null,
  });
}

async function notificationRuleGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return withSensitiveNoStore(validationError('通知ルールIDが不正です'));

  const rule = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.notificationRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: notificationRuleSelect,
      }),
    { requestContext: ctx },
  );
  if (!rule) return withSensitiveNoStore(notFound('通知ルールが見つかりません'));

  return withSensitiveNoStore(success({ data: rule }));
}

export const GET = withAuthContext(notificationRuleGET, { permission: 'canAdmin' });

async function notificationRulePATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return withSensitiveNoStore(validationError('通知ルールIDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = updateRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const {
    expected_updated_at: expectedUpdatedAtRaw,
    conditions,
    recipients,
    ...rest
  } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.notificationRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: { updated_at: true },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const claimed = await tx.notificationRule.updateMany({
        where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data: {
          ...rest,
          ...(conditions !== undefined ? { conditions: toPrismaJsonInput(conditions) } : {}),
          ...(recipients !== undefined ? { recipients: toPrismaJsonInput(recipients) } : {}),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.notificationRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }

      const updated = await tx.notificationRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: notificationRuleSelect,
      });
      return updated
        ? { status: 'updated' as const, updated }
        : { status: 'stale' as const, currentUpdatedAt: null };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('通知ルールが見つかりません'));
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleNotificationRuleConflict(expectedUpdatedAtRaw, result.currentUpdatedAt),
    );
  }
  return withSensitiveNoStore(success({ data: result.updated }));
}

export const PATCH = withAuthContext(notificationRulePATCH, { permission: 'canAdmin' });

async function notificationRuleDELETE(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return withSensitiveNoStore(validationError('通知ルールIDが不正です'));

  const expectedUpdatedAtValues = req.nextUrl.searchParams.getAll('expected_updated_at');
  const parsedQuery = deleteRuleQuerySchema.safeParse({
    expected_updated_at:
      expectedUpdatedAtValues.length === 1 ? expectedUpdatedAtValues[0] : undefined,
  });
  if (!parsedQuery.success) {
    return withSensitiveNoStore(
      validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors),
    );
  }
  const expectedUpdatedAt = new Date(parsedQuery.data.expected_updated_at);

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.notificationRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: { id: true, updated_at: true },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const deleted = await tx.notificationRule.deleteMany({
        where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
      });
      if (deleted.count !== 1) {
        const current = await tx.notificationRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }
      return { status: 'deleted' as const, id: existing.id };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('通知ルールが見つかりません'));
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleNotificationRuleConflict(parsedQuery.data.expected_updated_at, result.currentUpdatedAt),
    );
  }
  return withSensitiveNoStore(success({ data: { id: result.id } }));
}

export const DELETE = withAuthContext(notificationRuleDELETE, { permission: 'canAdmin' });
