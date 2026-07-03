import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { pharmacyDrugStockRequestedPayloadSchema } from '@/lib/validations/pharmacy-drug-stock';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  decision_note: z.string().trim().max(500).nullable().optional(),
});

function readPayload(value: unknown) {
  const parsed = pharmacyDrugStockRequestedPayloadSchema.safeParse(readJsonObject(value));
  return parsed.success ? parsed.data : null;
}

export const PATCH = withAuthContext(
  async (req: NextRequest, authCtx, routeContext: AuthRouteContext<{ id: string }>) => {
    const params = routeParamsSchema.safeParse(await routeContext.params);
    if (!params.success) {
      return validationError('パスパラメータが不正です', params.error.flatten().fieldErrors);
    }

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = decisionSchema.safeParse(payload);
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

    const approvalPayload =
      parsed.data.decision === 'approve' ? readPayload(request.requested_payload) : null;
    if (parsed.data.decision === 'approve' && !approvalPayload) {
      return conflict('申請内容が破損しているため承認できません', {
        request_id: request.id,
      });
    }
    if (approvalPayload?.preferred_generic_id) {
      const [requestedDrug, preferredGeneric] = await Promise.all([
        prisma.drugMaster.findFirst({
          where: { id: request.drug_master_id },
          select: { id: true, generic_name: true },
        }),
        prisma.drugMaster.findFirst({
          where: { id: approvalPayload.preferred_generic_id },
          select: { id: true, is_generic: true, generic_name: true },
        }),
      ]);

      if (
        !requestedDrug ||
        !preferredGeneric ||
        !preferredGeneric.is_generic ||
        (requestedDrug.generic_name &&
          preferredGeneric.generic_name &&
          requestedDrug.generic_name !== preferredGeneric.generic_name)
      ) {
        return conflict('申請内容が破損しているため承認できません', {
          request_id: request.id,
          invalid_field: 'preferred_generic_id',
        });
      }
    }

    const decidedAt = new Date();
    const decidedStatus = parsed.data.decision === 'approve' ? 'approved' : 'rejected';
    const result = await prisma.$transaction(async (tx) => {
      // 楽観的 claim: status='pending' の申請 1 件だけを確定させる。
      // findFirst→判定→update の TOCTOU（同時 approve/reject による二重承認）を
      // count!==1 で fail-close し、stock 反映・監査ログを発火させない。
      const claim = await tx.formularyChangeRequest.updateMany({
        where: { id: request.id, org_id: authCtx.orgId, status: 'pending' },
        data: {
          status: decidedStatus,
          decided_by_id: authCtx.userId,
          decision_note: parsed.data.decision_note ?? null,
          decided_at: decidedAt,
        },
      });
      if (claim.count !== 1) {
        return { kind: 'conflict' as const };
      }

      let stock = null;
      if (parsed.data.decision === 'approve') {
        if (!approvalPayload) throw new Error('Approval payload must be validated before mutation');
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
            is_stocked: approvalPayload.is_stocked,
            reorder_point: approvalPayload.reorder_point,
            preferred_generic_id: approvalPayload.preferred_generic_id,
            adoption_source: 'approval',
            adoption_note: approvalPayload.adoption_note,
          },
          update: {
            is_stocked: approvalPayload.is_stocked,
            reorder_point: approvalPayload.reorder_point,
            preferred_generic_id: approvalPayload.preferred_generic_id,
            adoption_source: 'approval',
            adoption_note: approvalPayload.adoption_note,
          },
        });
      }

      const updated = {
        ...request,
        status: decidedStatus,
        decided_by_id: authCtx.userId,
        decision_note: parsed.data.decision_note ?? null,
        decided_at: decidedAt,
      };

      await createAuditLogEntry(tx, authCtx, {
        action:
          parsed.data.decision === 'approve'
            ? 'pharmacy_drug_stock_change_approved'
            : 'pharmacy_drug_stock_change_rejected',
        targetType: 'FormularyChangeRequest',
        targetId: request.id,
        changes: {
          request_id: request.id,
          site_id: request.site_id,
          drug_master_id: request.drug_master_id,
          requested_payload: request.requested_payload,
          decision_note: parsed.data.decision_note ?? null,
          applied_stock_id: stock?.id ?? null,
        },
      });

      return { kind: 'ok' as const, request: updated, stock };
    });

    if (result.kind === 'conflict') {
      return conflict('この申請はすでに処理済みです');
    }

    return success({ request: result.request, stock: result.stock });
  },
  { permission: 'canAdmin' },
);
