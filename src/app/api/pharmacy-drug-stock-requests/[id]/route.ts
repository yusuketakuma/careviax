import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  decision_note: z.string().trim().max(500).nullable().optional(),
});

function readPayload(value: unknown) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const data = payload as Record<string, unknown>;
  return {
    is_stocked: data.is_stocked === true,
    reorder_point: typeof data.reorder_point === 'number' ? data.reorder_point : null,
    preferred_generic_id:
      typeof data.preferred_generic_id === 'string' ? data.preferred_generic_id : null,
    adoption_note: typeof data.adoption_note === 'string' ? data.adoption_note : null,
  };
}

export const PATCH = withAuthContext(
  async (
    req: NextRequest,
    authCtx,
    routeContext: AuthRouteContext<{ id: string }>,
  ) => {
    const params = routeParamsSchema.safeParse(await routeContext.params);
    if (!params.success) {
      return validationError('パスパラメータが不正です', params.error.flatten().fieldErrors);
    }

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const request = await prisma.formularyChangeRequest.findFirst({
      where: { id: params.data.id, org_id: authCtx.orgId },
    });
    if (!request) return notFound('採用品変更申請が見つかりません');
    if (request.status !== 'pending') {
      return conflict('この申請はすでに処理済みです', { status: request.status });
    }

    const decidedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      let stock = null;
      if (parsed.data.decision === 'approve') {
        const payload = readPayload(request.requested_payload);
        stock = await tx.pharmacyDrugStock.upsert({
          where: {
            site_id_drug_master_id: {
              site_id: request.site_id,
              drug_master_id: request.drug_master_id,
            },
          },
          create: {
            org_id: authCtx.orgId,
            site_id: request.site_id,
            drug_master_id: request.drug_master_id,
            is_stocked: payload.is_stocked,
            reorder_point: payload.reorder_point,
            preferred_generic_id: payload.preferred_generic_id,
            adoption_source: 'approval',
            adoption_note: payload.adoption_note,
          },
          update: {
            is_stocked: payload.is_stocked,
            reorder_point: payload.reorder_point,
            preferred_generic_id: payload.preferred_generic_id,
            adoption_source: 'approval',
            adoption_note: payload.adoption_note,
          },
        });
      }

      const updated = await tx.formularyChangeRequest.update({
        where: { id: request.id },
        data: {
          status: parsed.data.decision === 'approve' ? 'approved' : 'rejected',
          decided_by_id: authCtx.userId,
          decision_note: parsed.data.decision_note ?? null,
          decided_at: decidedAt,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action:
            parsed.data.decision === 'approve'
              ? 'pharmacy_drug_stock_change_approved'
              : 'pharmacy_drug_stock_change_rejected',
          target_type: 'FormularyChangeRequest',
          target_id: request.id,
          changes: {
            request_id: request.id,
            site_id: request.site_id,
            drug_master_id: request.drug_master_id,
            requested_payload: request.requested_payload,
            decision_note: parsed.data.decision_note ?? null,
            applied_stock_id: stock?.id ?? null,
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return { request: updated, stock };
    });

    return success(result);
  },
  { permission: 'canAdmin' },
);
