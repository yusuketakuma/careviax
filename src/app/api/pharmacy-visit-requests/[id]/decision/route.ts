import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { resolvePharmacyVisitRequestTransition } from '@/server/services/pharmacy-partnerships';

const visitRequestDecisionSchema = z.enum(['accept', 'decline']);

const updateVisitRequestDecisionSchema = z
  .object({
    decision: visitRequestDecisionSchema,
    expected_updated_at: z.string().datetime('版情報が不正です'),
    pharmacist_id: z
      .string()
      .trim()
      .max(128)
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
    decline_reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'decline' && !value.decline_reason?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['decline_reason'],
        message: '辞退理由は必須です',
      });
    }
  });

function auditActionForDecision(decision: z.infer<typeof visitRequestDecisionSchema>) {
  switch (decision) {
    case 'accept':
      return 'pharmacy_visit_request_accepted';
    case 'decline':
      return 'pharmacy_visit_request_declined';
  }
}

function toSafeVisitRequest<T extends object>(row: T) {
  const source = row as T & {
    request_reason?: unknown;
    physician_instruction?: unknown;
    carry_items?: unknown;
    patient_home_notes?: unknown;
    decline_reason?: unknown;
  };
  const {
    request_reason: requestReason,
    physician_instruction: physicianInstruction,
    carry_items: carryItems,
    patient_home_notes: patientHomeNotes,
    decline_reason: declineReason,
    ...safe
  } = source;

  return {
    ...safe,
    has_request_reason: requestReason !== undefined && requestReason !== null,
    has_physician_instruction: physicianInstruction !== undefined && physicianInstruction !== null,
    has_carry_items: carryItems !== undefined && carryItems !== null,
    has_patient_home_notes: patientHomeNotes !== undefined && patientHomeNotes !== null,
    has_decline_reason: declineReason !== undefined && declineReason !== null,
  };
}

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('訪問依頼IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateVisitRequestDecisionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const visitRequest = await tx.pharmacyVisitRequest.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          share_case_id: true,
          partnership_id: true,
          partner_pharmacy_id: true,
          updated_at: true,
          share_case: { select: { status: true } },
          partnership: {
            select: {
              status: true,
              partner_pharmacy: { select: { status: true } },
            },
          },
        },
      });

      if (!visitRequest) return { response: notFound('訪問依頼が見つかりません') };
      const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);
      if (visitRequest.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { response: conflict('訪問依頼が更新されています。再読み込みしてください') };
      }

      const transition = resolvePharmacyVisitRequestTransition({
        currentStatus: visitRequest.status,
        action: parsed.data.decision,
      });
      if (!transition.allowed) {
        return { response: conflict('依頼中の訪問依頼のみ受諾または辞退できます') };
      }
      if (visitRequest.share_case.status !== 'active') {
        return { response: conflict('共有中の患者共有ケースに紐づく訪問依頼のみ更新できます') };
      }
      if (
        visitRequest.partnership.status !== 'active' ||
        visitRequest.partnership.partner_pharmacy.status !== 'active'
      ) {
        return { response: conflict('有効な薬局間連携と協力薬局に紐づく訪問依頼のみ更新できます') };
      }

      const updatedCount = await tx.pharmacyVisitRequest.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: transition.currentStatus,
          updated_at: expectedUpdatedAt,
          share_case: { status: 'active' },
          partnership: {
            status: 'active',
            partner_pharmacy: { status: 'active' },
          },
        },
        data:
          parsed.data.decision === 'accept'
            ? {
                status: transition.nextStatus,
                accepted_by: parsed.data.pharmacist_id ?? ctx.userId,
                accepted_at: now,
              }
            : {
                status: transition.nextStatus,
                declined_by: parsed.data.pharmacist_id ?? ctx.userId,
                declined_at: now,
                decline_reason: parsed.data.decline_reason,
              },
      });

      if (updatedCount.count !== 1) {
        return { response: conflict('訪問依頼はすでに更新されています') };
      }

      const updated = await tx.pharmacyVisitRequest.findUniqueOrThrow({
        where: { id_org_id: { id, org_id: ctx.orgId } },
      });

      await createAuditLogEntry(tx, ctx, {
        action: auditActionForDecision(parsed.data.decision),
        targetType: 'PharmacyVisitRequest',
        targetId: updated.id,
        changes: {
          share_case_id: visitRequest.share_case_id,
          partnership_id: visitRequest.partnership_id,
          partner_pharmacy_id: visitRequest.partner_pharmacy_id,
          decision: parsed.data.decision,
          previous_status: visitRequest.status,
          status: updated.status,
          actor_id: parsed.data.pharmacist_id ?? ctx.userId,
          decline_reason_length: parsed.data.decline_reason?.length ?? 0,
        },
      });

      return { visitRequest: toSafeVisitRequest(updated) };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.visitRequest);
  },
  {
    permission: 'canManagePatientSharing',
    message: '訪問依頼の受諾・辞退権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
