import { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildCountedListEnvelope } from '@/lib/api/list-envelope';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { validationError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_DOCUMENT_DELIVERY_RULE_LIMIT = 100;
const MAX_DOCUMENT_DELIVERY_RULE_LIMIT = 200;
const DOCUMENT_DELIVERY_RULE_COUNT_BASIS = 'document_delivery_rules' as const;

const deliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);
const documentTypeQuerySchema = z.string().trim().min(1).max(64);

const createDocumentDeliveryRuleSchema = z
  .object({
    document_type: z.string().trim().min(1, 'document_type は必須です').max(64),
    target_role: z.string().trim().min(1, 'target_role は必須です').max(64),
    channel: deliveryChannelSchema,
    fallback_channels: z.array(deliveryChannelSchema).max(3).default([]),
    is_active: z.boolean().default(true),
  })
  .superRefine((rule, context) => {
    if (
      rule.fallback_channels.includes(rule.channel) ||
      new Set(rule.fallback_channels).size !== rule.fallback_channels.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fallback_channels'],
        message: 'fallback_channels は重複させず、既定チャネルを除外してください',
      });
    }
  });

function parseSingleQueryValue(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  return values.length <= 1 ? (values[0] ?? null) : undefined;
}

async function documentDeliveryRulesGET(req: NextRequest, ctx: AuthContext) {
  const documentTypeRaw = parseSingleQueryValue(req.nextUrl.searchParams, 'document_type');
  const limitRaw = parseSingleQueryValue(req.nextUrl.searchParams, 'limit');
  if (documentTypeRaw === undefined || limitRaw === undefined) {
    return withSensitiveNoStore(validationError('クエリパラメータが不正です'));
  }

  const parsedDocumentType =
    documentTypeRaw === null ? null : documentTypeQuerySchema.safeParse(documentTypeRaw);
  if (parsedDocumentType && !parsedDocumentType.success) {
    return withSensitiveNoStore(
      validationError('クエリパラメータが不正です', {
        document_type: ['document_type が不正です'],
      }),
    );
  }

  const limit = parseBoundedInteger(
    limitRaw,
    DEFAULT_DOCUMENT_DELIVERY_RULE_LIMIT,
    1,
    MAX_DOCUMENT_DELIVERY_RULE_LIMIT,
  );
  const where = {
    org_id: ctx.orgId,
    ...(parsedDocumentType?.success ? { document_type: parsedDocumentType.data } : {}),
  };

  const [rules, totalCount] = await withOrgContext(
    ctx.orgId,
    (tx) =>
      Promise.all([
        tx.documentDeliveryRule.findMany({
          where,
          orderBy: [{ document_type: 'asc' }, { target_role: 'asc' }, { updated_at: 'desc' }],
          take: limit,
        }),
        tx.documentDeliveryRule.count({ where }),
      ]),
    { requestContext: ctx },
  );
  const list = buildCountedListEnvelope(rules, totalCount);
  return withSensitiveNoStore(
    success({
      data: list.data,
      meta: {
        total_count: list.total_count,
        visible_count: list.visible_count,
        hidden_count: list.hidden_count,
        truncated: list.truncated,
        count_basis: DOCUMENT_DELIVERY_RULE_COUNT_BASIS,
        filters_applied: {
          document_type: parsedDocumentType?.success ? parsedDocumentType.data : null,
        },
        limit,
      },
    }),
  );
}

export const GET = withAuthContext(documentDeliveryRulesGET, { permission: 'canAdmin' });

async function documentDeliveryRulesPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = createDocumentDeliveryRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const rule = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.documentDeliveryRule.create({
        data: {
          org_id: ctx.orgId,
          document_type: parsed.data.document_type,
          target_role: parsed.data.target_role,
          channel: parsed.data.channel,
          fallback_channels: toPrismaJsonInput(parsed.data.fallback_channels),
          is_active: parsed.data.is_active,
        },
      }),
    { requestContext: ctx },
  );

  return withSensitiveNoStore(success({ data: rule }, 201));
}

export const POST = withAuthContext(documentDeliveryRulesPOST, { permission: 'canAdmin' });
