import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { updateBillingCollectionSchema } from '@/lib/validations/billing-collection';

class BillingCollectionConflictError extends Error {}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '集金記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const candidateId = normalizeRequiredRouteParam(rawId);
  if (!candidateId) return validationError('請求候補IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateBillingCollectionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const candidate = await tx.billingCandidate.findFirst({
      where: {
        id: candidateId,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        status: true,
        calculation_breakdown: true,
        updated_at: true,
      },
    });
    if (!candidate) return null;

    const existingBreakdown = readJsonObject(candidate.calculation_breakdown) ?? {};
    const billedAmount = parsed.data.billed_amount ?? null;
    const collectedAmount = parsed.data.collected_amount ?? null;
    const unpaidAmount =
      billedAmount == null ? null : Math.max(billedAmount - (collectedAmount ?? 0), 0);
    const collection = {
      status: parsed.data.status,
      billed_amount: billedAmount,
      collected_amount: collectedAmount,
      unpaid_amount: unpaidAmount,
      payment_method: normalizeNullableText(parsed.data.payment_method),
      payer_name: normalizeNullableText(parsed.data.payer_name),
      billed_at: parsed.data.billed_at ? new Date(parsed.data.billed_at).toISOString() : null,
      scheduled_collection_at: parsed.data.scheduled_collection_at
        ? new Date(parsed.data.scheduled_collection_at).toISOString()
        : null,
      collected_at: parsed.data.collected_at
        ? new Date(parsed.data.collected_at).toISOString()
        : null,
      receipt_number: normalizeNullableText(parsed.data.receipt_number),
      unpaid_reason: normalizeNullableText(parsed.data.unpaid_reason),
      note: normalizeNullableText(parsed.data.note),
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    };
    const nextBreakdown = {
      ...existingBreakdown,
      collection,
    };

    const updateResult = await tx.billingCandidate.updateMany({
      where: {
        id: candidateId,
        org_id: ctx.orgId,
        updated_at: candidate.updated_at,
      },
      data: {
        calculation_breakdown: nextBreakdown as Prisma.InputJsonObject,
      },
    });
    if (updateResult.count !== 1) {
      throw new BillingCollectionConflictError(
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
      );
    }

    await createAuditLogEntry(tx, ctx, {
      action: 'billing_collection_updated',
      targetType: 'BillingCandidate',
      targetId: candidateId,
      changes: {
        status_before: candidate.status,
        collection,
      },
    });

    const updated = await tx.billingCandidate.findUnique({
      where: { id: candidateId },
    });
    return updated;
  }).catch((error) => {
    if (error instanceof BillingCollectionConflictError) return 'conflict' as const;
    throw error;
  });

  if (result === 'conflict') {
    return conflict(
      '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    );
  }
  if (!result) return notFound('請求候補が見つかりません');

  return success({ data: result });
}
