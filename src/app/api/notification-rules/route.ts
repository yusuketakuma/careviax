import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { Prisma } from '@prisma/client';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { success, validationError } from '@/lib/api/response';

const DEFAULT_NOTIFICATION_RULE_LIMIT = 100;
const MAX_NOTIFICATION_RULE_LIMIT = 200;

const createRuleSchema = z.object({
  event_type: z.string().min(1),
  channel: z.enum(['in_app', 'email', 'sms', 'line', 'fax', 'mcs']),
  recipients: z.object({
    roles: z.array(z.string()).optional(),
    user_ids: z.array(z.string()).optional(),
  }),
  enabled: z.boolean().default(true),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_NOTIFICATION_RULE_LIMIT,
    1,
    MAX_NOTIFICATION_RULE_LIMIT,
  );

  const rules = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.findMany({
      where: { org_id: ctx.orgId },
      orderBy: { created_at: 'desc' },
      take: limit,
    }),
  );

  return success({ data: rules });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.notificationRule.create({
      data: {
        org_id: ctx.orgId,
        event_type: parsed.data.event_type,
        channel: parsed.data.channel,
        recipients: toPrismaJsonInput(parsed.data.recipients),
        enabled: parsed.data.enabled,
        conditions: parsed.data.conditions
          ? toPrismaJsonInput(parsed.data.conditions)
          : Prisma.JsonNull,
      },
    }),
  );

  return success(rule, 201);
}
