import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';

const createBillingRuleSchema = z.object({
  rule_type: z.enum(['addition', 'reduction']),
  name: z.string().min(1),
  code: z.string().optional(),
  conditions: z.record(z.unknown()),
  amount: z.number().int().optional(),
  is_active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const ruleType = searchParams.get('rule_type');

  const rules = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.findMany({
      where: {
        org_id: ctx.orgId,
        ...(ruleType ? { rule_type: ruleType } : {}),
      },
      orderBy: { created_at: 'desc' },
    })
  );

  return success({ data: rules });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createBillingRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.billingRule.create({
      data: {
        org_id: ctx.orgId,
        rule_type: parsed.data.rule_type,
        name: parsed.data.name,
        code: parsed.data.code ?? undefined,
        conditions: parsed.data.conditions as Prisma.InputJsonValue,
        amount: parsed.data.amount ?? undefined,
        is_active: parsed.data.is_active,
      },
    })
  );

  return success(rule, 201);
}
