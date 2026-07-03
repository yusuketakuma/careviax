import { NextRequest } from 'next/server';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { Prisma } from '@prisma/client';
import { buildCountedListEnvelope } from '@/lib/api/list-envelope';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

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

async function authenticatedGET(req: NextRequest) {
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
  const where = { org_id: ctx.orgId };

  const [totalCount, rules] = await withOrgContext(ctx.orgId, (tx) =>
    Promise.all([
      tx.notificationRule.count({ where }),
      tx.notificationRule.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
      }),
    ]),
  );
  return success({
    ...buildCountedListEnvelope(rules, totalCount),
    count_basis: 'notification_rules',
    filters_applied: {},
    limit,
  });
}

export async function GET(req: NextRequest) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPOST(req: NextRequest) {
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

export async function POST(req: NextRequest) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
