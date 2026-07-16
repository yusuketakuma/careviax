import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildCountedListResponse } from '@/lib/api/list-envelope';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  notificationChannelSchema,
  notificationEventTypeSchema,
  notificationRecipientsSchema,
  notificationRulePublicSelect,
} from '@/lib/notification-rules/server-contract';

const DEFAULT_NOTIFICATION_RULE_LIMIT = 100;
const MAX_NOTIFICATION_RULE_LIMIT = 200;

const createRuleSchema = z.object({
  event_type: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  recipients: notificationRecipientsSchema,
  enabled: z.boolean().default(true),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

function parseSingleQueryValue(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  return values.length <= 1 ? (values[0] ?? null) : undefined;
}

async function notificationRulesGET(req: NextRequest, ctx: AuthContext) {
  const limitRaw = parseSingleQueryValue(req.nextUrl.searchParams, 'limit');
  if (limitRaw === undefined) {
    return withSensitiveNoStore(validationError('クエリパラメータが不正です'));
  }
  const limit = parseBoundedInteger(
    limitRaw,
    DEFAULT_NOTIFICATION_RULE_LIMIT,
    1,
    MAX_NOTIFICATION_RULE_LIMIT,
  );
  const where = { org_id: ctx.orgId };

  const [totalCount, rules] = await withOrgContext(
    ctx.orgId,
    (tx) =>
      Promise.all([
        tx.notificationRule.count({ where }),
        tx.notificationRule.findMany({
          where,
          select: notificationRulePublicSelect,
          orderBy: { created_at: 'desc' },
          take: limit,
        }),
      ]),
    { requestContext: ctx },
  );
  return withSensitiveNoStore(
    success(
      buildCountedListResponse(rules, totalCount, {
        count_basis: 'notification_rules',
        filters_applied: {},
        limit,
      }),
    ),
  );
}

export const GET = withAuthContext(notificationRulesGET, { permission: 'canAdmin' });

async function notificationRulesPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = createRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const rule = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.notificationRule.create({
        data: {
          org_id: ctx.orgId,
          event_type: parsed.data.event_type,
          channel: parsed.data.channel,
          recipients: toPrismaJsonInput(parsed.data.recipients),
          enabled: parsed.data.enabled,
          conditions:
            parsed.data.conditions !== undefined
              ? toPrismaJsonInput(parsed.data.conditions)
              : Prisma.JsonNull,
        },
        select: notificationRulePublicSelect,
      }),
    { requestContext: ctx },
  );

  return withSensitiveNoStore(success({ data: rule }, 201));
}

export const POST = withAuthContext(notificationRulesPOST, { permission: 'canAdmin' });
