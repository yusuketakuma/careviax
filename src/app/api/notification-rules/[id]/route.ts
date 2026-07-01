import { NextRequest } from 'next/server';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const updateRuleSchema = z.object({
  event_type: z.string().min(1).optional(),
  channel: z.enum(['in_app', 'email', 'sms', 'line', 'fax', 'mcs']).optional(),
  recipients: z
    .object({
      roles: z.array(z.string()).optional(),
      user_ids: z.array(z.string()).optional(),
    })
    .optional(),
  enabled: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

type NotificationRuleRouteContext = { params: Promise<{ id: string }> };

async function authenticatedGET(req: NextRequest, { params }: NotificationRuleRouteContext) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return validationError('通知ルールIDが不正です');

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({
      where: { id: ruleId, org_id: ctx.orgId },
    }),
  );

  if (!rule) return notFound('通知ルールが見つかりません');

  return success(rule);
}

export async function GET(req: NextRequest, routeContext: NotificationRuleRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPATCH(req: NextRequest, { params }: NotificationRuleRouteContext) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return validationError('通知ルールIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({ where: { id: ruleId, org_id: ctx.orgId } }),
  );
  if (!existing) return notFound('通知ルールが見つかりません');

  const { conditions, recipients, ...rest } = parsed.data;
  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.update({
      where: { id: ruleId },
      data: {
        ...rest,
        ...(conditions !== undefined ? { conditions: toPrismaJsonInput(conditions) } : {}),
        ...(recipients !== undefined ? { recipients: toPrismaJsonInput(recipients) } : {}),
      },
    }),
  );

  return success(updated);
}

export async function PATCH(req: NextRequest, routeContext: NotificationRuleRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedDELETE(req: NextRequest, { params }: NotificationRuleRouteContext) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return validationError('通知ルールIDが不正です');

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({ where: { id: ruleId, org_id: ctx.orgId } }),
  );
  if (!existing) return notFound('通知ルールが見つかりません');

  await withOrgContext(ctx.orgId, (tx) => tx.notificationRule.delete({ where: { id: ruleId } }));

  return success({ message: '通知ルールを削除しました' });
}

export async function DELETE(req: NextRequest, routeContext: NotificationRuleRouteContext) {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
