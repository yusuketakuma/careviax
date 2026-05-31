import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { success, validationError, notFound } from '@/lib/api/response';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({
      where: { id, org_id: ctx.orgId },
    })
  );

  if (!rule) return notFound('通知ルールが見つかりません');

  return success(rule);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({ where: { id, org_id: ctx.orgId } })
  );
  if (!existing) return notFound('通知ルールが見つかりません');

  const { conditions, recipients, ...rest } = parsed.data;
  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.update({
      where: { id },
      data: {
        ...rest,
        ...(conditions !== undefined ? { conditions: toPrismaJsonInput(conditions) } : {}),
        ...(recipients !== undefined ? { recipients: toPrismaJsonInput(recipients) } : {}),
      },
    })
  );

  return success(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findFirst({ where: { id, org_id: ctx.orgId } })
  );
  if (!existing) return notFound('通知ルールが見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.delete({ where: { id } })
  );

  return success({ message: '通知ルールを削除しました' });
}
