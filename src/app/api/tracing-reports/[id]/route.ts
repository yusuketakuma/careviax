import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { communicationChannelSchema } from '@/lib/validations/communication-channel';
import {
  optionalTracingReportStatusSchema,
  type TracingReportStatusValue,
} from '@/lib/validations/tracing-report';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'トレーシングレポートの削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('トレーシングレポートIDが不正です');

  const existing = await prisma.tracingReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, patient_id: true, case_id: true, status: true },
  });

  if (!existing) return notFound('トレーシングレポートが見つかりません');
  if (
    !(await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: { userId: ctx.userId, role: ctx.role },
    }))
  ) {
    return notFound('トレーシングレポートが見つかりません');
  }
  if (existing.status !== 'draft') {
    return forbidden('下書き以外のトレーシングレポートは削除できません');
  }

  await withOrgContext(
    ctx.orgId,
    async (tx) => {
      await tx.tracingReport.delete({ where: { id } });
    },
    { requestContext: ctx },
  );

  return success({ data: { id } });
}

const ALLOWED_TRACING_STATUS_TRANSITIONS: Record<
  TracingReportStatusValue,
  TracingReportStatusValue[]
> = {
  draft: ['sent'],
  sent: ['received', 'acknowledged'],
  received: ['acknowledged'],
  acknowledged: [],
};

function parseCommunicationChannel(value: unknown) {
  if (value === undefined || value === null) return 'fax';
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return 'fax';

  const parsed = communicationChannelSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

function parseStatusChangeReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'トレーシングレポートの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('トレーシングレポートIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const parsedStatus = optionalTracingReportStatusSchema.safeParse(payload.status);
  const status = parsedStatus.success ? parsedStatus.data : undefined;
  const sentToPhysician =
    typeof payload.sent_to_physician === 'string' ? payload.sent_to_physician.trim() : undefined;
  const channel = parseCommunicationChannel(payload.channel);
  const statusChangeReason = parseStatusChangeReason(payload.status_change_reason);

  if (!status) {
    return validationError('status が不正です');
  }
  if (!channel) {
    return validationError('channel が不正です', {
      channel: ['channel が不正です'],
    });
  }

  const existing = await prisma.tracingReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      sent_to_physician: true,
      sent_at: true,
      acknowledged_at: true,
    },
  });

  if (!existing) return notFound('トレーシングレポートが見つかりません');
  if (
    !(await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: { userId: ctx.userId, role: ctx.role },
    }))
  ) {
    return notFound('トレーシングレポートが見つかりません');
  }

  if (existing.status === 'acknowledged') {
    return forbidden('受領確認済みのトレーシングレポートは更新できません');
  }

  if (status !== existing.status) {
    if (!statusChangeReason) {
      return validationError('ステータス変更理由は必須です', {
        status_change_reason: ['ステータス変更理由は必須です'],
      });
    }
    const allowed = ALLOWED_TRACING_STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(status)) {
      return validationError(`${existing.status} から ${status} へは遷移できません`);
    }
  }

  const physicianName = sentToPhysician || existing.sent_to_physician || null;
  if (status === 'sent' && !physicianName) {
    return validationError('送付先医師名は必須です');
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updated = await tx.tracingReport.update({
        where: { id },
        data: {
          status,
          ...(physicianName ? { sent_to_physician: physicianName } : {}),
          ...(status === 'sent' && !existing.sent_at ? { sent_at: new Date() } : {}),
          ...(status === 'acknowledged' && !existing.acknowledged_at
            ? { acknowledged_at: new Date() }
            : {}),
          pdf_url: `/api/tracing-reports/${id}/pdf`,
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          issue_id: true,
          content: true,
          status: true,
          sent_to_physician: true,
          sent_at: true,
          acknowledged_at: true,
          pdf_url: true,
          created_at: true,
          updated_at: true,
        },
      });

      const linkedRequests = await tx.communicationRequest.findMany({
        where: {
          org_id: ctx.orgId,
          related_entity_type: 'tracing_report',
          related_entity_id: id,
          patient_id: updated.patient_id,
          case_id: updated.case_id ?? null,
        },
        select: { id: true, status: true },
      });

      const linkedRequestStatus =
        status === 'sent' ? 'sent' : status === 'received' ? 'received' : 'closed';
      const linkedRequestIds: string[] = [];

      if (status !== 'draft') {
        if (linkedRequests.length > 0) {
          for (const linkedRequest of linkedRequests) {
            await tx.communicationRequest.update({
              where: { id: linkedRequest.id },
              data: {
                status: linkedRequestStatus,
                recipient_name: physicianName,
              },
            });
            linkedRequestIds.push(linkedRequest.id);

            if (status !== existing.status && linkedRequest.status !== linkedRequestStatus) {
              await createAuditLogEntry(tx, ctx, {
                action: 'communication_request_status_changed',
                targetType: 'communication_request',
                targetId: linkedRequest.id,
                changes: {
                  from_status: linkedRequest.status,
                  to_status: linkedRequestStatus,
                  reason: statusChangeReason,
                  status_change_reason: statusChangeReason,
                  linked_tracing_report_id: id,
                  actor_id: ctx.userId,
                },
              });
            }
          }
        } else {
          const createdRequest = await tx.communicationRequest.create({
            data: {
              org_id: ctx.orgId,
              patient_id: updated.patient_id,
              case_id: updated.case_id ?? null,
              request_type: 'tracing_report',
              template_key: 'tracing_report',
              recipient_name: physicianName,
              recipient_role: 'physician',
              related_entity_type: 'tracing_report',
              related_entity_id: id,
              status: linkedRequestStatus,
              subject: '服薬情報提供書',
              content: physicianName
                ? `${physicianName} 宛てのトレーシングレポート`
                : 'トレーシングレポート',
              requested_by: ctx.userId,
              due_date: null,
            },
          });
          linkedRequestIds.push(createdRequest.id);

          if (status !== existing.status) {
            await createAuditLogEntry(tx, ctx, {
              action: 'communication_request_status_changed',
              targetType: 'communication_request',
              targetId: createdRequest.id,
              changes: {
                from_status: null,
                to_status: linkedRequestStatus,
                reason: statusChangeReason,
                status_change_reason: statusChangeReason,
                linked_tracing_report_id: id,
                actor_id: ctx.userId,
              },
            });
          }
        }
      }

      if (status === 'sent' && existing.status !== 'sent') {
        await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: updated.patient_id,
            case_id: updated.case_id ?? null,
            event_type: 'tracing_report',
            channel: channel,
            direction: 'outbound',
            counterpart_name: physicianName,
            subject: '服薬情報提供書',
            content: physicianName
              ? `${physicianName} 宛てにトレーシングレポートを送付`
              : 'トレーシングレポートを送付',
            occurred_at: updated.sent_at ?? new Date(),
          },
        });
      }

      if (status !== existing.status) {
        await createAuditLogEntry(tx, ctx, {
          action: 'tracing_report_status_changed',
          targetType: 'tracing_report',
          targetId: id,
          changes: {
            from_status: existing.status,
            to_status: status,
            reason: statusChangeReason,
            status_change_reason: statusChangeReason,
            sent_to_physician: physicianName,
            linked_request_id: linkedRequestIds[0] ?? null,
            linked_communication_request_ids: linkedRequestIds,
            actor_id: ctx.userId,
          },
        });
      }

      return updated;
    },
    { requestContext: ctx },
  );

  return success({ data: result });
}
