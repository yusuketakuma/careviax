import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const deliveryChannelSchema = z.enum(['email', 'fax', 'mcs']);

const updateDocumentDeliveryRuleSchema = z.object({
  document_type: z.string().trim().min(1).optional(),
  target_role: z.string().trim().min(1).optional(),
  channel: deliveryChannelSchema.optional(),
  fallback_channels: z.array(deliveryChannelSchema).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateDocumentDeliveryRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return validationError('文書送達ルールIDが不正です');

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.findFirst({
      where: { id: ruleId, org_id: ctx.orgId },
      select: { id: true },
    }),
  );
  if (!existing) return notFound('文書送達ルールが見つかりません');

  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.update({
      where: { id: ruleId },
      data: {
        ...(parsed.data.document_type ? { document_type: parsed.data.document_type } : {}),
        ...(parsed.data.target_role ? { target_role: parsed.data.target_role } : {}),
        ...(parsed.data.channel ? { channel: parsed.data.channel } : {}),
        ...(parsed.data.fallback_channels !== undefined
          ? { fallback_channels: toPrismaJsonInput(parsed.data.fallback_channels) }
          : {}),
        ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
      },
    }),
  );

  return success({ data: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const ruleId = normalizeRequiredRouteParam(id);
  if (!ruleId) return validationError('文書送達ルールIDが不正です');

  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.findFirst({
      where: { id: ruleId, org_id: ctx.orgId },
      select: { id: true },
    }),
  );
  if (!existing) return notFound('文書送達ルールが見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.documentDeliveryRule.delete({ where: { id: ruleId } }),
  );

  return success({ message: '文書送達ルールを削除しました' });
}
