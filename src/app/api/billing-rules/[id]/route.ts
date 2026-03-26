import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';

const updateBillingRuleSchema = z.object({
  rule_type: z.enum(['addition', 'reduction']).optional(),
  name: z.string().min(1).optional(),
  code: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
  amount: z.number().int().optional(),
  is_active: z.boolean().optional(),
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
    tx.billingRule.findFirst({
      where: { id, org_id: ctx.orgId },
    })
  );

  if (!rule) return notFound('算定ルールが見つかりません');

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

  const parsed = updateBillingRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.findFirst({ where: { id, org_id: ctx.orgId } })
  );
  if (!existing) return notFound('算定ルールが見つかりません');

  const { conditions, ...rest } = parsed.data;
  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.update({
      where: { id },
      data: {
        ...rest,
        ...(conditions !== undefined ? { conditions: conditions as Prisma.InputJsonValue } : {}),
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
    tx.billingRule.findFirst({ where: { id, org_id: ctx.orgId } })
  );
  if (!existing) return notFound('算定ルールが見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.delete({ where: { id } })
  );

  return success({ message: '算定ルールを削除しました' });
}
