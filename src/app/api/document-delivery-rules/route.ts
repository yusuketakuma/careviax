import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_DOCUMENT_DELIVERY_RULE_LIMIT = 100;
const MAX_DOCUMENT_DELIVERY_RULE_LIMIT = 200;
const DOCUMENT_DELIVERY_RULE_COUNT_BASIS = 'document_delivery_rules' as const;

const deliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);

const documentTypeQuerySchema = z.string().trim().min(1).max(64);

const createDocumentDeliveryRuleSchema = z.object({
  document_type: z.string().trim().min(1, 'document_type は必須です'),
  target_role: z.string().trim().min(1, 'target_role は必須です'),
  channel: deliveryChannelSchema,
  fallback_channels: z.array(deliveryChannelSchema).default([]),
  is_active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const documentTypeRaw = searchParams.get('document_type');
  const parsedDocumentType =
    documentTypeRaw === null ? null : documentTypeQuerySchema.safeParse(documentTypeRaw);
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_DOCUMENT_DELIVERY_RULE_LIMIT,
    1,
    MAX_DOCUMENT_DELIVERY_RULE_LIMIT,
  );

  if (parsedDocumentType && !parsedDocumentType.success) {
    return validationError('クエリパラメータが不正です', {
      document_type: ['document_type が不正です'],
    });
  }

  const where = {
    org_id: ctx.orgId,
    ...(parsedDocumentType?.success ? { document_type: parsedDocumentType.data } : {}),
  };

  const [rules, totalCount] = await withOrgContext(ctx.orgId, (tx) =>
    Promise.all([
      tx.documentDeliveryRule.findMany({
        where,
        orderBy: [{ document_type: 'asc' }, { target_role: 'asc' }, { updated_at: 'desc' }],
        take: limit,
      }),
      tx.documentDeliveryRule.count({ where }),
    ]),
  );
  const visibleCount = rules.length;
  const hiddenCount = Math.max(totalCount - visibleCount, 0);

  return success({
    data: rules,
    total_count: totalCount,
    visible_count: visibleCount,
    hidden_count: hiddenCount,
    truncated: hiddenCount > 0,
    count_basis: DOCUMENT_DELIVERY_RULE_COUNT_BASIS,
    filters_applied: {
      document_type: parsedDocumentType?.success ? parsedDocumentType.data : null,
    },
    limit,
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createDocumentDeliveryRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
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
  );

  return success({ data: rule }, 201);
}
