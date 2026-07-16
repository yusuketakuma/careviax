import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { conflict, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const deliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);
const expectedUpdatedAtSchema = z.string().datetime('文書送達ルールの版情報が不正です');

const updateDocumentDeliveryRuleSchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
  document_type: z.string().trim().min(1).optional(),
  target_role: z.string().trim().min(1).optional(),
  channel: deliveryChannelSchema.optional(),
  fallback_channels: z.array(deliveryChannelSchema).optional(),
  is_active: z.boolean().optional(),
});

const deleteDocumentDeliveryRuleQuerySchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
});

function staleDocumentDeliveryRuleConflict(expected: string, current: Date | null) {
  return conflict('文書送達ルールが更新されています。再読み込みしてください', {
    conflict_type: 'stale_document_delivery_rule',
    expected_updated_at: expected,
    current_updated_at: current?.toISOString() ?? null,
  });
}

async function documentDeliveryRulePATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = updateDocumentDeliveryRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return withSensitiveNoStore(validationError('文書送達ルールIDが不正です'));

  const { expected_updated_at: expectedUpdatedAtRaw, ...updateData } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.documentDeliveryRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: { updated_at: true },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const claimed = await tx.documentDeliveryRule.updateMany({
        where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data: {
          ...(updateData.document_type ? { document_type: updateData.document_type } : {}),
          ...(updateData.target_role ? { target_role: updateData.target_role } : {}),
          ...(updateData.channel ? { channel: updateData.channel } : {}),
          ...(updateData.fallback_channels !== undefined
            ? { fallback_channels: toPrismaJsonInput(updateData.fallback_channels) }
            : {}),
          ...(updateData.is_active !== undefined ? { is_active: updateData.is_active } : {}),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.documentDeliveryRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }

      const updated = await tx.documentDeliveryRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
      });
      return updated
        ? { status: 'updated' as const, updated }
        : { status: 'stale' as const, currentUpdatedAt: null };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('文書送達ルールが見つかりません'));
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleDocumentDeliveryRuleConflict(expectedUpdatedAtRaw, result.currentUpdatedAt),
    );
  }
  return withSensitiveNoStore(success({ data: result.updated }));
}

export const PATCH = withAuthContext(documentDeliveryRulePATCH, { permission: 'canAdmin' });

async function documentDeliveryRuleDELETE(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return withSensitiveNoStore(validationError('文書送達ルールIDが不正です'));

  const expectedUpdatedAtValues = req.nextUrl.searchParams.getAll('expected_updated_at');
  const parsedQuery = deleteDocumentDeliveryRuleQuerySchema.safeParse({
    expected_updated_at:
      expectedUpdatedAtValues.length === 1 ? expectedUpdatedAtValues[0] : undefined,
  });
  if (!parsedQuery.success) {
    return withSensitiveNoStore(
      validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors),
    );
  }
  const expectedUpdatedAt = new Date(parsedQuery.data.expected_updated_at);

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.documentDeliveryRule.findFirst({
        where: { id: ruleId, org_id: ctx.orgId },
        select: { id: true, updated_at: true },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const deleted = await tx.documentDeliveryRule.deleteMany({
        where: { id: ruleId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
      });
      if (deleted.count !== 1) {
        const current = await tx.documentDeliveryRule.findFirst({
          where: { id: ruleId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }
      return { status: 'deleted' as const, id: existing.id };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('文書送達ルールが見つかりません'));
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleDocumentDeliveryRuleConflict(
        parsedQuery.data.expected_updated_at,
        result.currentUpdatedAt,
      ),
    );
  }
  return withSensitiveNoStore(success({ data: { id: result.id } }));
}

export const DELETE = withAuthContext(documentDeliveryRuleDELETE, { permission: 'canAdmin' });
