import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { buildPartnerVisitRecordHref } from '@/lib/pharmacy-cooperation/navigation';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import {
  resolvePartnerVisitRecordTransition,
  resolvePharmacyVisitRequestTransition,
  shouldNotifyBasePharmacyOnPartnerRecordSubmit,
} from '@/server/services/pharmacy-partnerships';

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

export const POST = withAuthContext<{ id: string }>(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('協力訪問記録IDが不正です');

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const record = await tx.partnerVisitRecord.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          visit_request_id: true,
          share_case_id: true,
          revision_no: true,
          visit_at: true,
          attachments: true,
          owner_partner_pharmacy_id: true,
          owner_partner_pharmacy: { select: { name: true, status: true } },
          share_case: { select: { status: true } },
          visit_request: {
            select: {
              status: true,
              requested_by: true,
              partnership_id: true,
              partnership: {
                select: {
                  status: true,
                  partner_pharmacy: { select: { status: true } },
                },
              },
            },
          },
        },
      });

      if (!record) return { response: notFound('協力訪問記録が見つかりません') };
      const recordTransition = resolvePartnerVisitRecordTransition({
        currentStatus: record.status,
        action: 'submit',
      });
      if (!recordTransition.allowed) {
        return { response: conflict('下書きまたは差戻し中の訪問記録のみ提出できます') };
      }
      if (record.share_case.status !== 'active') {
        return { response: conflict('共有中の患者共有ケースに紐づく訪問記録のみ提出できます') };
      }
      if (
        record.visit_request.partnership.status !== 'active' ||
        record.visit_request.partnership.partner_pharmacy.status !== 'active' ||
        record.owner_partner_pharmacy.status !== 'active'
      ) {
        return { response: conflict('有効な薬局間連携と協力薬局に紐づく訪問記録のみ提出できます') };
      }
      const requestTransition = resolvePharmacyVisitRequestTransition({
        currentStatus: record.visit_request.status,
        action: 'submit_partner_record',
      });
      if (!requestTransition.allowed) {
        return { response: conflict('受諾済みの訪問依頼に紐づく訪問記録のみ提出できます') };
      }

      const notifyBasePharmacy = shouldNotifyBasePharmacyOnPartnerRecordSubmit({
        previousStatus: record.status,
        nextStatus: recordTransition.nextStatus,
      });

      const updatedCount = await tx.partnerVisitRecord.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: { in: [...recordTransition.allowedFrom] },
          share_case: { status: 'active' },
          owner_partner_pharmacy: { status: 'active' },
          visit_request: {
            status: { in: [...requestTransition.allowedFrom] },
            partnership: {
              status: 'active',
              partner_pharmacy: { status: 'active' },
            },
          },
        },
        data: {
          status: recordTransition.nextStatus,
          submitted_at: now,
          returned_at: null,
          returned_by: null,
          returned_reason: null,
        },
      });
      if (updatedCount.count !== 1) {
        return { response: conflict('訪問記録はすでに更新されています') };
      }

      await tx.pharmacyVisitRequest.updateMany({
        where: {
          id: record.visit_request_id,
          org_id: ctx.orgId,
          status: { in: [...requestTransition.allowedFrom] },
        },
        data: { status: requestTransition.nextStatus },
      });

      const notifications = notifyBasePharmacy
        ? await dispatchNotificationEvent(tx, {
            orgId: ctx.orgId,
            eventType: 'pharmacy_partner_visit_record_submitted',
            type: 'business',
            title: '協力訪問記録が提出されました',
            message: 'アプリで協力訪問記録を確認してください',
            link: buildPartnerVisitRecordHref(record.id),
            explicitUserIds: [record.visit_request.requested_by],
            metadata: {
              partner_visit_record_id: record.id,
              visit_request_id: record.visit_request_id,
              share_case_id: record.share_case_id,
            },
            dedupeKey: `pharmacy_partner_visit_record_submitted:${record.id}:${now.toISOString()}`,
          })
        : [];

      const submitted = await tx.partnerVisitRecord.findUniqueOrThrow({
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
        action: 'partner_visit_record_submitted',
        targetType: 'PartnerVisitRecord',
        targetId: submitted.id,
        changes: {
          visit_request_id: record.visit_request_id,
          share_case_id: record.share_case_id,
          partner_pharmacy_id: record.owner_partner_pharmacy_id,
          revision_no: record.revision_no,
          previous_status: record.status,
          status: submitted.status,
          visit_request_status_before: record.visit_request.status,
          visit_request_status_after: requestTransition.nextStatus,
          submitted_at: now.toISOString(),
          notify_base_pharmacy: notifyBasePharmacy,
          notification_count: notifications.length,
          attachment_count: attachmentCount(record.attachments),
        },
      });

      return { partnerVisitRecord: toSafePartnerVisitRecord(submitted), notifyBasePharmacy };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success({
      partner_visit_record: result.partnerVisitRecord,
      notify_base_pharmacy: result.notifyBasePharmacy,
    });
  },
  {
    permission: 'canManagePatientSharing',
    message: '協力訪問記録の提出権限がありません',
  },
);
