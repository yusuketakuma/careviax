import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, forbidden } from '@/lib/api/response';

const createRuleSchema = z.object({
  event_type: z.string().min(1),
  channel: z.enum(['in_app', 'email']),
  recipients: z.object({
    roles: z.array(z.string()).optional(),
    user_ids: z.array(z.string()).optional(),
  }),
  enabled: z.boolean().default(true),
  conditions: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const rules = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findMany({
      where: { org_id: ctx.orgId },
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

  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.create({
      data: {
        org_id: ctx.orgId,
        event_type: parsed.data.event_type,
        channel: parsed.data.channel,
        recipients: parsed.data.recipients as Prisma.InputJsonValue,
        enabled: parsed.data.enabled,
        conditions: parsed.data.conditions
          ? (parsed.data.conditions as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    })
  );

  return success(rule, 201);
}
