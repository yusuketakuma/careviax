import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { formatUtcDateKey } from '@/lib/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const reviewDecisionSchema = z.enum(['confirm', 'return']);

const reviewPartnerVisitRecordSchema = z
  .object({
    decision: reviewDecisionSchema,
    return_reason: z.string().trim().max(1000).optional(),
    doctor_report_required: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'return' && !value.return_reason?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['return_reason'],
        message: '差戻し理由は必須です',
      });
    }
  });

class TransactionResponse extends Error {
  constructor(readonly response: ReturnType<typeof conflict>) {
    super('transaction_response');
  }
}

function auditActionForDecision(decision: z.infer<typeof reviewDecisionSchema>) {
  switch (decision) {
    case 'confirm':
      return 'partner_visit_record_confirmed';
    case 'return':
      return 'partner_visit_record_returned';
  }
}

function attachmentCount(value: unknown) {
  return Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1;
}

function toSafePartnerVisitRecord<T extends object>(row: T) {
  const source = row as T & {
    record_content?: unknown;
    attachments?: unknown;
    returned_reason?: unknown;
    base_confirmation_snapshot?: unknown;
  };
  const {
    record_content: recordContent,
    attachments,
    returned_reason: returnedReason,
    base_confirmation_snapshot: baseConfirmationSnapshot,
    ...safe
  } = source;

  return {
    ...safe,
    has_record_content: recordContent !== undefined && recordContent !== null,
    attachment_count: attachmentCount(attachments),
    has_returned_reason: returnedReason !== undefined && returnedReason !== null,
    has_base_confirmation_snapshot:
      baseConfirmationSnapshot !== undefined && baseConfirmationSnapshot !== null,
  };
}

function visitDateOnly(value: Date) {
  return utcDateFromLocalKey(formatUtcDateKey(value));
}

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('協力訪問記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = reviewPartnerVisitRecordSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    let result:
      | { response: ReturnType<typeof conflict> | ReturnType<typeof notFound> }
      | { partnerVisitRecord: ReturnType<typeof toSafePartnerVisitRecord> };
    try {
      result = await withOrgContext(ctx.orgId, async (tx) => {
        const record = await tx.partnerVisitRecord.findFirst({
          where: { id, org_id: ctx.orgId },
          select: {
            id: true,
            status: true,
            visit_request_id: true,
            share_case_id: true,
            owner_partner_pharmacy_id: true,
            visit_at: true,
            revision_no: true,
            share_case: { select: { status: true } },
            owner_partner_pharmacy: { select: { name: true, status: true } },
            visit_request: {
              select: {
                status: true,
                partnership_id: true,
                partnership: {
                  select: {
                    status: true,
                    partner_pharmacy: { select: { status: true } },
                    base_site: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        });

        if (!record) return { response: notFound('協力訪問記録が見つかりません') };
        if (record.status !== 'submitted') {
          return { response: conflict('提出済みの訪問記録のみ確認または差戻しできます') };
        }
        if (record.share_case.status !== 'active') {
          return { response: conflict('共有中の患者共有ケースに紐づく訪問記録のみ確認できます') };
        }
        if (
          record.visit_request.status !== 'accepted' ||
          record.visit_request.partnership.status !== 'active' ||
          record.visit_request.partnership.partner_pharmacy.status !== 'active' ||
          record.owner_partner_pharmacy.status !== 'active'
        ) {
          return { response: conflict('受諾済みの有効な協力訪問のみ確認できます') };
        }

        if (parsed.data.decision === 'confirm') {
          const completedRequestCount = await tx.pharmacyVisitRequest.updateMany({
            where: {
              id: record.visit_request_id,
              org_id: ctx.orgId,
              status: 'accepted',
              partnership: {
                status: 'active',
                partner_pharmacy: { status: 'active' },
              },
            },
            data: { status: 'completed', completed_at: now },
          });
          if (completedRequestCount.count !== 1) {
            return { response: conflict('訪問依頼はすでに更新されています') };
          }
        }

        const updatedCount = await tx.partnerVisitRecord.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            status: 'submitted',
            share_case: { status: 'active' },
            owner_partner_pharmacy: { status: 'active' },
            visit_request: {
              status: parsed.data.decision === 'confirm' ? 'completed' : 'accepted',
              partnership: {
                status: 'active',
                partner_pharmacy: { status: 'active' },
              },
            },
          },
          data:
            parsed.data.decision === 'confirm'
              ? {
                  status: 'confirmed',
                  confirmed_at: now,
                  confirmed_by: ctx.userId,
                  base_confirmation_snapshot: toPrismaJsonInput({
                    doctor_report_required: parsed.data.doctor_report_required,
                    next_action: parsed.data.doctor_report_required
                      ? 'doctor_report_draft'
                      : 'claim_review',
                    confirmed_at: now.toISOString(),
                  }),
                }
              : {
                  status: 'returned',
                  returned_at: now,
                  returned_by: ctx.userId,
                  returned_reason: parsed.data.return_reason,
                },
        });
        if (updatedCount.count !== 1) {
          throw new TransactionResponse(conflict('訪問記録はすでに更新されています'));
        }

        if (parsed.data.decision === 'return') {
          await tx.pharmacyVisitRequest.updateMany({
            where: { id: record.visit_request_id, org_id: ctx.orgId, status: 'completed' },
            data: { status: 'accepted', completed_at: null },
          });
        }

        if (parsed.data.decision === 'confirm') {
          const visitDate = visitDateOnly(record.visit_at);
          const baseSite = record.visit_request.partnership.base_site;
          await tx.claimCooperationNote.upsert({
            where: {
              partner_visit_record_id_org_id: {
                partner_visit_record_id: record.id,
                org_id: ctx.orgId,
              },
            },
            create: {
              org_id: ctx.orgId,
              partner_visit_record_id: record.id,
              partner_pharmacy_name: record.owner_partner_pharmacy.name,
              visit_date: visitDate,
              prescription_received_by: baseSite.name,
              dispensing_pharmacy_id: baseSite.id,
              dispensing_pharmacy_name: baseSite.name,
              claim_status: 'pending',
              claim_note_text: `協力薬局:${record.owner_partner_pharmacy.name} / 訪問日:${formatUtcDateKey(
                visitDate,
              )} / 処方箋受付薬局:${baseSite.name}`,
            },
            update: {
              partner_pharmacy_name: record.owner_partner_pharmacy.name,
              visit_date: visitDate,
              prescription_received_by: baseSite.name,
              dispensing_pharmacy_id: baseSite.id,
              dispensing_pharmacy_name: baseSite.name,
              claim_status: 'pending',
              claim_note_text: `協力薬局:${record.owner_partner_pharmacy.name} / 訪問日:${formatUtcDateKey(
                visitDate,
              )} / 処方箋受付薬局:${baseSite.name}`,
            },
          });
        }

        const updated = await tx.partnerVisitRecord.findUniqueOrThrow({
          where: { id_org_id: { id, org_id: ctx.orgId } },
          include: {
            owner_partner_pharmacy: { select: { id: true, name: true, status: true } },
            visit_request: { select: { id: true, status: true, urgency: true } },
            claim_note: {
              select: {
                id: true,
                claim_status: true,
                visit_date: true,
                partner_pharmacy_name: true,
                prescription_received_by: true,
                dispensing_pharmacy_name: true,
              },
            },
          },
        });

        await createAuditLogEntry(tx, ctx, {
          action: auditActionForDecision(parsed.data.decision),
          targetType: 'PartnerVisitRecord',
          targetId: updated.id,
          changes: {
            visit_request_id: record.visit_request_id,
            share_case_id: record.share_case_id,
            partner_pharmacy_id: record.owner_partner_pharmacy_id,
            revision_no: record.revision_no,
            decision: parsed.data.decision,
            previous_status: record.status,
            status: updated.status,
            visit_request_status:
              parsed.data.decision === 'confirm' ? 'completed' : record.visit_request.status,
            doctor_report_required: parsed.data.doctor_report_required,
            return_reason_length: parsed.data.return_reason?.length ?? 0,
          },
        });

        return { partnerVisitRecord: toSafePartnerVisitRecord(updated) };
      });
    } catch (error) {
      if (error instanceof TransactionResponse) return error.response;
      throw error;
    }

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.partnerVisitRecord);
  },
  {
    permission: 'canManagePatientSharing',
    message: '協力訪問記録の確認権限がありません',
  },
);
