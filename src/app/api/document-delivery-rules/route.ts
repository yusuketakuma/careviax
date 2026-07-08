import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { buildCountedListEnvelope } from '@/lib/api/list-envelope';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';

const DOCUMENT_DELIVERY_RULES_ROUTE = '/api/document-delivery-rules';
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
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
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
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', {
          document_type: ['document_type が不正です'],
        }),
      );
    }

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
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'document_delivery_rules_get_unhandled_error',
        route: DOCUMENT_DELIVERY_RULES_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

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
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'document_delivery_rules_post_unhandled_error',
        route: DOCUMENT_DELIVERY_RULES_ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}
